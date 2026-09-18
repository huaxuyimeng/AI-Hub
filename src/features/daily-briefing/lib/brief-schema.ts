/**
 * AI 早报 — Brief 数据契约（来自 ai-news-kit 的 brief.json 格式）
 *
 * 双轨说明：
 * - 旧 v4 schema（`./types.ts` 的 `DailyReportContent`）是当前生产 schema，14 页 PPT 渲染依赖
 * - 本文件定义的 `BriefSchema` 是 ai-news-kit `data/YYYY-MM-DD/brief.json` 的 1:1 Zod 镜像
 * - 两者并存不冲突：v4 schema 渲染 PPT，本 schema 校验 LLM 原始输出
 *
 * 来源：参考 `D:\1Money\AI新闻\ai-news-kit\docs\04-数据契约.md`
 *
 * 纪律：渲染脚本只读不写，校验脚本只读不写——本文件是「唯一真相源」的双轨之一
 */

import { z } from 'zod';

// ========================================================================
// 置信度等级（A/B/C/D）
// ========================================================================

/** 置信度等级枚举（与 v4 schema 的 `ConfidenceLevel` 完全一致） */
export const ConfidenceSchema = z.enum(['A', 'B', 'C', 'D']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** 4 项量表（顺序固定 A→D，渲染成 PPT 第 3 页） */
export const ConfidenceScaleSchema = z
  .array(
    z.object({
      lv: ConfidenceSchema,
      name: z.string().min(1), // "极高" / "高" / "中" / "存疑"
      rule: z.string().min(10), // 规则描述
    }),
  )
  .length(4);

// ========================================================================
// 来源（sources）
// ========================================================================

/** 单条信源（name + url + 一手标记） */
export const SourceSchema = z.object({
  name: z.string().min(1), // "Anthropic 官方报告（一手）"
  url: z.string().url(),
  /** 是否一手来源（官网 / 论文 / 公告 / 官方报告） */
  isPrimary: z.boolean().optional().default(false),
});
export type BriefSource = z.infer<typeof SourceSchema>;

// ========================================================================
// 要闻条目（picks[]）
// ========================================================================

/**
 * 选题方向（决定 PPT 配色）
 * 只允许两个值——避免新分类导致 PPT 配色 fallback
 * 与 ai-news-kit 的 `topic` 字段完全一致
 */
export const TopicSchema = z.enum(['AI Coding', '具身智能']);
export type BriefTopic = z.infer<typeof TopicSchema>;

/** 单条要闻 */
export const PickSchema = z.object({
  no: z.number().int().min(1),
  topic: TopicSchema,
  title: z.string().min(8).max(120), // 一句话标题
  lv: ConfidenceSchema,
  /** 真实发布时间（YYYY-MM-DD），绝不用抓取时间 */
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 3–5 句事实陈述，不含评价 */
  event: z.string().min(40).max(500),
  /** 3–5 条关键事实，尽量带可验证数字 */
  keyFacts: z.array(z.string().min(1)).min(3).max(5),
  /**
   * ★ 必须回答"所以呢"——对读者决策的影响，不是复述事件
   * 自检：删掉后读者会损失什么信息？
   */
  why: z.string().min(40).max(400),
  /** 一手来源排第一；至少 1 条 */
  sources: z.array(SourceSchema).min(1).max(6),
  /** 各源差异；一致写"无实质冲突" */
  conflicts: z.string().default('无实质冲突'),
});
export type BriefPick = z.infer<typeof PickSchema>;

// ========================================================================
// 扫读清单（alsoWorthAScan[]）
// ========================================================================

/** 扫读条目（不进正条目的事件） */
export const AlsoWorthAScanSchema = z.object({
  title: z.string().min(4),
  /** 简写如 "量子位 / AITNT（2 源）" */
  sources: z.string().min(1),
});
export type AlsoWorthAScan = z.infer<typeof AlsoWorthAScanSchema>;

// ========================================================================
// 抓取统计（rawStats）
// ========================================================================

export const RawStatsSchema = z.object({
  sourcesAlive: z.number().int().min(0),
  sourcesTotal: z.number().int().min(0),
  rawItems: z.number().int().min(0),
  dedupedItems: z.number().int().min(0),
  multiSourceItems: z.number().int().min(0),
  byCategory: z.record(z.string(), z.number()).default({}),
  crossSourceThreshold: z.number().int().min(1),
  note: z.string().optional(),
});
export type BriefRawStats = z.infer<typeof RawStatsSchema>;

// ========================================================================
// 顶层 schema（brief.json）
// ========================================================================

export const BriefSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 抓取窗口说明（为什么是这批数据，避免"凌晨数据当今天"） */
  windowNote: z.string().optional(),
  /** 侧重方向（如 ["AI Coding", "具身智能"]） */
  focus: z.array(z.string()).default([]),
  /** 今日一句话总览，3–4 句，要有观点 */
  headline: z.string().min(20).max(400),
  rawStats: RawStatsSchema.optional(),
  confidenceScale: ConfidenceScaleSchema,
  /** ★ 要闻，3–5 条 */
  picks: z.array(PickSchema).min(3).max(5),
  /** 扫读清单（不进正条目的事件） */
  alsoWorthAScan: z.array(AlsoWorthAScanSchema).default([]),
  /** 查重说明（比对了哪几轮） */
  dedupeNote: z.string().optional(),
  /** 机器草稿标记：true 表示未经人工核验的兜底产物（评级上限 B） */
  draft: z.boolean().optional(),
});
export type Brief = z.infer<typeof BriefSchema>;

// ========================================================================
// 默认置信度量表（导出常量供 PPT 渲染使用）
// ========================================================================

/**
 * 评级规则来源：参考 `D:\1Money\AI新闻\ai-news-kit\docs\03-置信度评级规则.md`
 * 表述已与 ai-news-kit 完全对齐（独立信源 / 转载不算）
 *
 * 注意：颜色仍用 AIHub 现有调色板（与 14 页 PPT 主题协调），不照搬 ai-news-kit 的橙红色
 */
export const DEFAULT_CONFIDENCE_SCALE: Array<{
  lv: Confidence;
  name: string;
  rule: string;
}> = [
  {
    lv: 'A',
    name: '极高',
    rule: '≥3 个相互独立的信源，且可追溯到一手官方材料（官网 / 论文 / 公告 / 官方报告）',
  },
  {
    lv: 'B',
    name: '高',
    rule: '2 个独立信源，或 1 个信源 + 一手官方材料',
  },
  {
    lv: 'C',
    name: '中',
    rule: '单一信源报道；含「多家转载同一家独家」（转载数量 ≠ 独立信源数量）',
  },
  {
    lv: 'D',
    name: '存疑',
    rule: '关键数字互相矛盾，或全部可溯源到同一原始信源且无官方确认',
  },
];

/**
 * 把 brief.json 校验为合法 brief（容错性 parse）。
 * LLM 输出格式可能不严格遵守，本函数：
 * 1. 优先尝试完整 schema 校验
 * 2. 失败时按字段依次放宽（去掉多余字段、补默认值）
 * 3. 仍失败抛出 ValidationError
 */
export function parseBriefLoose(input: unknown): Brief {
  const result = BriefSchema.safeParse(input);
  if (result.success) {
    // draft 默认 false（之前用 .default(false)，现在改 .optional 后补默认值）
    return { draft: false, ...result.data };
  }
  // 容错：去掉多余字段
  const cleaned = stripUnknownFields(input, BriefSchema);
  const parsed = BriefSchema.parse(cleaned);
  return { draft: false, ...parsed };
}

/**
 * 递归去掉 Zod schema 不识别的字段（容错）
 */
function stripUnknownFields(input: unknown, schema: z.ZodTypeAny): unknown {
  if (input === null || input === undefined) return input;
  if (schema instanceof z.ZodObject) {
    if (typeof input !== 'object' || Array.isArray(input)) return input;
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k in shape) {
        out[k] = stripUnknownFields(v, shape[k]);
      }
    }
    return out;
  }
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(input)) return input;
    return input.map(item => stripUnknownFields(item, schema._def.type));
  }
  return input;
}
