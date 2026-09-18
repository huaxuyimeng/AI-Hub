/**
 * 早报 PPTX 双引擎 CLI
 * 路径：scripts/briefing-pptx.ts
 *
 * 用法：
 *   npx tsx scripts/briefing-pptx.ts lint   [--date=2026-09-15]   # 只跑 lint 并打印报告
 *   npx tsx scripts/briefing-pptx.ts render [--date=2026-09-15]   # 走生产调度渲染 PPTX
 *   npx tsx scripts/briefing-pptx.ts shadow [--date=2026-09-15]   # 双引擎比对
 *   npx tsx scripts/briefing-pptx.ts from-json --in=path.json [--out=path.pptx]
 *
 * 产物命名：out/pptx/AIHub-AI早报-<date>.<legacy|engine>.pptx
 *   （引擎后缀是必需的：legacy 与 engine 两套产物若同名会互相覆盖）
 *
 * 内容来源优先级：
 *   1. --in=xxx.json 指定的文件
 *   2. --date=YYYY-MM-DD 从 SQLite 读 dailyReport.content
 *   3. 都没有 → 用内置 fixture（仅用于冒烟）
 *
 * 设计意图：这是重构期间验证"新引擎能不能产出可用 PPT"的**唯一手工入口**。
 * 它走的是 lib/build-pptx-dispatch.ts，也就是生产 router 走的同一条路径 ——
 * 所以 CLI 跑通就等于生产链路跑通。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  buildBriefingPptxAuto,
  lintBriefingContent,
} from '../src/features/daily-briefing/lib/build-pptx-dispatch';
import { briefingFileName } from '../src/features/daily-briefing/lib/render-pptx';
import { DailyReportContentSchema } from '../src/features/daily-briefing/lib/types';
import type { DailyReportContent } from '../src/features/daily-briefing/lib/types';

// ============================================================================
// 参数
// ============================================================================

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    // 用 rsplit：值本身可能含 '='（如 URL、时间戳）
    const idx = raw.indexOf('=');
    if (idx > 0) {
      out[raw.slice(0, idx)] = raw.slice(idx + 1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(3));
const cmd = process.argv[2] ?? 'lint';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================================
// 内容装载
// ============================================================================

async function loadFromDb(date: string): Promise<DailyReportContent | null> {
  const dbPath = join(process.cwd(), 'prisma', 'dev.db');
  if (!existsSync(dbPath)) {
    console.warn(`⚠️  未找到 ${dbPath}，跳过 DB 读取`);
    return null;
  }
  try {
    // 动态 import，避免 CLI 在无 prisma 生成物时崩
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const row = await prisma.dailyReport.findUnique({
      where: { date },
      select: { content: true, status: true, theme: true, degraded: true },
    });
    await prisma.$disconnect();

    if (!row) {
      console.warn(`⚠️  DB 中没有 ${date} 的记录`);
      return null;
    }
    if (!row.content) {
      console.warn(`⚠️  ${date} 的记录没有 content（status=${row.status}）`);
      return null;
    }
    const parsed = DailyReportContentSchema.safeParse(JSON.parse(row.content));
    if (!parsed.success) {
      console.warn(`⚠️  ${date} 的 content 不是 v4 schema，跳过`);
      return null;
    }
    console.log(`📥 已从 DB 读取 ${date}（theme=${row.theme}, degraded=${row.degraded}）`);
    return parsed.data;
  } catch (err) {
    console.warn(`⚠️  DB 读取失败：${(err as Error).message}`);
    return null;
  }
}

function loadFromJson(path: string): DailyReportContent | null {
  if (!existsSync(path)) {
    console.error(`❌ 文件不存在：${path}`);
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const parsed = DailyReportContentSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`❌ ${path} 不满足 v4 schema：`);
      console.error(
        parsed.error.issues
          .slice(0, 5)
          .map((i) => `   - ${i.path.join('.')}: ${i.message}`)
          .join('\n'),
      );
      return null;
    }
    console.log(`📥 已从文件读取：${path}`);
    return parsed.data;
  } catch (err) {
    console.error(`❌ 解析失败：${(err as Error).message}`);
    return null;
  }
}

/** 最小可用 fixture（仅冒烟；真实验证请用 --date 或 --in）
 *  注意：必须满足 v4 schema 的硬性下限 —— items≥3、authors≥1、verification rows≥5、
 *  trends=3、overview 的 sources/legend/distribution 各=4、tlDr≥2。
 *  2026-09-16 深扫发现旧 fixture 只有 1 条目/1 验证行，冒烟 lint 必挂，已重写。
 */
function fixture(date: string): DailyReportContent {
  const mkItem = (rank: number, direction: 'coding' | 'embodied' | 'rumor', lv: 'A' | 'B' | 'C' | 'D') => ({
    rank,
    title: `fixture 条目 ${rank}`,
    source: '冒烟信源',
    url: 'https://example.com/f',
    publishedAt: `${date} 10:00`,
    summary: '这是一条 fixture 数据，用于验证 plan → lint → render 链路是否可用。',
    comment: '冒烟点评',
    category: '冒烟',
    direction,
    confidenceLevel: lv,
    independentSources: 1,
    totalReposts: 0,
    hasPrimaryLink: false,
    primaryLinks: [],
    relatedSources: [],
    heroMetrics: [],
    whyMatters: '验证渲染链路是否可用',
    whyDoubtful: direction === 'rumor' ? ['单一信源，未获交叉印证'] : [],
    comparison: null,
    keyStats: [],
    coverUrl: null,
    bulletPoints: [],
  });

  return {
    version: 4,
    date,
    generatedAt: new Date().toISOString(),
    cover: {
      title: 'AI 日报',
      subtitle: `${date} · 冒烟`,
      emphasis: 'fixture 数据，请勿作为正式产物',
      stats: [
        { value: '3', label: '条精选新闻', color: 'primary' as const },
        { value: '1', label: '类信源家族', color: 'secondary' as const },
        { value: 'C2·D1', label: '置信度分布', color: 'accent' as const },
      ],
    },
    overview: {
      intro: 'fixture 内容',
      methodNote: 'fixture 内容',
      sources: [
        { name: '信源甲', description: '冒烟', icon: 'fa-solid fa-a', color: 'primary' as const },
        { name: '信源乙', description: '冒烟', icon: 'fa-solid fa-b', color: 'secondary' as const },
        { name: '信源丙', description: '冒烟', icon: 'fa-solid fa-c', color: 'accent' as const },
        { name: '信源丁', description: '冒烟', icon: 'fa-solid fa-d', color: 'primary' as const },
      ],
      tlDr: ['fixture 内容：验证渲染链路', 'fixture 内容：第二句'],
      confidenceLegend: (['A', 'B', 'C', 'D'] as const).map((level) => ({
        level,
        label: `${level} 级`,
        color: (level === 'C' ? 'secondary' : level === 'D' ? 'accent' : 'primary') as 'primary' | 'secondary' | 'accent',
        rule: '冒烟规则',
      })),
      distribution: [
        { level: 'A' as const, count: 0 },
        { level: 'B' as const, count: 0 },
        { level: 'C' as const, count: 2 },
        { level: 'D' as const, count: 1 },
      ],
    },
    directions: [
      {
        key: 'coding' as const,
        title: 'AI Coding 方向',
        subtitle: 'fixture',
        count: 2,
        summaryItems: [
          { rank: 1, title: 'fixture 条目 1', oneLine: '用于冒烟', category: '冒烟', confidence: 'C' as const },
          { rank: 2, title: 'fixture 条目 2', oneLine: '用于冒烟', category: '冒烟', confidence: 'C' as const },
        ],
      },
    ],
    items: [
      mkItem(1, 'coding', 'C'),
      mkItem(2, 'coding', 'C'),
      mkItem(3, 'rumor', 'D'),
    ],
    authors: [
      {
        name: 'fixture作者甲',
        status: 'ok' as const,
        statusText: '✅ 已取全文',
        count: 1,
        description: 'fixture 作者，用于冒烟验证作者页布局。',
        url: 'https://example.com/a',
      },
      {
        name: 'fixture作者乙',
        status: 'warn' as const,
        statusText: '⚠️ 未取全文',
        count: null,
        description: 'fixture 作者，用于冒烟验证作者页布局。',
        url: 'https://example.com/b',
      },
    ],
    verificationTable: {
      rows: [1, 2, 3, 4, 5].map((n) => ({
        rank: String(n),
        topic: `fixture 话题 ${n}`,
        direction: 'Coding',
        sources: '1',
        primaryLink: '❌',
        confidence: (n <= 3 ? 'C' : 'D') as 'C' | 'D',
      })),
      summary: 'fixture 验证表总结',
    },
    trends: [1, 2, 3].map((n) => ({
      rank: n,
      title: `fixture 趋势 ${n}`,
      description: '用于冒烟',
    })),
    sources: {
      skills: [{ name: '冒烟技能源', url: 'https://example.com/s' }],
      videoAuthors: [],
      crossSources: [],
      officialLinks: [],
    },
  };
}

async function loadContent(): Promise<DailyReportContent | null> {
  if (args['--in']) {
    return loadFromJson(resolve(args['--in']));
  }
  if (args['--date']) {
    if (!DATE_RE.test(args['--date'])) {
      console.error(`❌ --date 格式错误：${args['--date']}（应为 YYYY-MM-DD）`);
      process.exit(2);
    }
    const fromDb = await loadFromDb(args['--date']);
    if (fromDb) return fromDb;
    console.warn('→ 回退到 fixture');
    return fixture(args['--date']);
  }
  const today = new Date().toISOString().slice(0, 10);
  console.warn('⚠️  未指定 --date 或 --in，使用 fixture 冒烟数据');
  return fixture(today);
}

// ============================================================================
// 输出目录
// ============================================================================

function outDir(): string {
  const d = join(process.cwd(), 'out', 'pptx');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function humanKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

// ============================================================================
// 子命令
// ============================================================================

async function cmdLint(content: DailyReportContent): Promise<void> {
  console.log('\n🔍 跑新引擎 lint（不渲染）\n');
  const report = await lintBriefingContent(content, args['--theme']);

  const errors = report.issues.filter((i) => i.level === 'error');
  const warns = report.issues.filter((i) => i.level === 'warn');

  // 按规则聚合，便于定位是哪一类问题
  const byRule = new Map<string, number>();
  for (const i of report.issues) {
    byRule.set(i.rule, (byRule.get(i.rule) ?? 0) + 1);
  }

  console.log(`状态：${report.passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Error: ${errors.length}   Warn: ${warns.length}`);
  console.log(`按规则：${[...byRule.entries()].map(([r, n]) => `${r}=${n}`).join('  ')}\n`);

  if (errors.length > 0) {
    console.log('---- Error 明细（最多 20 条）----');
    for (const e of errors.slice(0, 20)) {
      console.log(`  [${e.rule}] P${e.pageNo} ${e.boxId ?? '-'} (${e.detail})`);
    }
    console.log();
  }
  if (warns.length > 0) {
    console.log('---- Warn 明细（最多 10 条）----');
    for (const w of warns.slice(0, 10)) {
      console.log(`  [${w.rule}] P${w.pageNo} ${w.boxId ?? '-'} (${w.detail})`);
    }
    console.log();
  }

  if (!report.passed) process.exit(1);
}

async function cmdRender(content: DailyReportContent): Promise<void> {
  console.log('\n🎨 走生产调度渲染 PPTX\n');
  const outcome = await buildBriefingPptxAuto(content, args['--theme']);

  // 文件名带引擎后缀：legacy / engine 两套产物不再互相覆盖
  const base = briefingFileName(content.date, content.cover.subtitle.includes('草稿'));
  const name = base.replace(/\.pptx$/, `.${outcome.producedBy}.pptx`);
  const outPath = join(outDir(), name);
  writeFileSync(outPath, outcome.buffer);

  console.log(`✅ 产出：${outPath}`);
  console.log(`   引擎：${outcome.producedBy}（模式 ${outcome.mode}）`);
  console.log(`   大小：${humanKB(outcome.buffer.length)}`);
  console.log(`   耗时：${outcome.durationMs} ms`);
  if (outcome.engineReport) {
    console.log(`   页数：${outcome.engineReport.pageCount}`);
    console.log(`   形状：${outcome.engineReport.boxCount}`);
    const e = outcome.engineReport.report.issues.filter((i) => i.level === 'error').length;
    const w = outcome.engineReport.report.issues.filter((i) => i.level === 'warn').length;
    console.log(`   Lint：${e} error / ${w} warn`);
  }
  if (outcome.fallbackReason) {
    console.log(`   ⚠️  回落原因：${outcome.fallbackReason}`);
  }
}

async function cmdShadow(content: DailyReportContent): Promise<void> {
  console.log('\n👥 双引擎比对\n');
  // 通过临时置 env 走 shadow 分支，保证与生产 shadow 逻辑完全一致
  const prev = process.env.BRIEFING_PPTX_ENGINE;
  process.env.BRIEFING_PPTX_ENGINE = 'shadow';

  try {
    const outcome = await buildBriefingPptxAuto(content, args['--theme']);
    const name = briefingFileName(content.date, content.cover.subtitle.includes('草稿'));
    const outPath = join(outDir(), `SHADOW-${name}`);
    writeFileSync(outPath, outcome.buffer);

    console.log('✅ 比对完成（上面 [briefing/shadow] 日志即结果）');
    console.log(`   产出（旧引擎）：${outPath}`);
    console.log(`   大小：${humanKB(outcome.buffer.length)}`);
    console.log('   提示：若日志里有「新引擎 lint 未通过」，说明还不能切流。');
  } finally {
    if (prev === undefined) delete process.env.BRIEFING_PPTX_ENGINE;
    else process.env.BRIEFING_PPTX_ENGINE = prev;
  }
}

// ============================================================================
// 入口
// ============================================================================

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log(`早报 PPTX CLI  ·  命令=${cmd}`);
  console.log('═'.repeat(60));

  const content = await loadContent();
  if (!content) {
    console.error('❌ 无法装载内容');
    process.exit(2);
  }
  console.log(`📄 内容日期=${content.date}  条目=${content.items.length}  方向=${content.directions.length}`);

  switch (cmd) {
    case 'lint':
      return cmdLint(content);
    case 'render':
      return cmdRender(content);
    case 'shadow':
      return cmdShadow(content);
    default:
      console.error(`未知命令：${cmd}`);
      console.error('用法：npx tsx scripts/briefing-pptx.ts [lint|render|shadow] [--date=YYYY-MM-DD] [--in=path.json] [--theme=paper]');
      process.exit(2);
  }
}

main().catch((err) => {
  console.error('\n❌ 失败：', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split('\n').slice(1, 5).join('\n'));
  }
  process.exit(1);
});
