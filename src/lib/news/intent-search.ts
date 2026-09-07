/**
 * 意图搜索 — 基于 LLM 的自然语言查询解析 + 模型排行过滤
 *
 * 路径：src/lib/news/intent-search.ts
 *
 * 设计：D-3 Day 1（docs/26-Phase2差异化功能实施计划.md §三 Day 1）
 * 行为：
 *   1. parseSearchIntent  — 用 gpt-4o-mini 把自然语言转为结构化 SearchIntent
 *   2. executeIntentSearch — 把 SearchIntent 转为 Prisma where/orderBy，执行查询
 *
 * 关键约束：
 *   - 仅用于 Model（模型排行），不处理 NewsItem
 *   - LLM 解析失败时降级为字面搜索（不过抛错）
 *   - 不修改 rankingsRouter 的 list/detail 等现有 procedure
 *   - B-13 修复：parseSearchIntent 必须接收 tenantId（之前用 'system' 字面量，AI Key 永远查不到）
 */

import { prismaBase as prisma } from '@/lib/db';
import { chat } from '@/lib/ai/router';
import { calculateValueScore, normalizeScores } from '@/lib/rankings/algorithm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 从自然语言解析出的结构化过滤条件 */
export interface SearchIntent {
  /** 原始查询 */
  query: string;
  /** 过滤条件 */
  filters?: {
    /** 厂商列表（normalized provider 名） */
    provider?: string[];
    /** 输入价格区间 USD/M */
    priceRange?: [number, number];
    /** 价格字段 */
    priceField?: 'input' | 'output';
    /** 最低能力分 0-100 */
    minIntelligence?: number;
    /** 最低速度分 */
    minSpeed?: number;
    /** 模型家族 */
    family?: string[];
    /** 来源国家（推断自 provider） */
    origin?: string[];
  };
  /** 排序方式 */
  sort?: 'relevance' | 'recent' | 'price-asc' | 'price-desc' | 'intelligence-desc' | 'speed-desc' | 'value-asc' | 'value-desc';
  /** 是否启用同义词展开（默认 true） */
  expandSynonyms?: boolean;
}

/** 单条模型搜索结果 */
export interface ModelSearchResult {
  id: string;
  externalId: string;
  name: string;
  provider: string;
  family: string | null;
  priceInput: number;
  priceOutput: number;
  intelligence: number | null;
  speed: number | null;
  description: string | null;
  isPending: boolean;
  valueScore: number;
  blendPrice: number;
  isExcluded: boolean;
  /** 排除原因（undefined = 未排除） */
  excludeReason?: string;
  rank: number;
}

/** 意图搜索完整响应 */
export interface IntentSearchResponse {
  /** 原始查询 */
  query: string;
  /** 解析后的结构化意图 */
  intent: SearchIntent;
  /** 是否降级为字面搜索 */
  degraded: boolean;
  /** 降级原因（如果有） */
  degradeReason?: string;
  /** 命中模型数（未截断） */
  total: number;
  /** 模型列表（最多 20 条） */
  models: ModelSearchResult[];
}

// ---------------------------------------------------------------------------
// Provider → Origin 映射（用于过滤"中文/英文"来源）
// ---------------------------------------------------------------------------

const PROVIDER_ORIGIN: Record<string, string> = {
  openai: '美国',
  anthropic: '美国',
  google: '美国',
  deepseek: '中国',
  xai: '美国',
  meta: '美国',
  mistral: '法国',
  alibaba: '中国',
  moonshot: '中国',
  minimax: '中国',
  ollama: '美国',
  'tencent cloud': '中国',
  'baidu cloud': '中国',
  '字节跳动': '中国',
  '字节': '中国',
  'baidu': '中国',
  'tongyi': '中国',
  '通义千问': '中国',
  'qwen': '中国',
};

function normalizeProvider(p: string): string {
  return p.toLowerCase().replace(/\s+/g, ' ').trim();
}

function providerMatchesOrigins(providers: string[], origins: string[]): boolean {
  for (const prov of providers) {
    const norm = normalizeProvider(prov);
    const origin = PROVIDER_ORIGIN[norm] ?? PROVIDER_ORIGIN[norm.split(' ')[0]] ?? '';
    if (origins.includes(origin)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** LLM 解析默认超时（ms） */
const PARSE_TIMEOUT_MS = 3500;

/** 结果截断 */
const RESULT_LIMIT = 20;

const INTENT_PROMPT = `你是一个 AI 模型搜索意图解析器。给定用户查询，提取以下结构化信息：

- query: 核心关键词（去除修饰词，只保留实质名词）
- filters:
  - provider: 厂商列表（必须是以下之一：OpenAI, Anthropic, Google, DeepSeek, xAI, Meta, Mistral, Alibaba, Moonshot, MiniMax, 字节跳动, 百度, 通义千问, Qwen, Ollama，大小写不敏感）
  - priceRange: [最小, 最大] USD/M tokens，只在用户提到价格时填
  - priceField: input | output，只在用户明确说"输入价"或"输出价"时填
  - minIntelligence: 0-100 的整数，只在用户提到"能力"、"性能"、"智商"等时填
  - minSpeed: 数值，只在用户明确提到速度时填
  - family: 模型家族（如 claude, gpt, gemini）
  - origin: ["中国"] 或 ["美国"]，只在用户明确提到"中文模型"或"国产"或"美国"时填
- sort: 排序（relevance | recent | price-asc | price-desc | intelligence-desc | speed-desc | value-asc | value-desc）
  - 按价格 → price-asc / price-desc
  - 按能力 → intelligence-desc
  - 按性价比 → value-asc / value-desc（推荐给用户时）
  - "最新" → recent
  - 默认 → value-asc（性价比升序）
- expandSynonyms: true

只返回 JSON，不要解释。
查询: {query}`.trim();

// ---------------------------------------------------------------------------
// parseSearchIntent — LLM 解析（失败时降级为字面搜索）
// ---------------------------------------------------------------------------

/**
 * 解析自然语言查询为结构化意图
 * 失败时返回 query=原始输入、degraded=true 的降级意图
 *
 * B-13 修复：新增 tenantId 参数（必须），用于 chat() 的租户上下文
 * 此前用 'system' 字面量 → AI Key 永远查不到 → dev-mode mock 占位
 */
export async function parseSearchIntent(
  query: string,
  tenantId: string,
): Promise<{ intent: SearchIntent; degraded: boolean; degradeReason?: string }> {
  if (!query.trim()) {
    return { intent: { query, expandSynonyms: true }, degraded: false };
  }

  try {
    // 用 Promise.race 实现 3.5s 超时（chat() 不直接支持 signal）
    const timeoutMs = PARSE_TIMEOUT_MS;
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('LLM_PARSE_TIMEOUT')), timeoutMs);
    });

    try {
      const res = await Promise.race([
        chat(
          'gpt-4o-mini',
          tenantId, // B-13 修复：传真实 tenantId（不再用 'system' 字面量）
          [{ role: 'user', content: INTENT_PROMPT.replace('{query}', query) }],
          { temperature: 0.1 }
        ),
        timeoutPromise,
      ]);

      clearTimeout(timeoutId!);

      const raw = res.content.trim();
      const parsed = JSON.parse(raw || '{}') as Partial<SearchIntent>;

      // 规范化 provider 大小写
      if (parsed.filters?.provider) {
        parsed.filters.provider = parsed.filters.provider.map((p) =>
          p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        );
      }

      return {
        intent: {
          query: parsed.query ?? query,
          filters: parsed.filters,
          sort: parsed.sort ?? 'value-asc',
          expandSynonyms: parsed.expandSynonyms ?? true,
        },
        degraded: false,
      };
    } catch (innerErr) {
      // Promise.race 失败（超时 / chat 抛错）→ 透传到外层 catch
      clearTimeout(timeoutId!);
      throw innerErr;
    }
  } catch (err) {
    // 区分超时与一般错误，便于 UI 给出更精准的提示
    const isAbort =
      err instanceof Error &&
      (/abort|abortError|aborted|timeout/i.test(err.message) ||
        err.message === 'LLM_PARSE_TIMEOUT');
    return {
      intent: { query, sort: 'value-asc', expandSynonyms: false },
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
// executeIntentSearch — Prisma 查询
// ---------------------------------------------------------------------------

/**
 * 执行意图搜索（Model 表）
 * 结合意图解析结果 + 性价比算法
 */
export async function executeIntentSearch(intent: SearchIntent): Promise<{ models: ModelSearchResult[]; total: number }> {
  const { query, filters = {}, sort = 'value-asc' } = intent;

  // 1. 构建 Prisma where
  const where: Record<string, unknown> = {
    isActive: true,
    deletedAt: null,
  };

  // 文本搜索（name / description）
  if (query.trim()) {
    where.OR = [
      { name: { contains: query } },
      { description: { contains: query } },
      { externalId: { contains: query } },
      { provider: { contains: query } },
    ];
  }

  // 2. filters — 收集 provider/origin 条件，统一在最后合并为 AND 组
  // 避免多次赋值同一字段导致后者覆盖前者（H-5 修复）
  const providerConditions: object[] = [];

  if (filters.provider?.length) {
    // provider 精确匹配（支持模糊，如 "OpenAI" 匹配 "OpenAI"）
    const normalized = filters.provider.map((p) => p.toLowerCase());
    providerConditions.push(
      ...normalized.map((p) => ({ provider: { contains: p } }))
    );
  }

  if (filters.minIntelligence != null) {
    where.intelligence = { gte: filters.minIntelligence };
  }

  if (filters.minSpeed != null) {
    where.speed = { gte: filters.minSpeed };
  }

  if (filters.family?.length) {
    where.family = {
      OR: filters.family.map((f) => ({ contains: f })),
    };
  }

  if (filters.priceRange) {
    const [min, max] = filters.priceRange;
    const field = filters.priceField === 'output' ? 'priceOutput' : 'priceInput';
    where[field] = { gte: min, lte: max };
  }

  // origin 过滤：从 provider 推断，与 provider 条件合并为 AND
  if (filters.origin?.length) {
    const originProviders = Object.entries(PROVIDER_ORIGIN)
      .filter(([, origin]) => filters.origin!.includes(origin))
      .map(([prov]) => prov);
    providerConditions.push(
      ...originProviders.map((p) => ({ provider: { contains: p } }))
    );
  }

  // 统一落地：provider/origin 条件以 AND 组形式写入
  if (providerConditions.length > 0) {
    where.AND = providerConditions;
  }

  // 3. 排序
  let orderBy: Record<string, string> | undefined;
  switch (sort) {
    case 'recent': orderBy = { updatedAt: 'desc' }; break;
    case 'price-asc': orderBy = { priceInput: 'asc' }; break;
    case 'price-desc': orderBy = { priceInput: 'desc' }; break;
    case 'intelligence-desc': orderBy = { intelligence: 'desc' }; break;
    case 'speed-desc': orderBy = { speed: 'desc' }; break;
    case 'value-asc':
    case 'value-desc':
    case 'relevance':
    default:
      orderBy = undefined; // 在内存中按性价比排序
  }

  // 4. 执行查询（取 100 条用于性价比计算，内存截断）
  // 修复：构造强类型的 queryOptions，避免 any/Record 强转导致 Prisma 运行时错误
  const queryOptions = {
    where,
    take: 100,
    ...(orderBy ? { orderBy } : {}),
  } as Parameters<typeof prisma.model.findMany>[0];
  const raw = await prisma.model.findMany(queryOptions);

  // 5. 性价比计算 + 内存排序
  const scored = raw.map((m) => {
    const score = calculateValueScore({
      priceInput: m.priceInput,
      priceOutput: m.priceOutput,
      intelligence: m.intelligence ?? 0,
      speed: m.speed ?? 1,
    });
    return {
      id: m.id,
      externalId: m.externalId,
      name: m.name,
      provider: m.provider,
      family: m.family,
      priceInput: m.priceInput,
      priceOutput: m.priceOutput,
      intelligence: m.intelligence,
      speed: m.speed,
      description: m.description,
      isPending: m.isPending,
      valueScore: score.valueScore,
      blendPrice: score.blendPrice,
      isExcluded: score.isExcluded,
      excludeReason: score.reason,
    };
  });

  // 如果不是特定排序，按性价比排序
  if (!orderBy || sort === 'value-asc' || sort === 'value-desc' || sort === 'relevance') {
    scored.sort((a, b) => sort === 'value-desc' ? b.valueScore - a.valueScore : a.valueScore - b.valueScore);
  }

  // 归一化 rank
  const normalized = normalizeScores(scored);

  const total = normalized.length;
  const models = normalized.slice(0, 20).map((m, i) => ({ ...m, rank: i + 1 }));

  return { models, total };
}

// ---------------------------------------------------------------------------
// 组合搜索（解析 + 执行）
// ---------------------------------------------------------------------------

/**
 * 完整意图搜索：
 *   1. parseSearchIntent 解析自然语言
 *   2. executeIntentSearch 执行查询
 *   3. 组合结果返回（含降级信息）
 *
 * B-13 修复：新增 tenantId 参数，必须由调用方传入
 */
export async function intentSearch(
  query: string,
  tenantId: string,
): Promise<IntentSearchResponse> {
  const { intent, degraded, degradeReason } = await parseSearchIntent(query, tenantId);
  const { models, total } = await executeIntentSearch(intent);

  return {
    query,
    intent,
    degraded,
    degradeReason,
    total,
    models,
  };
}
