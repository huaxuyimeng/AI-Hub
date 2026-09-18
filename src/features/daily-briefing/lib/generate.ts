/**
 * AI 早报 — 两步 LLM 生成管线（v4：研究报告风格）
 * 路径：src/lib/daily-report/generate.ts
 *
 * v4 重大改动：
 * - 单次 LLM 调用产出全部 v4 字段（overview / items / authors / verificationTable / trends / sources）
 * - 每条 item 必须给出 heroMetrics / whyMatters / whyDoubtful / primaryLinks（缺则空）
 * - 自动按 direction 字段（coding / embodied / rumor）归类
 * - 置信度基于独立信源数（A≥3 / B=2 / C=1 / D=矛盾）
 *
 * 质量链：每步限 90s；失败重试 1 次；仍失败降级为"无 AI 文案版"（degraded），
 * 绝不产出空早报。幂等：同一天只有一份。
 *
 * Phase 字段（B7）：每个子步骤更新一次，供前端细粒度展示进度。
 */

import { chat } from '@/lib/ai/router';
import { prismaBase as prisma } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { getSystemTenantId } from '@/lib/system-tenant';
import { collectDailyNews, beijingDateString, type CollectResult } from './collect';
import {
  DailyReportContentSchema,
  enforceLimits,
  truncate,
  LIMITS,
  type DailyReportContent,
  type ConfidenceLevel,
  type DirectionKey,
} from './types';
import { computeConfidenceBySources } from './source-tiers';
import { runLayoutQA, upgradeDegradedReason } from './qa-gate';
import { repairContent } from './postprocess';
import { buildDraftBrief, type DraftReason } from './draft-brief';

const LLM_MODEL = 'deepseek-flash';
const LLM_TIMEOUT_MS = 90_000;
const MIN_ITEMS = 5;
const MAX_ITEMS = 10;
/** 给 LLM 的候选上限（控制 token） */
const CANDIDATE_CAP = 30;

// （Batch 2 边界说明）
// validate-brief 的正式接入点将在 Batch 3（drafts 降级模式）统一处理，
// 本批仅保证函数、类型、规则、单测全部就绪，调用入口独立可见。
// 设计：generate.ts 的 v4 → brief.json 转换器在 Batch 4（Page 3）一并实现。

// ---------------------------------------------------------------------------
// 置信度计算（Batch 2 重写：基于白名单 + tier 判定独立信源）
//
// 来源：参考 ai-news-kit docs/03-置信度评级规则.md
// 关键差异：旧版用 `new Set(sources)` 把 tier 3 聚合站算成独立源
//          新版按 tier + group 合并（转载 / 同集团 / tier 3 不算独立）
// ---------------------------------------------------------------------------

/**
 * v2 置信度计算（基于信源白名单）
 *
 * @param sources 来源名称列表（如 ["Anthropic News", "量子位", "TechCrunch AI"]）
 * @returns A / B / C / D
 */
function computeConfidenceLevel(item: { source: string; crossSources?: string[] }): ConfidenceLevel {
  const allSources = [item.source, ...(item.crossSources ?? [])]
    .filter(Boolean);
  return computeConfidenceBySources(allSources);
}

/** 判断两条新闻是否为同一事件 */
function isSameNews(a: { title: string; url: string }, b: { title: string; url: string }): boolean {
  if (a.url && b.url && a.url === b.url) return true;
  const aWords = new Set(a.title.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  const bWords = new Set(b.title.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  if (aWords.size === 0 || bWords.size === 0) return false;
  const intersection = [...aWords].filter(w => bWords.has(w)).length;
  const minLen = Math.min(aWords.size, bWords.size);
  return intersection / minLen > 0.6;
}

// ---------------------------------------------------------------------------
// LLM 调用工具
// ---------------------------------------------------------------------------

async function llmJson<T>(systemPrompt: string, userPrompt: string, timeoutMs: number = LLM_TIMEOUT_MS): Promise<T> {
  // 用新的多 Provider chat()（dev-mode 无 key 时返回 mock，避免阻断早报生成）
  let lastErr: unknown;
  const deadline = Date.now() + timeoutMs;
  // 尝试所有支持的模型（优先 deepseek，再降级）
  const modelCandidates = ['deepseek-flash', 'glm-4-7-flash', 'gpt-4o-mini'] as const;

  for (const model of modelCandidates) {
    if (Date.now() >= deadline) break;
    try {
      const remaining = Math.max(5000, deadline - Date.now());
      // B-13 修复：早报是系统级 cron 调用，使用 SYSTEM 租户的 ApiKey
      // 此前传 'system' 字面量 → resolveApiKey 查不到 → dev-mode mock 占位
      const systemTenantId = await getSystemTenantId();
      if (!systemTenantId) {
        throw new Error('SYSTEM 租户未初始化（请运行 prisma/seed-system-tenant.ts）');
      }
      const res = await chat(
        model,
        systemTenantId,
        [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt },
        ],
        { temperature: 0.3, devMock: true }
      );
      const cleaned = res.content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      // B-19 修复：mock/dev 路径返回的内容可能不是合法 JSON，单独 try/catch 区分错误类型。
      //          之前 SyntaxError 被当网络错误抛掉走非 key 路径直接 throw，外层 retry 把它当成真实错误。
      try {
        return JSON.parse(cleaned) as T;
      } catch (parseErr) {
        // 把 SyntaxError 转换为带 model 信息的明确错误，方便上层排查
        throw new Error(`[generate] ${model} 返回内容不是合法 JSON: ${(parseErr as Error).message}; raw=${cleaned.slice(0, 200)}`);
      }
    } catch (err) {
      lastErr = err;
      // dev-mode mock 返回值直接被 JSON.parse，model 不匹配返回 JSON 错误
      // 生产环境 key 不存在 → 透传，尝试下一个 model
      const msg = (err as Error).message ?? '';
      if (!msg.includes('API key') && !msg.includes('key') && !msg.includes('401') && !msg.includes('429')) {
        // 真实网络/解析错误，不重试其他 model
        throw err;
      }
    }
  }

  throw lastErr ?? new Error('All model candidates failed');
}

// ---------------------------------------------------------------------------
// Step 1：选题 + 方向分类
// ---------------------------------------------------------------------------

interface SelectionResult {
  selected: Array<{
    index: number;
    direction: DirectionKey;
    rank: number;          // 在该方向内的排序（1, 2, 3 ...）
  }>;
  subtitle: string;
  emphasis: string;        // "侧重 AI Coding × 具身智能"
}

function step1Prompt(
  candidates: Array<{ title: string; source: string; summary: string; category: string | null; crossSources?: string[]; hasCover?: boolean }>,
) {
  const list = candidates
    .map((c, i) => `[${i}] ${c.title}（来源：${c.source}${c.category ? `，分类：${c.category}` : ''}${c.hasCover ? '，有封面图' : ''}）\n摘要：${truncate(c.summary, 80)}`)
    .join('\n');

  return {
    system: `你是 AIHub 新闻编辑，负责挑选每日 AI 早报的头条。
选择标准：重大产品发布、融资并购、政策法规、技术突破、行业事故优先；剔除营销软文、无关财经与重复报道。
方向分类：
- "coding"：AI 编程、代码生成、形式化验证、Agent 安全、模型路由
- "embodied"：具身智能、机器人、物理世界交互
- "rumor"：单一原始信源、多家转载但官方未确认

只输出严格 JSON：
{
  "selected": [
    {"index": 候选编号, "direction": "coding|embodied|rumor", "rank": 在该方向内的排序(从1开始)}
  ],
  "subtitle": "一句话概括今日AI动态(≤30字)",
  "emphasis": "本期侧重的方向描述(≤30字,如「侧重 AI Coding × 具身智能」)"
}`,
    user: `从以下 ${candidates.length} 条今日新闻中选出 ${MIN_ITEMS}~${MAX_ITEMS} 条最重要的，按方向分类并给出方向内排序。\n\n${list}`,
  };
}

// ---------------------------------------------------------------------------
// Step 2：成稿（v5：3 调用并行 + 局部降级）
//   2a 骨架：cover + overview + trends（无依赖，先跑）
//   2b items：每条新闻独立小调用（2a 完成后并发跑）
//   2c 元数据：authors + verificationTable + sourcesBlock（与 2b 并发）
// 任一子调用失败 → 局部降级；最多重试 1 次。
// ---------------------------------------------------------------------------

const LLM_TIMEOUT_PART_MS = 35_000;        // 每个子调用 35s
const LLM_CONCURRENCY = 4;                  // items 并发数

interface WriteResultPartA {
  coverTitle: string;
  coverStats: Array<{ value: string; label: string }>;
  intro: string;
  methodNote: string;
  sources: Array<{ name: string; description: string; icon: string; color: string }>;
  tlDr: string[];
  confidenceLegend: Array<{ level: string; label: string; color: string; rule: string }>;
  distribution: Array<{ level: string; count: number }>;
  trends: Array<{ rank: number; title: string; description: string }>;
}

interface WriteResultItemV5 {
  index: number;
  summary: string;
  comment: string;
  bulletPoints: string[];
  heroMetrics: Array<{ value: string; label: string; sub?: string }>;
  whyMatters: string;
  whyDoubtful: string[];
  comparison: string;
  keyStats: Array<{ value: string; label: string; color: string }>;
  primaryLinks: Array<{ source: string; url: string }>;
  hasPrimaryLink: boolean;
  independentSources: number;
  totalReposts: number;
  confidenceLevel: string;
}

interface WriteResultPartC {
  authors: Array<{
    name: string;
    status: 'ok' | 'warn';
    statusText: string;
    count: number | null;
    description: string;
    url: string;
  }>;
  verificationTable: {
    rows: Array<{ rank: string; topic: string; direction: string; sources: string; primaryLink: string; confidence: string }>;
    summary: string;
  };
  sourcesBlock: {
    skills: Array<{ name: string; url: string }>;
    videoAuthors: Array<{ name: string; url: string }>;
    crossSources: Array<{ name: string; url: string }>;
    officialLinks: Array<{ name: string; url: string }>;
  };
}

/** 并发限流（简单实现，避免一次塞 N 个 Promise 把 LLM 限流打爆） */
async function pMap<T, R>(items: T[], concurrency: number, fn: (it: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) return;
      results[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 单次调用 + 1 次重试；最终失败抛错供上层降级 */
async function llmJsonWithRetry<T>(system: string, user: string, label: string, timeoutMs: number = LLM_TIMEOUT_PART_MS): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await llmJson<T>(system, user, timeoutMs);
    } catch (err) {
      logger.warn(`LLM ${label} attempt ${attempt} failed`, { error: (err as Error).message });
      if (attempt === 2) throw err;
    }
  }
  throw new Error('unreachable');
}

function step2aPrompt(
  selectedCount: number,
  snapshotText: string,
  globalTitles: string[],
) {
  return {
    system: `你是 AIHub 早报主笔的"骨架生成器"，只负责总览/封面/趋势三块，不输出 items/authors。

输出严格 JSON（不要任何额外字段、不要省略字段，缺则填空数组/空字符串）：

{
  "coverTitle": "AI 日报",
  "coverStats": [
    {"value": "${selectedCount}", "label": "条精选新闻"},
    {"value": "4", "label": "类信源家族"},
    {"value": "B4·C5·D2", "label": "置信度分布"}
  ],
  "intro": "本期要点开场白(≤60字)",
  "methodNote": "方法论说明(≤60字)",
  "sources": [
    {"name": "信源名", "description": "60-100字简介", "icon": "file-text|clipboard|comment|share|chart-bar", "color": "primary|secondary|accent"}
  ],
  "tlDr": ["TL;DR 第1条(≤60字)", "第2条", "第3条"],
  "confidenceLegend": [
    {"level": "A", "label": "A 极高", "color": "primary", "rule": "≥3 个相互独立的信源，且可追溯到一手官方材料"},
    {"level": "B", "label": "B 高", "color": "primary", "rule": "2 个独立信源，或 1 个信源 + 一手官方材料"},
    {"level": "C", "label": "C 中", "color": "secondary", "rule": "单一信源报道；含「多家转载同一家独家」（转载数量 ≠ 独立信源数量）"},
    {"level": "D", "label": "D 存疑", "color": "accent", "rule": "关键数字互相矛盾，或全部可溯源到同一原始信源且无官方确认"}
  ],
  "distribution": [
    {"level": "A", "count": 0},
    {"level": "B", "count": 4},
    {"level": "C", "count": 5},
    {"level": "D", "count": 2}
  ],
  "trends": [
    {"rank": 1, "title": "趋势标题 ≤20字", "description": "60-100字"},
    {"rank": 2, "title": "≤20字", "description": "60-100字"},
    {"rank": 3, "title": "≤20字", "description": "60-100字"}
  ]
}

【R-7 强约束】（漏了会被自动降级）：
- confidenceLegend 必须且只能 4 个（A/B/C/D 各 1）
- distribution 必须且只能 4 个（A/B/C/D 各 1）；如果某个置信度档位没有条目，count 填 0
- trends 必须且只能 3 个（rank=1/2/3）
- tlDr 至少 2 条（建议 3 条）`,
    user: `本周数据：${snapshotText}\n\n今日入选 ${selectedCount} 条新闻的标题列表：\n${globalTitles.map((t, i) => `[${i}] ${truncate(t, 60)}`).join('\n')}\n\n输出 cover + overview + trends 这三块的 JSON。`,
  };
}

function step2bItemPrompt(
  s: {
    title: string; source: string; summary: string; url: string;
    direction: DirectionKey; rank: number; crossSources?: string[];
  },
) {
  return {
    system: `你是 AIHub 早报的"单条新闻特写员"，每次只处理 1 条新闻。

输出严格 JSON（缺则填空数组/空字符串）：

{
  "summary": "60-180字详细摘要",
  "comment": "≤30字 AI 点评",
  "bulletPoints": ["3 句要点第1句(≤40字)", "第2句", "第3句"],
  "heroMetrics": [{"value": "770B", "label": "总参数", "sub": "较上代 295B"}],
  "whyMatters": "为何值得关注 100-200字(可空字符串)",
  "whyDoubtful": ["理由1", "理由2"],
  "comparison": "多方对比一句话(可空字符串)",
  "keyStats": [{"value": "300 万+", "label": "模型仓库", "color": "primary|secondary|accent"}],
  "primaryLinks": [{"source": "腾讯混元官方公众号", "url": "https://..."}],
  "hasPrimaryLink": true,
  "independentSources": 2,
  "totalReposts": 5,
  "confidenceLevel": "A|B|C|D"
}

要求：
1. heroMetrics 只在有硬数据时填，否则空数组
2. whyMatters 至少 100 字；为什么重要、为什么本期值得报道
3. whyDoubtful 仅 direction="rumor" 才填 2-4 条，否则空数组
4. primaryLinks 的 URL 必须是真实可达的链接，不要编造
5.【R-7 强约束】independentSources：单源新闻填 1，≥2 源填实际数；填 0 会被自动修复为 1
   注：独立信源需排除聚合 / 转载 / 同集团——多个域名但都是同一独家转载，不算多个独立信源
6.【R-7 强约束】confidenceLevel 必须是 A/B/C/D 之一；判定规则（按 ai-news-kit docs/03）：
   - A：≥3 个相互独立的信源，且可追溯到一手官方材料（官网 / 论文 / 公告 / 官方报告）
   - B：2 个独立信源，或 1 个信源 + 一手官方材料
   - C：单一信源报道；含「多家转载同一家独家」（转载数量 ≠ 独立信源数量）
   - D：关键数字互相矛盾，或全部可溯源到同一原始信源且无官方确认`,
    user: `标题：${s.title}\n方向：${s.direction} | 排名=${s.rank}\n来源：${s.source}\n摘要：${truncate(s.summary, 200)}\n链接：${s.url}\n${s.crossSources?.length ? `其他交叉来源：${s.crossSources.join('、')}` : '无其他交叉来源'}\n\n输出该条新闻的完整 JSON。`,
  };
}

function step2cPrompt(
  selectedCount: number,
  globalTitles: string[],
) {
  return {
    system: `你是 AIHub 早报的"信源透明生成器"，只输出 authors + verificationTable + sourcesBlock 三块。

输出严格 JSON：

{
  "authors": [
    {"name": "橘鸦Juya", "status": "ok", "statusText": "✅ 已取全文", "count": 22, "description": "60-100字", "url": "https://..."}
  ],
  "verificationTable": {
    "rows": [{"rank": "1", "topic": "议题", "direction": "Coding/具身/传闻", "sources": "2", "primaryLink": "✅ xxx", "confidence": "B"}],
    "summary": "30-80字 总结句"
  },
  "sourcesBlock": {
    "skills": [{"name": "AITNT 全球 AI 新闻", "url": "https://..."}],
    "videoAuthors": [{"name": "橘鸦Juya ✅ 已取全文", "url": "https://..."}],
    "crossSources": [{"name": "腾讯网", "url": "https://..."}],
    "officialLinks": [{"name": "Anthropic MHS", "url": "https://..."}]
  }
}

要求：
1. verificationTable.rows 数量等于今日入选条数（不多不少），按方向排序
2. confidence 只能 A/B/C/D
3. sourcesBlock 的 URL 必须是真实可达的链接（不要编造）
4.【R-7 强约束】primaryLink 必须是简短标记（≤15 字符）："✅ 官方" / "✅ 腾讯" / "✅ 一手" / "❌ 待补" / 等；
   不要写完整 URL（超长会被截断）；也不要写 source 完整名称（超过 6 字就简写）`,
    user: `今日入选 ${selectedCount} 条新闻：\n${globalTitles.map((t, i) => `[${i}] ${truncate(t, 50)}`).join('\n')}\n\n输出 authors + verificationTable + sourcesBlock 三块的 JSON。`,
  };
}

// ---------------------------------------------------------------------------
// 降级版（无 AI 文案）
// ---------------------------------------------------------------------------

function buildFallbackContent(collected: CollectResult): DailyReportContent {
  const items = collected.items.slice(0, MAX_ITEMS);
  const top = items[0];

  return {
    version: 4,
    date: collected.date,
    generatedAt: new Date().toISOString(),
    cover: {
      title: 'AI 日报',
      subtitle: top ? `${collected.date} · 今日头条已收录` : `${collected.date} · 今日收录较少`,
      emphasis: 'AI 新闻每日推送',
      stats: [
        { value: String(items.length), label: '条新闻', color: 'primary' },
        { value: '4', label: '类信源', color: 'secondary' },
        { value: '降级', label: 'LLM 暂不可用', color: 'accent' },
      ],
    },
    overview: {
      intro: collected.widened ? '今日收录新闻较少' : '以下为今日重要 AI 动态',
      methodNote: 'LLM 文案生成失败，展示原文摘要',
      sources: [
        { name: '聚合源', description: '多源聚合', icon: 'file-text', color: 'primary' },
        { name: '视频源', description: 'B 站 UP 主', icon: 'comment', color: 'secondary' },
        { name: '官方源', description: '官方一手', icon: 'check-circle', color: 'primary' },
        { name: '第三方', description: '交叉验证', icon: 'share', color: 'accent' },
      ],
      tlDr: [
        'LLM 总结暂不可用，请查看原始新闻列表',
        '降级版基于抓取原文生成，覆盖率受限于采集质量',
      ],
      confidenceLegend: [
        { level: 'A', label: 'A 极高', color: 'primary', rule: '≥3 个相互独立的信源，且可追溯到一手官方材料' },
        { level: 'B', label: 'B 高',   color: 'primary', rule: '2 个独立信源，或 1 个信源 + 一手官方材料' },
        { level: 'C', label: 'C 中',   color: 'secondary', rule: '单一信源报道；含「多家转载同一家独家」' },
        { level: 'D', label: 'D 存疑', color: 'accent', rule: '关键数字互相矛盾，或全部溯源到同一信源且无官方确认' },
      ],
      distribution: [
        { level: 'A', count: 0 },
        { level: 'B', count: items.length },
        { level: 'C', count: 0 },
        { level: 'D', count: 0 },
      ],
    },
    directions: buildFallbackDirections(items),
    items: items.map((it, i) => ({
      rank: i + 1,
      title: it.title,
      source: it.source,
      url: it.url,
      publishedAt: it.publishedAt
        ? new Date(it.publishedAt.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16)
        : '—',
      summary: it.summary,
      comment: '',
      category: it.category,
      direction: 'coding',
      confidenceLevel: 'B' as ConfidenceLevel,
      independentSources: 1,
      totalReposts: 0,
      hasPrimaryLink: false,
      primaryLinks: [],
      relatedSources: [],
      heroMetrics: [],
      whyMatters: null,
      whyDoubtful: [],
      comparison: null,
      keyStats: [],
      coverUrl: it.coverUrl ?? null,
      bulletPoints: [],
    })),
    authors: [
      { name: '橘鸦Juya', status: 'warn', statusText: '⚠️ 数据暂不可用', count: null, description: '降级版未取到 B 站数据', url: 'https://space.bilibili.com/285286947' },
    ],
    verificationTable: {
      rows: items.slice(0, 5).map((it, i) => ({
        rank: String(i + 1),
        topic: truncate(it.title, 30),
        direction: it.category ?? '—',
        // fallback 模式下：仅采集阶段信息可用，单源记 1
        sources: '1',
        // fallback 模式下：原始来源 URL 即"一手链接"，保 ✅ 标记
        primaryLink: it.url ? `✅ ${it.source ?? '原文'}` : '❌',
        // 置信度：fallback 阶段无法量化交叉验证，统一给 C（"单一信源"档位合理）
        confidence: 'C' as 'A' | 'B' | 'C' | 'D',
      })),
      summary: `降级版（LLM 暂不可用），基于原始抓取摘要展示共 ${items.length} 条。`,
    },
    trends: [
      { rank: 1, title: '数据暂不可用', description: 'LLM 总结功能暂不可用' },
      { rank: 2, title: '数据暂不可用', description: 'LLM 总结功能暂不可用' },
      { rank: 3, title: '数据暂不可用', description: 'LLM 总结功能暂不可用' },
    ],
    sources: {
      skills: [{ name: '聚合源', url: 'https://example.com' }],
      videoAuthors: [{ name: '橘鸦Juya', url: 'https://space.bilibili.com/285286947' }],
      crossSources: [],
      officialLinks: [],
    },
  };
}

function buildFallbackDirections(items: CollectResult['items']) {
  // 按 category 简单分方向（降级版）
  const codingItems = items.filter(i => /coding|代码|编程|agent|模型|llm/i.test(i.title + (i.category ?? '')));
  const embodiedItems = items.filter(i => /机器人|具身|robot|embod/i.test(i.title + (i.category ?? '')));
  return [
    {
      key: 'coding' as const,
      title: 'AI Coding 方向',
      subtitle: '智能编程相关',
      count: codingItems.length || items.length,
      summaryItems: (codingItems.length > 0 ? codingItems : items).slice(0, 5).map((it, i) => ({
        rank: i + 1,
        title: truncate(it.title, 30),
        oneLine: truncate(it.summary, 40),
        category: it.category ?? '其他',
        confidence: 'B' as ConfidenceLevel,
      })),
    },
    {
      key: 'embodied' as const,
      title: '具身智能方向',
      subtitle: 'Embodied AI 相关',
      count: embodiedItems.length,
      summaryItems: embodiedItems.slice(0, 5).map((it, i) => ({
        rank: i + 1,
        title: truncate(it.title, 30),
        oneLine: truncate(it.summary, 40),
        category: it.category ?? '其他',
        confidence: 'B' as ConfidenceLevel,
      })),
    },
  ].filter(d => d.count > 0);
}

// ---------------------------------------------------------------------------
// Phase 辅助
// ---------------------------------------------------------------------------

function setPhase(date: string, phase: string): Promise<void> {
  return prisma.dailyReport
    .update({ where: { date }, data: { phase } })
    .then(() => undefined)
    .catch((err) => {
      logger.warn('setPhase failed', { date, phase, error: (err as Error).message });
    });
}

// ---------------------------------------------------------------------------
// 主流程（幂等）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Brief → DailyReportContent 适配器（draft 路径用）
//   输入：machine draft Brief（来自 draft-brief.ts）
//   输出：v4 schema 的 DailyReportContent，但每个 pick 加 " [机器草稿]" 标注
//
// 设计：保持 v4 schema 兼容，build-pptx / router / 前端不用为 draft 单独写路径
// 唯一差别：degraded=true + reason 含 "机器草稿" 字样 + cover.subtitle 显式标注
// ---------------------------------------------------------------------------

import { parseBriefLoose, type Brief } from './brief-schema';

function briefToV4(brief: Brief, reason: DraftReason, collectedDate: string): DailyReportContent {
  const draftPicks = brief.picks.map((p, idx) => ({
    rank: p.no,
    title: p.title,
    source: p.sources[0]?.name ?? '未知源',
    url: p.sources[0]?.url ?? '',
    publishedAt: p.publishedAt,
    summary: p.event,
    comment: '机器草稿：未做 LLM 判断，仅陈述事实',
    category: p.topic,
    direction: (p.topic === '具身智能' ? 'embodied' : 'coding') as DirectionKey,
    confidenceLevel: p.lv as ConfidenceLevel,
    independentSources: 1, // 草稿未做交叉验证
    totalReposts: 0,
    hasPrimaryLink: p.sources[0]?.isPrimary ?? false,
    primaryLinks: p.sources.filter(s => s.isPrimary).map(s => ({ source: s.name, url: s.url })),
    relatedSources: p.sources.slice(1).map(s => s.name),
    heroMetrics: [],
    whyMatters: null,
    whyDoubtful: ['机器草稿：未做深度判断'],
    comparison: null,
    keyStats: [],
    coverUrl: null,
    bulletPoints: p.keyFacts,
  }));

  // 构造 v4 overview 需要的 confidenceLegend（4 项）
  const confidenceLegend4 = brief.confidenceScale.map(s => ({
    level: s.lv,
    label: s.name,
    rule: s.rule,
    color: (s.lv === 'A' ? 'primary' : s.lv === 'B' ? 'secondary' : s.lv === 'C' ? 'accent' : 'accent') as 'primary' | 'secondary' | 'accent',
  }));

  // 置信度分布统计
  const distCount = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of draftPicks) distCount[p.confidenceLevel]++;

  return {
    version: 4,
    date: collectedDate,
    generatedAt: new Date().toISOString(),
    cover: {
      title: 'AI 日报 · 机器草稿',
      subtitle: `${collectedDate} · LLM 不可用，降级为机器草稿（${reason}）`,
      emphasis: 'Draft Mode',
      stats: [
        { value: String(draftPicks.length), label: '条草稿', color: 'accent' as const },
        { value: 'B', label: '评级上限', color: 'secondary' as const },
        { value: '草稿', label: '未经人工核验', color: 'accent' as const },
      ],
    },
    overview: {
      intro: brief.headline,
      methodNote: `机器草稿模式：${reason}。why/conflicts 留空，需要人工核验。`,
      sources: [
        { name: '采集源', description: '已采集新闻', icon: 'file-text', color: 'primary' as const },
        { name: '机器处理', description: '未调 LLM', icon: 'cog', color: 'secondary' as const },
        { name: '人工待核', description: '需人工核验', icon: 'user', color: 'accent' as const },
        { name: '降级模式', description: '仅陈述事实', icon: 'info-circle', color: 'accent' as const },
      ],
      tlDr: [
        '本份早报为机器草稿，未经 LLM 判断',
        'why/conflicts 字段留空，需人工核验',
        `触发原因：${reason}`,
      ],
      confidenceLegend: confidenceLegend4,
      distribution: [
        { level: 'A', count: distCount.A },
        { level: 'B', count: distCount.B },
        { level: 'C', count: distCount.C },
        { level: 'D', count: distCount.D },
      ],
    },
    items: draftPicks.length >= 3 ? draftPicks : [
      ...draftPicks,
      ...Array.from({ length: Math.max(0, 3 - draftPicks.length) }, (_, i) => ({
        rank: draftPicks.length + i + 1,
        title: '（暂无）',
        source: '—',
        url: '',
        publishedAt: '—',
        summary: '当日未采集到足够新闻',
        comment: '',
        category: 'AI Coding',
        direction: 'coding' as DirectionKey,
        confidenceLevel: 'D' as ConfidenceLevel,
        independentSources: 0,
        totalReposts: 0,
        hasPrimaryLink: false,
        primaryLinks: [],
        relatedSources: [],
        heroMetrics: [],
        whyMatters: null,
        whyDoubtful: [],
        comparison: null,
        keyStats: [],
        coverUrl: null,
        bulletPoints: [],
      })),
    ],
    directions: [],
    trends: [
      { rank: 1, title: '待补充', description: '机器草稿未分析趋势' },
      { rank: 2, title: '待补充', description: '需要人工核验后补全' },
      { rank: 3, title: '待补充', description: '建议核查后再发布' },
    ],
    verificationTable: {
      rows: draftPicks.slice(0, Math.max(5, draftPicks.length)).map((s, i) => ({
        rank: String(i + 1),
        topic: s.title.slice(0, 30),
        direction: s.direction,
        sources: '1',
        primaryLink: s.hasPrimaryLink ? '✅ 原文' : '❌',
        confidence: s.confidenceLevel,
      })),
      summary: '机器草稿：未做交叉验证',
    },
    authors: [
      { name: '橘鸦Juya', status: 'warn', statusText: '草稿模式', count: null, description: '机器草稿模式', url: 'https://space.bilibili.com/285286947' },
    ],
    sources: {
      skills: [],
      videoAuthors: [],
      crossSources: [],
      officialLinks: [],
    },
  };
}

export async function generateDailyReport(
  now: Date = new Date(),
  windowHour = 8,
  /** Batch 3：触发模式
   *  - 'auto'  ：默认，走 LLM → 失败降级为草稿
   *  - 'agent' ：强制走 LLM，失败 fallback（保留旧行为，cron 用）
   *  - 'draft' ：用户显式选草稿，跳过 LLM
   */
  mode: 'auto' | 'agent' | 'draft' = 'auto',
): Promise<{
  date: string;
  status: string;
  degraded: boolean;
  phase?: string;
  mode?: 'auto' | 'agent' | 'draft';
}> {
  const date = beijingDateString(now);
  const t0 = Date.now();

  const existing = await prisma.dailyReport.findUnique({ where: { date } });
  if (existing?.status === 'ready') {
    return { date, status: 'ready', degraded: existing.degraded, phase: 'done' };
  }
  // BUG-F 修复（2026-09-13）：regenerate 事务里 deleteMany + create({phase:'pending', updatedAt=now()})
  //   后立刻调 generate()。原逻辑用 status+updatedAt<10min 判并发 → 命中窗口 → 早返回 → regenerate 啥也没干，row 永远卡在 phase='pending'。
  // 修复：phase='pending' 视为"regenerate 显式让位" → 接管；其它 phase（collect/select/...）才算"被别人占用"。
  // 双重保险：cron 兜底时也能识别卡死的 pending → 主动接管。
  if (
    existing?.status === 'generating' &&
    existing.phase !== 'pending' &&
    Date.now() - existing.updatedAt.getTime() < 10 * 60 * 1000
  ) {
    return { date, status: 'generating', degraded: false, phase: existing.phase ?? 'collect' };
  }

  await prisma.dailyReport.upsert({
    where: { date },
    update: { status: 'generating', phase: 'collect', error: null },
    create: { date, status: 'generating', phase: 'collect' },
  });

  try {
    setPhase(date, 'collect');
    const collected = await collectDailyNews(now, windowHour);

    let content: DailyReportContent;
    let degraded = false;
    let degradedReason: string | undefined;

    if (collected.items.length === 0) {
      content = buildFallbackContent(collected);
      await prisma.dailyReport.update({
        where: { date },
        data: {
          status: 'ready',
          content: JSON.stringify(content),
          degraded: true,
          phase: null,
          error: 'LLM文案生成降级：当日候选新闻为空',
        },
      });
      logger.info('daily report ready (fallback, no items)', { date, duration: Date.now() - t0 });
      return { date, status: 'ready', degraded: true, phase: undefined, mode };
    }

    // Batch 3：用户显式选 draft → 直接走草稿，跳过 LLM
    if (mode === 'draft') {
      const draft = buildDraftBrief({ news: collected.items, date, reason: 'USER_FORCED' });
      const draftContent = briefToV4(draft, 'USER_FORCED', date);
      const safe = enforceLimits(DailyReportContentSchema.parse(draftContent));
      await prisma.dailyReport.update({
        where: { date },
        data: {
          status: 'ready',
          content: JSON.stringify(safe),
          degraded: true,
          phase: null,
          error: '机器草稿模式（USER_FORCED），未调用 LLM',
        },
      });
      logger.info('daily report ready (user-forced draft)', { date, duration: Date.now() - t0 });
      return { date, status: 'ready', degraded: true, phase: undefined, mode };
    }

    try {
      const result = await generateWithLLM(collected, date);
      content = result.content;
      degraded = result.degraded;
      if (degraded && result.errorReason) {
        degradedReason = result.errorReason;
      }
    } catch (llmErr) {
      // Batch 3 升级：LLM 抛错（不是 degrade）→ 草稿降级（不是 fallback）
      const llmMsg = (llmErr as Error).message;
      logger.warn('daily report LLM failed, falling back to draft', { date, error: llmMsg });
      const draft = buildDraftBrief({ news: collected.items, date, reason: 'LLM_FAILED' });
      content = briefToV4(draft, 'LLM_FAILED', date);
      degraded = true;
      degradedReason = `LLM 调用失败（${llmMsg.slice(0, 200)}），已降级为机器草稿`;
    }

    // C2 闭环：LLM 输出 schema 校验 —— 失败降级而不是 failed
    //   - 之前：DailyReportContentSchema.parse(content) 抛错 → 整个生成流程进 failed 状态
    //   - 现在：失败时用最简 fallback content 继续写库，标 degraded
    // 这条比 C1 更靠前，因为 schema 不合法就跑不到 QA Gate
    // C2 + R-7 闭环：先自动修复 LLM 常见 schema 违反 → 再 schema parse
    //   - 修复器（postprocess.repairContent）处理 6 类常见违规：
    //     distribution/confidenceLegend 元素数不够、independentSources≤0、
    //     primaryLink 超长、trends 不为 3、tlDr <2
    //   - 之前：LLM 偶尔违反 schema → 整个流程进 degraded（用户看到降级版）
    //   - 现在：自动补全 → 大多数情况下能跑通真 LLM 文案版
    let safe: DailyReportContent;
    try {
      const repaired = repairContent(content as DailyReportContent);
      safe = enforceLimits(DailyReportContentSchema.parse(repaired));
    } catch (parseErr) {
      const parseMsg = (parseErr as Error).message;
      logger.error('daily report schema parse failed (after repair), using fallback', {
        date,
        error: parseMsg,
        stack: (parseErr as Error).stack?.split('\n').slice(0, 5).join('\n'),
      });
      // Batch 3 升级：schema parse 失败 → 草稿降级（不是 fallback）
      const draft = buildDraftBrief({ news: collected.items, date, reason: 'VALIDATION_ERROR' });
      const draftContent = briefToV4(draft, 'VALIDATION_ERROR', date);
      safe = enforceLimits(DailyReportContentSchema.parse(draftContent));
      degraded = true;
      degradedReason = `LLM 输出 schema 不合法（${parseMsg.slice(0, 200)}），已回退到机器草稿`;
    }

    // C1 闭环：QA 守门员——把"PPT 跑出来了但很丑"变成可观测
    //   - lint error > 0 → 升级 degraded = true + 把 reason 写进 error 字段
    //   - warn > 3       → 轻度告警，reason 写入 error（不升级 degraded）
    //   - 通过           → 不动
    // 永远不阻断生成（用户看到 PPT 比看不到强）
    setPhase(date, 'qa');
    const qa = runLayoutQA(safe);
    const layoutReason = upgradeDegradedReason(qa);
    if (layoutReason) {
      logger.warn('daily report layout QA failed', {
        date,
        errors: qa.issues.filter((i) => i.level === 'error').length,
        warns: qa.issues.filter((i) => i.level === 'warn').length,
        reason: layoutReason,
        pageCount: qa.pageCount,
        durationMs: qa.durationMs,
      });
      degraded = true;
      degradedReason = degradedReason
        ? `${degradedReason} ｜ ${layoutReason}`
        : layoutReason;
    } else {
      logger.info('daily report layout QA passed', {
        date,
        pageCount: qa.pageCount,
        durationMs: qa.durationMs,
      });
    }

    setPhase(date, 'persist');
    await prisma.dailyReport.update({
      where: { date },
      data: {
        status: 'ready',
        content: JSON.stringify(safe),
        degraded,
        phase: null,
        error: degraded ? (degradedReason || 'LLM文案生成降级') : null,
      },
    });
    logger.info('daily report ready', { date, degraded, items: safe.items.length, duration: Date.now() - t0 });
    return { date, status: 'ready', degraded, phase: 'done' };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error('daily report failed', { date, error: msg, phase: 'persist', duration: Date.now() - t0 });
    await prisma.dailyReport.update({
      where: { date },
      data: { status: 'failed', phase: null },
    });
    return { date, status: 'failed', degraded: false };
  }
}

/**
 * 两步 LLM：Step 1 选题分类 → Step 2 富字段生成
 */
async function generateWithLLM(
  collected: CollectResult,
  date: string,
): Promise<{ content: DailyReportContent; degraded: boolean; errorReason?: string }> {
  const tryGenerate = async (): Promise<DailyReportContent> => {
    // ---- Step 1 选题 + 方向分类 ----
    await setPhase(date, 'select');
    const candidates = collected.items.slice(0, CANDIDATE_CAP);
    const candidatesWithSources = candidates.map(c => ({
      ...c,
      crossSources: candidates
        .filter(other => other !== c && isSameNews({ title: c.title, url: c.url }, { title: other.title, url: other.url }))
        .map(other => other.source),
      hasCover: Boolean(c.coverUrl),
    }));

    // Step 1 选题：用全套 90s 兜底（候选 30 条偶尔需要长上下文）
    const sel = await llmJsonWithRetry<SelectionResult>(
      ...(() => { const p = step1Prompt(candidatesWithSources); return [p.system, p.user] as const; })(),
      'select',
      LLM_TIMEOUT_MS,
    );

    const selectedRaw = (sel.selected ?? [])
      .filter(s => Number.isInteger(s.index) && s.index >= 0 && s.index < candidates.length)
      .slice(0, MAX_ITEMS);
    const selected = selectedRaw.length >= 3
      ? selectedRaw.map(s => ({ ...s, item: candidatesWithSources[s.index] }))
      : candidatesWithSources.slice(0, MIN_ITEMS).map((item, i) => ({
          index: i, direction: 'coding' as DirectionKey, rank: i + 1, item,
        }));

    // ---- Step 2 v5：3 段并行 ----
    await setPhase(date, '2a');
    const snapshot = collected.snapshot;
    const snapshotText = `今日新增 ${snapshot.todayTotal} 条；近7天 ${snapshot.weekSeries.map(d => `${d.date.slice(5)}:${d.count}`).join('，')}`;
    const globalTitles = selected.map(s => s.item.title);

    // 2a 骨架（先跑，需要 selectedCount）
    const pa = step2aPrompt(selected.length, snapshotText, globalTitles);
    const partA = await llmJsonWithRetry<WriteResultPartA>(pa.system, pa.user, 'write-2a');

    // 2b items（每条独立并发）+ 2c 元数据（与 2b 并发）
    await setPhase(date, '2b');
    const itemsFor2b = selected.map(s => ({
      title: s.item.title,
      source: s.item.source,
      summary: s.item.summary,
      url: s.item.url,
      direction: s.direction,
      rank: s.rank,
      crossSources: s.item.crossSources,
    }));

    const partCP = step2cPrompt(selected.length, globalTitles);
    // 提示前端进入 2c（短暂，因为 2b 并发）
    setPhase(date, '2c');

    const [itemResults, partC] = await Promise.all([
      pMap(itemsFor2b, LLM_CONCURRENCY, async (s, idx) => {
        try {
          const pi = step2bItemPrompt(s);
          const r = await llmJsonWithRetry<WriteResultItemV5>(pi.system, pi.user, `item-${idx}`);
          return { ok: true as const, index: idx, data: r };
        } catch (err) {
          logger.warn('item LLM failed, using fallback', { idx, title: s.title.slice(0, 30), error: (err as Error).message });
          return { ok: false as const, index: idx, data: { index: idx, summary: '', comment: '', bulletPoints: [], heroMetrics: [], whyMatters: '', whyDoubtful: [], comparison: '', keyStats: [], primaryLinks: [], hasPrimaryLink: false, independentSources: 0, totalReposts: 0, confidenceLevel: 'B' }, err };
        }
      }),
      llmJsonWithRetry<WriteResultPartC>(partCP.system, partCP.user, 'write-2c').catch(err => {
        logger.warn('partC LLM failed, using fallback', { error: (err as Error).message });
        return null;
      }),
    ]);

    // 合并 items：失败的用 fallback，其余用 LLM 结果
    const writeItems: WriteResultItemV5[] = itemResults.map(r =>
      r.ok
        ? r.data
        : { ...r.data, summary: itemsFor2b[r.index].summary },
    );

    // BUG-G 修复（2026-09-13）：partC fallback 必须用 selected 构造 rows
    //   - 之前：rows=[] → schema min(5) 失败 → 整个流程 degraded
    //   - 现在：用 selected[i]（来自 step1）构造 rows，确保 ≥5 条（schema 限制）
    const partCFallback: WriteResultPartC = partC ?? {
      authors: [
        { name: '橘鸦Juya', status: 'warn', statusText: '⚠️ 数据暂不可用', count: null, description: '当前不可用', url: 'https://space.bilibili.com/285286947' },
      ],
      verificationTable: {
        rows: selected.slice(0, Math.max(5, selected.length)).map((s, i) => ({
          rank: String(i + 1),
          topic: s.item.title ?? '',
          direction: s.direction ?? 'coding',
          sources: '1',  // fallback 阶段无法量化交叉验证
          primaryLink: s.item.url ? '✅ 原文' : '❌',
          confidence: 'C' as const,
        })),
        summary: 'LLM 信源透明块暂不可用，已用原始数据构造 fallback。',
      },
      sourcesBlock: { skills: [], videoAuthors: [], crossSources: [], officialLinks: [] },
    };

    return assembleV5Content(collected, sel, partA, writeItems, selected, partCFallback);
  };

  try {
    return { content: await tryGenerate(), degraded: false };
  } catch (firstErr) {
    const firstMsg = (firstErr as Error).message;
    logger.warn('daily report LLM first attempt failed, retrying', { error: firstMsg });
    try {
      return { content: await tryGenerate(), degraded: false };
    } catch (secondErr) {
      const secondMsg = (secondErr as Error).message;
      logger.warn('daily report LLM retry failed, fallback', { error: secondMsg });
      return {
        content: buildFallbackContent(collected),
        degraded: true,
        errorReason: `LLM调用失败：${firstMsg} / 重试：${secondMsg}`,
      };
    }
  }
}

/** 组装 v5 内容（合并 3 段 LLM 输出与采集数据） */
function assembleV5Content(
  collected: CollectResult,
  sel: SelectionResult,
  partA: WriteResultPartA,
  writeItems: WriteResultItemV5[],
  selected: Array<{
    index: number;
    direction: DirectionKey;
    rank: number;
    item: { title: string; source: string; summary: string; url: string; category: string | null; publishedAt: Date | null; crossSources?: string[]; coverUrl?: string | null };
  }>,
  partC: WriteResultPartC,
): DailyReportContent {
  // Items: 按 step1 的顺序，逐个合并 LLM 富字段
  const items = selected.map((s, i) => {
    const w = writeItems[i] ?? {} as WriteResultItemV5;
    const computedConfidence = computeConfidenceLevel({ source: s.item.source, crossSources: s.item.crossSources });
    return {
      rank: s.rank,
      title: s.item.title,
      source: s.item.source,
      url: s.item.url,
      publishedAt: s.item.publishedAt
        ? new Date(s.item.publishedAt.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16)
        : '—',
      summary: w.summary || s.item.summary,
      comment: truncate(w.comment ?? '', LIMITS.comment),
      category: s.item.category,
      direction: s.direction,
      confidenceLevel: (['A', 'B', 'C', 'D'].includes(w.confidenceLevel) ? w.confidenceLevel : computedConfidence) as ConfidenceLevel,
      independentSources: Number.isInteger(w.independentSources) ? w.independentSources : new Set([s.item.source, ...(s.item.crossSources ?? [])]).size,
      totalReposts: Number.isInteger(w.totalReposts) ? w.totalReposts : (s.item.crossSources?.length ?? 0),
      hasPrimaryLink: Boolean(w.hasPrimaryLink ?? (w.primaryLinks?.length ?? 0) > 0),
      primaryLinks: Array.isArray(w.primaryLinks) ? w.primaryLinks.filter(p => p?.source && p?.url) : [],
      relatedSources: (s.item.crossSources ?? []).filter(src => src !== s.item.source),
      heroMetrics: Array.isArray(w.heroMetrics) ? w.heroMetrics.slice(0, 4).filter(m => m?.value && m?.label) : [],
      whyMatters: w.whyMatters || null,
      whyDoubtful: Array.isArray(w.whyDoubtful) ? w.whyDoubtful.slice(0, 4) : [],
      comparison: w.comparison || null,
      keyStats: Array.isArray(w.keyStats)
        ? w.keyStats.slice(0, 4).map(s => ({
            value: s.value || '',
            label: s.label || '',
            color: (['primary', 'secondary', 'accent'].includes(s.color) ? s.color : 'primary') as 'primary' | 'secondary' | 'accent',
          }))
        : [],
      coverUrl: s.item.coverUrl ?? null,
      bulletPoints: Array.isArray(w.bulletPoints)
        ? w.bulletPoints.filter(p => typeof p === 'string' && p.trim().length > 0).slice(0, 4).map(p => truncate(p, 60))
        : [],
    };
  });

  // 构造 directions
  const directionKeys: Array<'coding' | 'embodied'> = ['coding', 'embodied'];
  const directions: Array<{ key: 'coding' | 'embodied'; title: string; subtitle: string; count: number; summaryItems: Array<{ rank: number; title: string; oneLine: string; category: string; confidence: 'A' | 'B' | 'C' | 'D' }> }> = directionKeys
    .map(k => {
      const dirItems = items.filter(i => i.direction === k);
      if (dirItems.length === 0) return null;
      const titles: Record<'coding' | 'embodied', string> = {
        coding: 'AI Coding 方向 · 智能编程',
        embodied: '具身智能方向 · Embodied AI',
      };
      const subs: Record<'coding' | 'embodied', string> = {
        coding: '从「生成代码」到「可证明正确」「成本可控」',
        embodied: '通用 Agent 溢出到物理世界',
      };
      return {
        key: k,
        title: titles[k],
        subtitle: subs[k],
        count: dirItems.length,
        summaryItems: dirItems.map(it => ({
          rank: it.rank,
          title: truncate(it.title, 28),
          oneLine: truncate(it.summary, 40),
          category: it.category ?? '',
          confidence: it.confidenceLevel,
        })),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const COLOR_CYCLE: Array<'primary' | 'secondary' | 'accent'> = ['primary', 'secondary', 'accent'];
  const coverStats: Array<{ value: string; label: string; color: 'primary' | 'secondary' | 'accent' }> = (partA.coverStats ?? []).length === 3
    ? partA.coverStats.map((s, i) => ({ value: s.value, label: s.label, color: COLOR_CYCLE[i] }))
    : [
        { value: String(items.length), label: '条精选新闻', color: 'primary' as const },
        { value: '4', label: '类信源家族', color: 'secondary' as const },
        { value: `${distributionLabel(items)}`, label: '置信度分布', color: 'accent' as const },
      ];

  return {
    version: 4,
    date: collected.date,
    generatedAt: new Date().toISOString(),
    cover: {
      title: partA.coverTitle || 'AI 日报',
      subtitle: sel.subtitle || `${collected.date} · AI 新闻每日推送`,
      emphasis: sel.emphasis || 'AI 新闻每日推送',
      stats: coverStats,
    },
    overview: {
      intro: partA.intro || '本期要点总览',
      methodNote: partA.methodNote || '刻意区分「转载数量」与「独立信源数量」',
      sources: (partA.sources ?? []).slice(0, 4).map(s => ({
        name: s.name || '',
        description: s.description || '',
        icon: s.icon || 'file-text',
        color: (['primary', 'secondary', 'accent'].includes(s.color) ? s.color : 'primary') as 'primary' | 'secondary' | 'accent',
      })),
      tlDr: (partA.tlDr ?? []).slice(0, 4).filter(Boolean),
      confidenceLegend: (partA.confidenceLegend ?? []).slice(0, 4).map(c => ({
        level: (['A', 'B', 'C', 'D'].includes(c.level) ? c.level : 'B') as 'A' | 'B' | 'C' | 'D',
        label: c.label || '',
        color: (['primary', 'secondary', 'accent'].includes(c.color) ? c.color : 'primary') as 'primary' | 'secondary' | 'accent',
        rule: c.rule || '',
      })),
      distribution: (partA.distribution ?? [])
        .filter(d => ['A', 'B', 'C', 'D'].includes(d.level))
        .map(d => ({ level: d.level as 'A' | 'B' | 'C' | 'D', count: Number(d.count) || 0 })),
    },
    directions,
    items,
    authors: (partC.authors ?? []).slice(0, 4),
    verificationTable: {
      rows: (partC.verificationTable?.rows ?? []).slice(0, 20).map(r => ({
        rank: r.rank || '',
        topic: r.topic || '',
        direction: r.direction || '',
        sources: r.sources || '',
        primaryLink: r.primaryLink || '',
        confidence: (['A', 'B', 'C', 'D'].includes(r.confidence) ? r.confidence : 'C') as 'A' | 'B' | 'C' | 'D',
      })),
      summary: partC.verificationTable?.summary || '本期置信度分布如上。',
    },
    trends: (partA.trends ?? []).slice(0, 3),
    sources: {
      skills: partC.sourcesBlock?.skills ?? [],
      videoAuthors: partC.sourcesBlock?.videoAuthors ?? [],
      crossSources: partC.sourcesBlock?.crossSources ?? [],
      officialLinks: partC.sourcesBlock?.officialLinks ?? [],
    },
  };
}

function distributionLabel(items: Array<{ confidenceLevel: ConfidenceLevel }>): string {
  const map: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  items.forEach(i => { map[i.confidenceLevel] = (map[i.confidenceLevel] ?? 0) + 1; });
  return `${map.B ?? 0}B·${map.C ?? 0}C·${map.D ?? 0}D`;
}
