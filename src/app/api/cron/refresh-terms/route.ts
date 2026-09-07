/**
 * TermDictionary 周维护 Cron
 * 触发：每周日 02:00 (Asia/Shanghai) / 18:00 (UTC)
 *
 * 流程（顺序执行，互不阻塞）：
 *   1) expand-synonyms  —— 给最近未审核术语补同义词
 *   2) extract-terms    —— 抽取本周新词（不依赖 1）
 *   3) evaluate-terms   —— 评估本周准确率（依赖人工 review 已通过）
 *
 * 鉴权同其他 cron：Authorization: Bearer ${CRON_SECRET}
 * 单实例锁避免重叠。
 */

import { NextResponse } from 'next/server';
import { prismaBase as prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { alert } from '@/lib/observability/alert';
import { isLockSkipped, withLock } from '@/lib/observability/distributed-lock';
import { chat, DEFAULT_MODEL } from '@/lib/ai/router';
import { getSystemTenantId } from '@/lib/system-tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * H-6 修复：简单信号量，限制并发数。
 * 与 src/lib/rankings/scraper.ts 中的实现一致（本地副本，避免跨文件依赖）。
 */
class AsyncSemaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const EXTRACT_PROMPT = `
你是一个 AI 术语提取专家。从以下 AI 新闻标题中提取：

1. **新模型名称**（如 GPT-4o、Claude Sonnet、Llama 3.1）
2. **新概念**（如 MoE、LoRA、RLHF、Spatial Intelligence）
3. **公司/组织**（如 OpenAI、Anthropic、DeepSeek）
4. **关键人物**（如 Sam Altman、Dario Amodei）

要求：
- 只提取 **AI 领域相关** 的术语
- 忽略通用词
- canonical 必须是 lowercase, kebab-case
- 每个术语给出同义词列表

返回严格 JSON：
{
  "terms": [
    {
      "canonical": "gpt-4o",
      "displayName": "GPT-4o",
      "type": "model",
      "category": "AI Coding | 具身智能 | AI 政策 | null",
      "aliases": ["gpt4o", "chatgpt-4o"]
    }
  ]
}

标题列表：
{titles}
`.trim();

const SYNONYM_PROMPT = `
给定 AI 术语：{term}（类型 {type}）
列出其常见同义词、缩写、变体。返回严格 JSON：
{ "synonyms": ["...", "..."] }
`.trim();

function stripJsonFence(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
}

async function runExtract(batch: string) {
  const news = await prisma.newsItem.findMany({
    where: { deletedAt: null },
    orderBy: { publishedAt: 'desc' },
    take: 100,
    select: { title: true },
  });
  if (news.length === 0) return { added: 0, skipped: 0, error: false };

  const titles = news.map((n) => n.title).join('\n');
  // B-13 修复：术语 cron 是系统级调用，使用 SYSTEM 租户的 ApiKey
  // 此前传 'system' 字面量 → resolveApiKey 查不到 → dev-mode mock 占位
  const systemTenantId = await getSystemTenantId();
  if (!systemTenantId) {
    logger.warn('SYSTEM tenant not initialized in runExtract', {});
    return { added: 0, skipped: 0, error: true, reason: 'SYSTEM_TENANT_MISSING' };
  }
  // BUG-C 修复：LLM 路由不可用时优雅降级，不抛异常，让 runExpand / runEvaluate 继续
  let content: string;
  try {
    const res = await chat(
      DEFAULT_MODEL,
      systemTenantId,
      [
        { role: 'system' as const, content: 'AI 术语提取专家。只返回严格 JSON。' },
        { role: 'user' as const, content: EXTRACT_PROMPT.replace('{titles}', titles) },
      ],
      { temperature: 0.3 }
    );
    content = res.content;
  } catch (err) {
    logger.warn('LLM unavailable in runExtract, skipping extract phase', {
      error: (err as Error).message,
    });
    return { added: 0, skipped: 0, error: true, reason: 'LLM unavailable' };
  }
  let parsed: { terms?: Array<{ canonical: string; displayName: string; type: string; aliases?: string[]; category?: string | null }> } = {};
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    return { added: 0, skipped: 0, error: false };
  }
  const terms = parsed.terms ?? [];
  let added = 0;
  let skipped = 0;
  for (const t of terms) {
    if (!t?.canonical || !t?.displayName || !t?.type) continue;
    const exists = await prisma.termDictionary.findUnique({ where: { canonical: t.canonical } });
    if (exists) { skipped++; continue; }
    await prisma.termDictionary.create({
      data: {
        canonical: t.canonical,
        displayName: t.displayName,
        type: t.type,
        aliases: t.aliases ?? [],
        category: t.category ?? null,
        source: 'auto',
        verified: false,
      },
    });
    added++;
  }
  return { added, skipped, total: terms.length, error: false };
}

async function runExpand() {
  // B-13 修复：SYSTEM 租户 ID 同样作用于 expandOne（runExpand 与 runExtract 是独立闭包）
  const systemTenantId = await getSystemTenantId();
  if (!systemTenantId) {
    logger.warn('SYSTEM tenant not initialized in runExpand', {});
    return { processed: 0, expanded: 0, error: 'SYSTEM_TENANT_MISSING' } as const;
  }
  const terms = await prisma.termDictionary.findMany({
    where: { verified: false },
    orderBy: { firstSeen: 'desc' },
    take: 20,
  });

  // H-6 修复：runExpand 内部原为串行 20 次 LLM 调用（~70s 总耗时）。
  //        用 AsyncSemaphore 限流到 3 并发，节省时间但不会压垮 LLM 路由。
  const sem = new AsyncSemaphore(3);
  let expanded = 0;
  const results = await Promise.allSettled(
    terms.map((term) => sem.run(() => expandOne(term)))
  );
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) expanded++;
  }
  return { processed: terms.length, expanded };

  // 单个 term 的同义词扩展（LLM + DB 写入）
  async function expandOne(term: typeof terms[number]): Promise<boolean> {
    // B-13 修复：使用 SYSTEM 租户 ID（见文件顶部说明）
    if (!systemTenantId) return false;
    try {
      const res = await chat(
        DEFAULT_MODEL,
        systemTenantId,
        [
          { role: 'system' as const, content: 'AI 术语同义词扩展专家。只返回严格 JSON。' },
          {
            role: 'user' as const,
            content: SYNONYM_PROMPT.replace('{term}', term.displayName).replace('{type}', term.type),
          },
        ],
        { temperature: 0.3 }
      );
      const content = res.content || '{}';
      let parsed: { synonyms?: string[] } = {};
      try { parsed = JSON.parse(stripJsonFence(content)); } catch { return false; }
      const newSyns = parsed.synonyms ?? [];
      const existing = Array.isArray(term.aliases) ? (term.aliases as string[]) : [];
      const set = new Set<string>();
      for (const s of [...existing, ...newSyns]) {
        const v = (s ?? '').toString().trim().toLowerCase();
        if (v && v !== term.canonical) set.add(v);
      }
      await prisma.termDictionary.update({
        where: { id: term.id },
        data: { aliases: [...set], lastVerified: new Date() },
      });
      return true;
    } catch (err) {
      logger.warn('expand failed', { canonical: term.canonical, error: (err as Error).message });
      return false;
    }
  }
}

function getBatch(): string {
  const now = new Date();
  const tmp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

async function runEvaluate(batch: string) {
  const terms = await prisma.termDictionary.findMany({
    where: { verified: true },
    orderBy: { firstSeen: 'desc' },
    take: 50,
  });
  let tp = 0;
  let fp = 0;
  let uncertain = 0;
  for (const term of terms) {
    const count = await prisma.newsItem.count({
      where: {
        deletedAt: null,
        OR: [
          { title: { contains: term.canonical } },
          { summary: { contains: term.canonical } },
        ],
      },
    });
    const label = count >= 3 ? 'true_positive' : count === 0 ? 'false_positive' : 'uncertain';
    await prisma.termEvaluation.create({
      data: { canonical: term.canonical, batch, label, frequency: count },
    });
    if (label === 'true_positive') tp++;
    else if (label === 'false_positive') fp++;
    else uncertain++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  return { total: terms.length, tp, fp, uncertain, precision };
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  // C-4 修复：expected 未配置时短路到 401（fail-closed），避免忘记配置 CRON_SECRET 时公网裸奔
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const cronName = 'terms-weekly';
  const batch = getBatch();

  const locked = await withLock('cron:terms-weekly', 600, async () => {
    try {
      const [expandRes, extractRes, evalRes] = await Promise.all([
        runExpand(),
        runExtract(batch),
        runEvaluate(batch),
      ]);

      const duration = Date.now() - startTime;

      logger.info('cron completed', {
        cron: cronName,
        batch,
        duration,
        expand: expandRes,
        extract: extractRes,
        evaluate: { ...evalRes, precision: Number(evalRes.precision.toFixed(3)) },
      });

      if (evalRes.precision < 0.75 && evalRes.tp + evalRes.fp > 0) {
        await alert({
          level: 'warn',
          title: `TermDictionary 准确率下降到 ${(evalRes.precision * 100).toFixed(1)}%`,
          message: `批次 ${batch}：TP=${evalRes.tp} FP=${evalRes.fp} uncertain=${evalRes.uncertain}`,
          ctx: { batch, precision: evalRes.precision },
        });
      }

      // BUG-C 修复：只要 LLM 路由不可达，标记 degraded 但不抛 500
      const degraded = extractRes.error === true;
      return NextResponse.json({
        ok: true,
        batch,
        duration,
        extract: extractRes,
        expand: expandRes,
        evaluate: evalRes,
        degraded,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('cron failed', {
        cron: cronName,
        duration: Date.now() - startTime,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      await alert({
        level: 'critical',
        title: 'TermDictionary 周维护 cron 异常',
        message: (err as Error).message,
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'TERMS_WEEKLY_FAILED' },
        { status: 500 },
      );
    }
  });

  if (isLockSkipped(locked)) {
    return NextResponse.json(locked, { status: 409 });
  }
  return locked;
}

export async function POST(req: Request) {
  return GET(req);
}