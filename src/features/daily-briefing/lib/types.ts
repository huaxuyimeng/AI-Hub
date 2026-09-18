/**
 * AI 早报 — 类型定义与校验（v4：研究报告风格）
 * 路径：src/lib/daily-report/types.ts
 *
 * v4 重大改动（参考 D:\1Money\AI新闻\AI日报_2026-08-29 风格）：
 * - 14 页三幕叙事架构（cover → overview → 两大方向索引+展开 → 验证 → 趋势 → 结尾）
 * - 白底 + 巨型数字视觉锚点（每页一个 L1 锚点）
 * - 严格颜色系统（4 主色 + 3 同族浅底），固定主题不再切换
 * - Item 新增字段：independentSources / totalReposts / heroMetrics / whyMatters / primaryLinks
 * - 引入「方向（Direction）」一级结构：coding / embodied / rumor
 * - 新增结构化数据：verificationTable（11 行 6 列）/ trends（3 条）/ sources（4 列清单）
 *
 * 向下兼容：保留旧字段（confidenceLevel / relatedSources / bySource）作为可选。
 */

import { z } from 'zod';

// ========================================================================
// 主题类型（v4：固定白底单主题，保留类型仅为向后兼容旧数据）
// ========================================================================

/** 旧版 6 主题枚举（v4 不再使用，但保留以兼容 DB 中的 theme 字段） */
export type BriefingTheme = 'paper' | 'ink' | 'mint' | 'lavender' | 'amber' | 'ocean';
export const BRIEFING_THEMES: BriefingTheme[] = ['paper', 'ink', 'mint', 'lavender', 'amber', 'ocean'];

// ========================================================================
// 基础枚举
// ========================================================================

/** 置信度等级（A/B/C/D），独立信源数量自动判定 */
export type ConfidenceLevel = 'A' | 'B' | 'C' | 'D';

/**
 * 置信度规则表述已与 ai-news-kit 完全对齐（独立信源 / 转载不算）
 * 来源：参考 `D:\1Money\AI新闻\ai-news-kit\docs\03-置信度评级规则.md`
 * 颜色保持 AIHub 现有调色板（与 14 页 PPT 主题协调），不照搬 ai-news-kit 的橙红色
 */
export const CONFIDENCE_META: Record<
  ConfidenceLevel,
  { label: string; shortLabel: string; color: string; lightBg: string; rule: string }
> = {
  A: { label: 'A 极高', shortLabel: 'A 极高', color: '#3B82F6', lightBg: '#EFF6FF', rule: '≥3 个相互独立的信源，且可追溯到一手官方材料（官网 / 论文 / 公告 / 官方报告）' },
  B: { label: 'B 高',   shortLabel: 'B 高',   color: '#3B82F6', lightBg: '#EFF6FF', rule: '2 个独立信源，或 1 个信源 + 一手官方材料' },
  C: { label: 'C 中',   shortLabel: 'C 中',   color: '#06B6D4', lightBg: '#ECFEFF', rule: '单一信源报道；含「多家转载同一家独家」（转载数量 ≠ 独立信源数量）' },
  D: { label: 'D 存疑', shortLabel: 'D 存疑', color: '#F59E0B', lightBg: '#FFFBEB', rule: '关键数字互相矛盾，或全部可溯源到同一原始信源且无官方确认' },
};

/** 方向（三大方向，按需切换） */
export type DirectionKey = 'coding' | 'embodied' | 'rumor';

export const DIRECTION_META: Record<DirectionKey, { title: string; subtitle: string; gradient: string }> = {
  coding:   { title: 'AI Coding 方向 · 智能编程',     subtitle: '从「生成代码」到「可证明正确」「成本可控」', gradient: '#3B82F6 → #06B6D4' },
  embodied: { title: '具身智能方向 · Embodied AI',     subtitle: '通用 Agent 溢出到物理世界',                gradient: '#06B6D4 → #3B82F6' },
  rumor:    { title: '需要保持怀疑的传闻',             subtitle: '转载量 ≠ 独立信源数',                      gradient: '#F59E0B → #D97706' },
};

/** 视觉角色（控制强调色占比：主 60% / 辅 30% / 强调 10-18%） */
export type PageRole = 'hero' | 'supporting' | 'transition';

// ========================================================================
// 字数硬约束
// ========================================================================

export const LIMITS = {
  subtitle: 30,
  intro: 60,
  headline: 30,
  oneLine: 40,
  comment: 30,
  summary: 220,         // v4: 摘要从 90 → 220（详情页有更多空间）
  trendText: 120,
  metricLabel: 28,
  whyMatters: 280,
  trendDesc: 110,
  whyDoubtful: 80,
} as const;

export function truncate(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function truncateOnce(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.endsWith('…') && t.length <= max) return t;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ========================================================================
// 数据子结构
// ========================================================================

/** 一手链接（来源名 + URL） */
const PrimaryLinkSchema = z.object({
  source: z.string().min(1),  // "腾讯混元官方公众号"
  url: z.string().url(),
});

/** 巨型数字锚点（hero 页主视觉） */
const HeroMetricSchema = z.object({
  value: z.string().min(1),     // "770B" / "1M" / "+31.8%" / "78%"
  label: z.string().min(1),     // "总参数"
  sub: z.string().optional(),   // "较上代 295B ↑ 近 3 倍"
  /** 渐变背景（CSS linear-gradient）。null = 同族浅底卡片 */
  gradient: z.string().nullable().optional(),
});

/** 关键统计（多用于 D 存疑/支撑页的「背景数字」） */
const KeyStatSchema = z.object({
  value: z.string(),
  label: z.string(),
  color: z.enum(['primary', 'secondary', 'accent']).default('primary'),
});

/** 单条新闻条目（v4 完整字段） */
const ItemSchema = z.object({
  // 基础
  rank: z.number().int().positive(),                          // 1, 2, 3 ...
  title: z.string().min(1),
  source: z.string(),                                         // 主信源名称
  url: z.string().url(),                                      // 主链接
  publishedAt: z.string(),                                    // "08-29 16:49" 或 "—"
  summary: z.string(),                                        // 详细摘要（≤220 字）
  comment: z.string(),                                        // AI 点评
  category: z.string().nullable(),                            // "旗舰模型" / "形式化验证" ...
  direction: z.enum(['coding', 'embodied', 'rumor']),         // 所属方向
  // 置信度与溯源（v4 新增）
  confidenceLevel: z.enum(['A', 'B', 'C', 'D']),
  independentSources: z.number().int().min(1).default(1),     // 独立信源数
  totalReposts: z.number().int().min(0).default(0),           // 转载数
  hasPrimaryLink: z.boolean().default(false),                 // 是否有官方一手链接
  primaryLinks: z.array(PrimaryLinkSchema).default([]),       // 一手链接列表
  relatedSources: z.array(z.string()).default([]),            // 印证信源名称列表

  // Hero 专用（v4 新增）
  heroMetrics: z.array(HeroMetricSchema).max(4).default([]),  // 0-4 个巨型数字
  whyMatters: z.string().nullable().default(null),            // "为何值得关注"
  whyDoubtful: z.array(z.string()).default([]),               // "为何评为 D 存疑"的多个理由
  comparison: z.string().nullable().default(null),            // "多方对比"（如"770B 总参数在两源一致"）
  keyStats: z.array(KeyStatSchema).default([]),               // 关键背景数字

  // v5：详情页杂志风改造
  coverUrl: z.string().url().nullable().default(null),        // og:image / RSS enclosure（详情页大图）
  bulletPoints: z.array(z.string()).default([]),              // "三层摘要"：3 句要点（≤40 字/句）
});

/** 方向索引页（P03/P07 用） */
const DirectionIndexSchema = z.object({
  key: z.enum(['coding', 'embodied']),
  title: z.string(),
  subtitle: z.string(),
  count: z.number().int().positive(),
  /** 摘要列表（用于索引页展示） */
  summaryItems: z.array(z.object({
    rank: z.number().int().positive(),
    title: z.string(),
    oneLine: z.string(),
    category: z.string(),
    confidence: z.enum(['A', 'B', 'C', 'D']),
  })).min(1).max(6),
});

/** B 站作者（P11 用） */
const VideoAuthorSchema = z.object({
  name: z.string(),             // "橘鸦Juya"
  status: z.enum(['ok', 'warn']),  // ok = 已取全文 / warn = 未取到
  statusText: z.string(),       // "✅ 已取全文" / "⚠️ IP 级风控封禁"
  count: z.number().int().nullable().default(null),  // 抓取条数（warn 时 null）
  description: z.string(),      // 60-120 字
  url: z.string().url(),
});

/** 验证表行（P12 用） */
const VerificationRowSchema = z.object({
  rank: z.string(),             // "1" / "5b"
  topic: z.string(),
  direction: z.string(),        // "Coding" / "Coding 安全" / "—" / "Coding×具身"
  sources: z.string(),          // "2" / "1" / "1（6+ 转载）" / "3（矛盾）"
  primaryLink: z.string(),      // "✅ xxx" / "❌"
  confidence: z.enum(['A', 'B', 'C', 'D']),
});

/** 趋势（P13 用） */
const TrendSchema = z.object({
  rank: z.number().int().positive(),
  title: z.string(),            // "Harness 层主战场"
  description: z.string(),      // 60-110 字
});

/** 信源清单（P14 用） */
const SourcesBlockSchema = z.object({
  skills: z.array(z.object({ name: z.string(), url: z.string().url() })),
  videoAuthors: z.array(z.object({ name: z.string(), url: z.string().url() })),
  crossSources: z.array(z.object({ name: z.string(), url: z.string().url() })),
  officialLinks: z.array(z.object({ name: z.string(), url: z.string().url() })),
});

// ========================================================================
// 顶层 schema
// ========================================================================

export const DailyReportContentSchema = z.object({
  version: z.literal(4),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string(),

  // P01 封面
  cover: z.object({
    title: z.string(),                  // "AI 日报"
    subtitle: z.string(),               // "2026-08-29 · 周六"
    emphasis: z.string(),               // "侧重 AI Coding × 具身智能"
    stats: z.array(KeyStatSchema).length(3),  // 3 个统计卡
  }),

  // P02 概览 + 方法
  overview: z.object({
    intro: z.string(),                                  // 副标题
    methodNote: z.string(),                             // 方法说明（如"刻意区分「转载」与「独立信源」"）
    sources: z.array(z.object({                        // 4 信源家族
      name: z.string(),
      description: z.string(),
      icon: z.string(),                                 // FontAwesome name
      color: z.enum(['primary', 'secondary', 'accent']),
    })).length(4),
    tlDr: z.array(z.string()).min(2).max(4),            // TL;DR 3 条
    confidenceLegend: z.array(z.object({                // A/B/C/D 评级
      level: z.enum(['A', 'B', 'C', 'D']),
      label: z.string(),
      color: z.enum(['primary', 'secondary', 'accent']),
      rule: z.string(),
    })).length(4),
    distribution: z.array(z.object({                    // 置信度分布（图表数据）
      level: z.enum(['A', 'B', 'C', 'D']),
      count: z.number().int().min(0),
    })).length(4),
  }),

  // P03/P07 方向索引
  directions: z.array(DirectionIndexSchema).min(1).max(3),

  // P04-P09 / P10 详情页（含所有新闻条目，按方向归类）
  items: z.array(ItemSchema).min(3).max(15),

  // P11 B 站作者
  authors: z.array(VideoAuthorSchema).min(1).max(4),

  // P12 验证表
  verificationTable: z.object({
    rows: z.array(VerificationRowSchema).min(5).max(20),
    summary: z.string(),                                // 验证表下方的总结句
  }),

  // P13 趋势
  trends: z.array(TrendSchema).length(3),

  // P14 信源清单
  sources: SourcesBlockSchema,
});

export type DailyReportContent = z.infer<typeof DailyReportContentSchema>;
export type DirectionIndex = z.infer<typeof DirectionIndexSchema>;
export type VerificationRow = z.infer<typeof VerificationRowSchema>;
export type VideoAuthor = z.infer<typeof VideoAuthorSchema>;
export type Trend = z.infer<typeof TrendSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type HeroMetric = z.infer<typeof HeroMetricSchema>;
export type PrimaryLink = z.infer<typeof PrimaryLinkSchema>;

// ========================================================================
// 服务端截断
// ========================================================================

export function enforceLimits(c: DailyReportContent): DailyReportContent {
  return {
    ...c,
    cover: {
      ...c.cover,
      title: truncateOnce(c.cover.title, 30),
      subtitle: truncateOnce(c.cover.subtitle, LIMITS.subtitle),
      emphasis: truncateOnce(c.cover.emphasis, 60),
    },
    overview: {
      ...c.overview,
      intro: truncateOnce(c.overview.intro, LIMITS.intro),
    },
    items: c.items.map(it => ({
      ...it,
      summary: truncateOnce(it.summary, LIMITS.summary),
      comment: truncateOnce(it.comment, LIMITS.comment),
      whyMatters: it.whyMatters ? truncateOnce(it.whyMatters, LIMITS.whyMatters) : null,
      bulletPoints: (it.bulletPoints ?? []).slice(0, 4).map(p => truncateOnce(p, 60)),
    })),
    trends: c.trends.map(t => ({
      rank: t.rank,
      title: truncateOnce(t.title, 24),
      description: truncateOnce(t.description, LIMITS.trendDesc),
    })),
    verificationTable: {
      rows: c.verificationTable.rows,
      summary: truncateOnce(c.verificationTable.summary, 240),
    },
  };
}

// ========================================================================
// Phase 阶段枚举（R-4：统一单点定义，防止 generate.ts 与 BriefingToast 两端不一致）
// ========================================================================

/**
 * 早报生成管线的 6 个细粒度阶段。
 * 与 generate.ts setPhase() 调用严格对齐，由 BriefingPanel / BriefingToast 共同引用此定义。
 */
export const BRIEFING_PHASES = [
  'collect',
  'select',
  '2a',
  '2b',
  '2c',
  'persist',
] as const;

export type BriefingPhase = typeof BRIEFING_PHASES[number];

/**
 * 各阶段在前端 toast 中的展示文案。
 * BriefingPanel 与 BriefingToast 必须从 BRIEFING_PHASE_LABELS 读取，禁止硬编码。
 */
export const BRIEFING_PHASE_LABELS: Record<BriefingPhase | 'done', string> = {
  collect: '正在采集今日新闻…',
  select: '正在智能选题与方向分类…',
  '2a': '正在生成封面与总览…',
  '2b': '正在成稿每条新闻详情…',
  '2c': '正在整理信源清单…',
  persist: '正在保存到数据库…',
  done: '早报生成完成',
};
