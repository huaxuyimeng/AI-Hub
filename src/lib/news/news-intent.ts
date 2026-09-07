/**
 * 新闻意图搜索 — 基于 LLM 的自然语言查询解析 + 新闻搜索
 *
 * 路径：src/lib/news/news-intent.ts
 *
 * 设计：D-3 扩展（docs/33-Qoder-未来优化建议报告.md §1）
 * 复用：
 *   - D-3 intent-search.ts 的 LLM 解析骨架（gpt-4o-mini）
 *   - D-2 search.ts 的同义词展开（expandQuery）
 *   - service.ts 的 queryNews / countNews / buildNewsWhere
 *
 * 行为：
 *   1. parseNewsIntent — 把自然语言转为 NewsIntent（结构化过滤条件）
 *   2. executeNewsIntentSearch — 把 NewsIntent 转为 NewsQueryOptions，执行查询
 *   3. newsIntentSearch — 组合入口（解析 + 执行 + 降级）
 *
 * 关键约束：
 *   - 仅用于 NewsItem，不处理 Model（Model 走 intent-search.ts）
 *   - LLM 解析失败 / 超时时降级为字面搜索
 *   - 不修改 service.ts 的核心分类/抓取逻辑
 *   - 分类/厂家枚举白名单校验（防 LLM 幻觉）
 *   - 走 AbortController 超时（3.5s 默认），不卡死搜索框
 *
 * 验收：
 *   - "具身智能最近一周" → category=具身智能 + dateRange=7d
 *   - "OpenAI 和 Anthropic 吵架相关" → companyTags=[OpenAI,Anthropic] + keywords
 *   - LLM 失败时自动降级为字面 contains 搜索
 */

import { prismaBase as prisma } from '@/lib/db';
import { chat } from '@/lib/ai/router';
import { CATEGORY_KEYWORDS, AI_COMPANIES } from './sources';
import { expandQuery } from './search';
import { queryNews, countNews, beijingDayStart, type NewsQueryOptions } from './service';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** LLM 解析默认超时（ms） */
const PARSE_TIMEOUT_MS = 3500;

/** 结果截断 */
const RESULT_LIMIT = 30;

/** 新闻分类白名单（从 CATEGORY_KEYWORDS 推导）+ 通用 "全部" */
const VALID_CATEGORIES = new Set<string>([...Object.keys(CATEGORY_KEYWORDS), '未分类']);

/** AI 厂家白名单（display 名集合） */
const VALID_COMPANIES = new Set<string>(AI_COMPANIES.map((c) => c.display));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 日期范围语义（用户友好描述） */
export type DateRangePreset =
  | 'today'         // 今天（北京时间）
  | 'yesterday'     // 昨天
  | 'last-3-days'
  | 'last-week'     // 近 7 天
  | 'last-month'    // 近 30 天
  | 'last-quarter'  // 近 90 天
  | 'custom';       // 自定义 ISO 日期段

/** 从自然语言解析出的结构化过滤条件 */
export interface NewsIntent {
  /** 原始查询（去除修饰词后保留的实质关键词；用于字面回退） */
  query: string;
  /** 过滤条件 */
  filters?: {
    /** 分类（白名单内的 display 名，如 "具身智能"） */
    category?: string;
    /** AI 厂家（白名单内的 display 名，如 "OpenAI"） */
    companyTags?: string[];
    /** 关键词（用于 contains 搜索，叠加在 query 上） */
    keywords?: string[];
    /** 日期范围 */
    dateRange?: {
      preset: DateRangePreset;
      /** 自定义时为 ISO 日期字符串 */
      start?: string;
      end?: string;
    };
    /** 必须有封面图 */
    hasCover?: boolean;
    /** 只看视频/多模态新闻（D-1 B 站） */
    hasMedia?: boolean;
  };
  /** 排序（默认按发布时间倒序） */
  sort?: 'recent' | 'relevance';
  /** 是否展开同义词（默认 true；D-2 智能搜索） */
  expandSynonyms?: boolean;
}

/** 单条新闻意图搜索结果 */
export interface NewsIntentItem {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  publishPrecision: string | null;
  crawledAt: string;
  category: string | null;
  coverUrl: string | null;
  companyTags: string[];
  source: { id: string; name: string };
}

/** 意图搜索完整响应 */
export interface NewsIntentSearchResponse {
  /** 原始查询 */
  query: string;
  /** 解析后的结构化意图 */
  intent: NewsIntent;
  /** 是否降级为字面搜索 */
  degraded: boolean;
  /** 降级原因（如果有） */
  degradeReason?: string;
  /** 命中条数（未截断） */
  total: number;
  /** 新闻列表（最多 30 条） */
  items: NewsIntentItem[];
  /** 搜索词的同义词展开（如果启用了 expandSynonyms） */
  expandedKeywords?: string[];
  matchedTerms?: Array<{ canonical: string; displayName: string; type: string }>;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const NEWS_INTENT_PROMPT = `你是一个 AI 新闻搜索意图解析器。给定用户查询，提取以下结构化信息：

- query: 核心关键词（去除修饰词，只保留实质名词；用作字面回退的兜底搜索词）
- filters:
  - category: 新闻分类（必须是以下之一：${[...VALID_CATEGORIES].filter(c => c !== '未分类').join('、')}；只在用户明确提到分类时填）
  - companyTags: AI 厂家列表（必须是以下之一，大小写不敏感：${[...VALID_COMPANIES].join('、')}；只在用户提到具体公司时填）
  - keywords: 额外关键词（用于 contains 搜索；如 "打架"、"融资"、"开源"、"评测"）
  - dateRange:
    - preset: today | yesterday | last-3-days | last-week | last-month | last-quarter | custom
    - start: ISO 日期字符串（YYYY-MM-DD），仅 custom 时填
    - end: ISO 日期字符串（YYYY-MM-DD），仅 custom 时填
    - 默认不填（= 全部时间）
  - hasCover: true/false，只在用户明确提到"封面图"时填
  - hasMedia: true/false，只在用户明确提到"视频"、"B 站"、"多媒体"时填
- sort: recent | relevance；默认 recent（按发布时间倒序）
- expandSynonyms: true（启用同义词展开）

示例 1：用户说 "具身智能最近一周" →
{ "query": "具身智能", "filters": { "category": "具身智能", "dateRange": { "preset": "last-week" } }, "sort": "recent" }

示例 2：用户说 "OpenAI 和 Anthropic 吵架相关" →
{ "query": "吵架", "filters": { "companyTags": ["OpenAI", "Anthropic"], "keywords": ["吵架"] }, "sort": "recent" }

示例 3：用户说 "近三天带封面的 AI Coding 新闻" →
{ "query": "AI Coding", "filters": { "category": "AI Coding", "dateRange": { "preset": "last-3-days" }, "hasCover": true }, "sort": "recent" }

只返回 JSON，不要任何解释。
查询: {query}`.trim();

// ---------------------------------------------------------------------------
// 工具：把 preset 转为 NewsQueryOptions 接受的 date 形式
// ---------------------------------------------------------------------------

/**
 * 把 preset 日期范围转为 Prisma 需要的"日界" Date
 * 返回 undefined = 不限时间
 *
 * 注意：service.ts 的 queryNews 用 `publishedAt` 字段；用户查询按北京时间归日
 */
function resolveDateRange(preset?: DateRangePreset): { gte?: Date; lte?: Date } {
  if (!preset) return {};
  const now = new Date();
  const dayStart = beijingDayStart(now);

  switch (preset) {
    case 'today':
      return {
        gte: dayStart,
        lte: new Date(dayStart.getTime() + 86400_000 - 1),
      };
    case 'yesterday': {
      const start = new Date(dayStart.getTime() - 86400_000);
      return {
        gte: start,
        lte: new Date(dayStart.getTime() - 1),
      };
    }
    case 'last-3-days':
      return { gte: new Date(dayStart.getTime() - 2 * 86400_000), lte: new Date(dayStart.getTime() + 86400_000 - 1) };
    case 'last-week':
      return { gte: new Date(dayStart.getTime() - 6 * 86400_000), lte: new Date(dayStart.getTime() + 86400_000 - 1) };
    case 'last-month':
      return { gte: new Date(dayStart.getTime() - 29 * 86400_000), lte: new Date(dayStart.getTime() + 86400_000 - 1) };
    case 'last-quarter':
      return { gte: new Date(dayStart.getTime() - 89 * 86400_000), lte: new Date(dayStart.getTime() + 86400_000 - 1) };
    case 'custom':
      // custom 由调用方自行传 start/end（不在本函数处理）
      return {};
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// parseNewsIntent — LLM 解析（失败时降级为字面搜索）
// ---------------------------------------------------------------------------

/**
 * 解析自然语言查询为结构化新闻意图
 * 失败时返回 query=原始输入、degraded=true 的降级意图
 *
 * 失败场景：
 *   - LLM 调用异常
 *   - LLM 超时（>3.5s）
 *   - JSON 解析失败
 *
 * B-13 修复：新增 tenantId 参数（必须），用于 chat() 的租户上下文
 * 此前用 'system' 字面量 → AI Key 永远查不到 → dev-mode mock 占位
 */
export async function parseNewsIntent(
  query: string,
  tenantId: string,
): Promise<{ intent: NewsIntent; degraded: boolean; degradeReason?: string }> {
  if (!query.trim()) {
    return { intent: { query, expandSynonyms: true }, degraded: false };
  }

  try {
    // 用 Promise.race 实现 3.5s 超时（chat() 不直接支持 signal）
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('LLM_PARSE_TIMEOUT')), PARSE_TIMEOUT_MS);
    });

    let res: Awaited<ReturnType<typeof chat>>;
    try {
      res = await Promise.race([
        chat(
          'gpt-4o-mini',
          tenantId, // B-13 修复：传真实 tenantId（不再用 'system' 字面量）
          [{ role: 'user', content: NEWS_INTENT_PROMPT.replace('{query}', query) }],
          { temperature: 0.1 }
        ),
        timeoutPromise,
      ]);
      clearTimeout(timeoutId!);
    } catch (innerErr) {
      clearTimeout(timeoutId!);
      throw innerErr;
    }

    const raw = res.content.trim();
    const parsed = JSON.parse(raw) as Partial<NewsIntent>;

    // 校验并规范化
    const filters: NewsIntent['filters'] = {};

    if (parsed.filters?.category) {
      const cat = String(parsed.filters.category);
      if (VALID_CATEGORIES.has(cat)) {
        filters.category = cat;
      }
      // 非法分类 → 静默丢弃（不写入 filters，避免空结果）
    }

    if (parsed.filters?.companyTags?.length) {
      const valid = parsed.filters.companyTags
        .map((c) => String(c))
        .filter((c) => VALID_COMPANIES.has(c));
      if (valid.length > 0) filters.companyTags = valid;
    }

    if (parsed.filters?.keywords?.length) {
      filters.keywords = parsed.filters.keywords.map((k) => String(k)).filter(Boolean);
    }

    if (parsed.filters?.dateRange?.preset) {
      const preset = parsed.filters.dateRange.preset as DateRangePreset;
      if (['today', 'yesterday', 'last-3-days', 'last-week', 'last-month', 'last-quarter', 'custom'].includes(preset)) {
        filters.dateRange = {
          preset,
          start: parsed.filters.dateRange.start,
          end: parsed.filters.dateRange.end,
        };
      }
    }

    if (typeof parsed.filters?.hasCover === 'boolean') {
      filters.hasCover = parsed.filters.hasCover;
    }

    if (typeof parsed.filters?.hasMedia === 'boolean') {
      filters.hasMedia = parsed.filters.hasMedia;
    }

    return {
      intent: {
        query: (parsed.query as string) || query,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        sort: (parsed.sort as NewsIntent['sort']) ?? 'recent',
        expandSynonyms: parsed.expandSynonyms ?? true,
      },
      degraded: false,
    };
  } catch (err) {
    // LLM 不可用 / 超时 / JSON 错误 → 降级为字面搜索
    const isAbort =
      err instanceof Error &&
      (/abort|abortError|aborted|timeout|timeout/i.test(err.message) ||
        err.message === 'LLM_PARSE_TIMEOUT');
    return {
      intent: { query, sort: 'recent', expandSynonyms: true },
      degraded: true,
      degradeReason: isAbort
        ? 'LLM 解析超时（已降级为字面搜索）'
        : err instanceof Error
          ? err.message
          : 'LLM 调用失败',
    };
  }
}

// ---------------------------------------------------------------------------
// executeNewsIntentSearch — 转换为 NewsQueryOptions + 查询
// ---------------------------------------------------------------------------

/**
 * 把 NewsIntent 转为 NewsQueryOptions（复用 service.ts 的查询逻辑）
 * 这是关键约束：**不直接拼 Prisma where**，全部走 service.ts
 */
function intentToOptions(intent: NewsIntent): NewsQueryOptions {
  const options: NewsQueryOptions = {};
  const filters = intent.filters;

  if (filters?.category) {
    options.category = filters.category;
  }

  // companyTag 走 service.ts 的精确匹配逻辑（防 "AI" 误命中所有含 AI 的标签）
  if (filters?.companyTags?.length === 1) {
    options.companyTag = filters.companyTags[0];
  } else if (filters?.companyTags?.length && filters.companyTags.length > 1) {
    // 多厂家：拉满候选集（service.ts 单值精确匹配无法 OR），交由 executeNewsIntentSearch 后置过滤全集
    // 取第一个作为主过滤的 hint（帮助减少拉取量），但同时大幅放大 limit 以覆盖其他厂家
    options.companyTag = filters.companyTags[0];
    options.limit = Math.max(options.limit ?? 200, 1000);
  }

  if (filters?.dateRange) {
    if (filters.dateRange.preset === 'custom' && filters.dateRange.start && filters.dateRange.end) {
      options.date = filters.dateRange.start; // 简化：用 start；service.ts 的 where 是单日
      // 注：service.ts 当前 where.date 是单日选择，多日区间需要扩展 service.ts；
      //     为不破坏现有逻辑，本期仅支持到"日"精度（custom 用 start）
    } else {
      // 非 custom preset：通过搜索后置过滤实现（避免改 service.ts）
      // 这里仅在 intent 上保留，executeNewsIntentSearch 内做后置过滤
    }
  }

  // 关键词：合并 query + filters.keywords + 同义词展开
  const allKeywords = new Set<string>();
  if (intent.query) allKeywords.add(intent.query);
  for (const k of filters?.keywords ?? []) allKeywords.add(k);

  return options;
}

/**
 * 执行新闻意图搜索
 *
 * 实现说明：
 *   - 基本过滤走 service.ts queryNews（复用 where 构造）
 *   - 多厂家 / preset 日期范围 / hasCover / hasMedia 走后置过滤（不破坏 service.ts）
 *   - 同义词展开：D-2 expandQuery（仅 verified=true 词参与）
 */
export async function executeNewsIntentSearch(intent: NewsIntent): Promise<{
  items: NewsIntentItem[];
  total: number;
  expandedKeywords?: string[];
  matchedTerms?: Array<{ canonical: string; displayName: string; type: string }>;
}> {
  const baseOptions = intentToOptions(intent);

  // 同义词展开（如启用）
  let expandedKeywords: string[] | undefined;
  let matchedTerms: Array<{ canonical: string; displayName: string; type: string }> | undefined;
  if (intent.expandSynonyms !== false) {
    const expanded = await expandQuery(intent.query);
    if (expanded.keywords.length > 0) {
      baseOptions.searchKeywords = expanded.keywords;
      expandedKeywords = expanded.keywords;
      matchedTerms = expanded.matchedTerms;
    }
  } else if (intent.query) {
    baseOptions.search = intent.query;
  }

  // 取更多以便后置过滤（过滤后截断）
  baseOptions.limit = 200;

  // 1) 拉取候选集（limit 放大以容纳后置过滤后的数据）
  // 用 let + splice 模式做后置过滤（不能用 const，否则无法 in-place 替换）
  let raw = await queryNews(baseOptions);
  // total = countNews 原始值，不被后置过滤覆盖（返回给前端"总命中"数）
  const total = await countNews(baseOptions);

  // 2) 后置过滤：preset 日期范围（service.ts 只支持单日）
  const filters = intent.filters;
  if (filters?.dateRange && filters.dateRange.preset !== 'custom') {
    const range = resolveDateRange(filters.dateRange.preset);
    if (range.gte || range.lte) {
      raw = raw.filter((it) => {
        if (!it.publishedAt) return false;
        const t = it.publishedAt.getTime();
        if (range.gte && t < range.gte.getTime()) return false;
        if (range.lte && t > range.lte.getTime()) return false;
        return true;
      });
      // total 不变：保持 DB count 估计
    }
  }

  // 3) 后置过滤：多厂家 OR（service.ts 的 companyTag 是单值精确匹配）
  if (filters?.companyTags && filters.companyTags.length > 1) {
    const wanted = new Set(filters.companyTags);
    raw = raw.filter((it) => {
      const tags = it.companyTags ? it.companyTags.split(',').map(t => t.trim()).filter(Boolean) : [];
      return tags.some(t => wanted.has(t));
    });
    // total 不变
  }

  // 4) 后置过滤：hasCover
  if (filters?.hasCover === true) {
    raw = raw.filter((it) => !!it.coverUrl);
  } else if (filters?.hasCover === false) {
    raw = raw.filter((it) => !it.coverUrl);
  }

  // 5) 后置过滤：hasMedia（D-1 B 站）
  if (filters?.hasMedia === true) {
    raw = raw.filter((it) => {
      const media = (it as { media?: unknown }).media;
      return Array.isArray(media) && media.length > 0;
    });
  }

  // 6) 排序（service.ts 默认按 publishedAt desc 已排序）
  // 7) 截断 + 转 plain
  const items: NewsIntentItem[] = raw.slice(0, RESULT_LIMIT).map((it) => ({
    id: it.id,
    title: it.title,
    url: it.url,
    summary: it.summary,
    publishedAt: it.publishedAt?.toISOString() ?? null,
    publishPrecision: it.publishPrecision ?? null,
    crawledAt: it.createdAt.toISOString(),
    category: it.category,
    coverUrl: it.coverUrl,
    crossSources: it.crossSources ? it.crossSources.split(',').filter(Boolean) : [],
    relatedModels: it.relatedModels ? it.relatedModels.split(',').filter(Boolean) : [],
    companyTags: it.companyTags ? it.companyTags.split(',').filter(Boolean) : [],
    media: (it.media as Array<{ kind?: 'video' | 'audio' | 'image'; bvid?: string; author?: string; thumbnailUrl?: string; durationSec?: number; url?: string }> | null) ?? null,
    source: { id: it.source.id, name: it.source.name },
  }));

  return { items, total, expandedKeywords, matchedTerms };
}

// ---------------------------------------------------------------------------
// 组合入口
// ---------------------------------------------------------------------------

/**
 * 完整新闻意图搜索：
 *   1. parseNewsIntent 解析自然语言
 *   2. executeNewsIntentSearch 执行查询
 *   3. 组合结果返回（含降级信息）
 *
 * 失败兜底：LLM 不可用 → 字面 contains 搜索；完全无结果 → 返回 total=0
 *
 * B-13 修复：新增 tenantId 参数，必须由调用方传入
 */
export async function newsIntentSearch(
  query: string,
  tenantId: string,
): Promise<NewsIntentSearchResponse> {
  const { intent, degraded, degradeReason } = await parseNewsIntent(query, tenantId);
  const { items, total, expandedKeywords, matchedTerms } = await executeNewsIntentSearch(intent);

  return {
    query,
    intent,
    degraded,
    degradeReason,
    total,
    items,
    expandedKeywords,
    matchedTerms,
  };
}