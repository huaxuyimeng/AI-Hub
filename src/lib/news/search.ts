/**
 * 基于术语词典的智能搜索
 * 路径：src/lib/news/search.ts
 *
 * 设计：D-2 Day 3（docs/26-Phase2差异化功能实施计划.md §二 Day 3）
 * 行为：
 *   1. 用 query 在 TermDictionary 中查找匹配的 canonical / displayName（仅 verified=true）
 *   2. 把命中的术语展开为 canonical + 所有 aliases
 *   3. 用展开后的关键词集合去 NewsItem 检索（标题或摘要 contains）
 *   4. 没有任何术语命中时，回退为字面搜索
 *
 * 关键约束：
 *   - verified=false 的词不进搜索
 *   - 不触碰 NewsItem.relatedModels 字段
 *   - 不修改 src/lib/news/service.ts
 *
 * 验收：
 *   - 搜索"GPT-4"能匹配 "gpt-4o"、"chatgpt-4"（通过别名展开）
 */

import { prismaBase as prisma } from '@/lib/db';

// ---------------------------------------------------------------------------
// 术语缓存（Issue-12）
//
// 设计：每次搜索拉一次 verified=true 全表，开销大。
// 改为 5 分钟 TTL 缓存；通过显式 invalidateTermsCache() 在
// refresh-terms cron / review-terms.ts 提交后清缓存，保证新审术语立即生效。
//
// 验证：单进程内存缓存即可（Next.js 单实例部署）。
// 如未来多实例部署需改 Redis 或数据库信号。
// ---------------------------------------------------------------------------

const TERM_CACHE_TTL_MS = 5 * 60 * 1000;
interface CacheEntry {
  terms: Array<{
    canonical: string;
    displayName: string;
    type: string;
    aliases: unknown;
  }>;
  loadedAt: number;
}
let termsCache: CacheEntry | null = null;

/** 获取已审核术语（带 5 分钟内存缓存） */
async function getCachedVerifiedTerms(): Promise<NonNullable<CacheEntry['terms']>> {
  const now = Date.now();
  if (termsCache && now - termsCache.loadedAt < TERM_CACHE_TTL_MS) {
    return termsCache.terms;
  }
  const terms = await prisma.termDictionary.findMany({ where: { verified: true } });
  termsCache = {
    terms: terms.map((t) => ({
      canonical: t.canonical,
      displayName: t.displayName,
      type: t.type,
      aliases: t.aliases,
    })),
    loadedAt: now,
  };
  return termsCache.terms;
}

/** 显式清缓存（供 review-terms / refresh-terms cron 调用） */
export function invalidateTermsCache(): void {
  termsCache = null;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: Date | null;
  category: string | null;
  coverUrl: string | null;
  source: { id: string; name: string };
}

export interface SearchResponse {
  /** 原始查询 */
  query: string;
  /** 实际用于搜索的关键词集合（含同义词展开） */
  expandedKeywords: string[];
  /** 命中的术语（用于 UI 展示"已展开 X 个同义词"） */
  matchedTerms: Array<{ canonical: string; displayName: string; type: string }>;
  /** 命中的新闻 */
  items: SearchResult[];
  /** 命中条数 */
  total: number;
}

/**
 * 判断 query 与 term 是否互为子串（双向 includes）
 *
 * 设计要点：
 *   - 单向 includes（term.includes(query)）只能匹配「短词搜长名」
 *     例：搜 "GPT" 命中 "GPT-4o" ✅；搜 "AGI" 命中 "artificial-general-intelligence" �
 *   - 双向 includes（query.includes(term)）支持「缩写搜全称」
 *     例：搜 "AGI" 命中 "AGI" ✅；搜 "MoE" 命中 "Mixture-of-Experts" ❌（仍需 aliases）
 *   - 同时启用：短词搜长名 ✅ + 缩写搜全称 ✅ + 全称搜自己 ✅
 *
 * 副作用：会把 "AI" 这种单字符的查询匹配到几乎所有 canonical 包含 "ai" 的术语
 * 缓解：query.length < 3 时跳过反向匹配（防止噪声爆炸）
 */
function biIncludes(term: string, query: string): boolean {
  if (!term || !query) return false;
  const t = term.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return true;
  if (q.length >= 3 && q.includes(t)) return true;
  return false;
}

/**
 * 展开查询为关键词集合
 * 仅展开 verified=true 的术语
 *
 * 实现：一次性拉取所有 verified 术语后内存匹配（词典规模小，
 * 避免按 canonical 逐条 findUnique 的 N+1 查询）。
 */
export async function expandQuery(query: string): Promise<{
  keywords: string[];
  matchedTerms: Array<{ canonical: string; displayName: string; type: string }>;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { keywords: [], matchedTerms: [] };

  // 模块级缓存：避免每次搜索都拉全表（Issue-12 修复）
  const allTerms = await getCachedVerifiedTerms();

  const matched = new Map<string, { canonical: string; displayName: string; type: string; aliases: string[] }>();
  for (const t of allTerms) {
    const aliases = Array.isArray(t.aliases) ? (t.aliases as string[]) : [];
    const hit =
      biIncludes(t.canonical, trimmed) ||
      biIncludes(t.displayName, trimmed) ||
      aliases.some((a) => biIncludes(a, trimmed));
    if (hit) {
      matched.set(t.canonical, {
        canonical: t.canonical,
        displayName: t.displayName,
        type: t.type,
        aliases,
      });
    }
  }

  const keywords = new Set<string>([trimmed]);
  for (const t of matched.values()) {
    keywords.add(t.canonical);
    keywords.add(t.displayName);
    for (const a of t.aliases) keywords.add(a);
  }

  return {
    keywords: [...keywords],
    matchedTerms: [...matched.values()].map(({ canonical, displayName, type }) => ({ canonical, displayName, type })),
  };
}

/**
 * 智能搜索（带同义词展开）
 */
export async function searchNews(query: string, limit = 20): Promise<SearchResponse> {
  const { keywords, matchedTerms } = await expandQuery(query);

  if (keywords.length === 0) {
    return { query, expandedKeywords: [], matchedTerms: [], items: [], total: 0 };
  }

  const items = await prisma.newsItem.findMany({
    where: {
      deletedAt: null,
      OR: keywords.map((kw) => ({
        OR: [{ title: { contains: kw } }, { summary: { contains: kw } }],
      })),
    },
    orderBy: [{ publishedAt: 'desc' }],
    take: limit,
    include: { source: true },
  });

  const plainItems: SearchResult[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    url: item.url,
    summary: item.summary,
    publishedAt: item.publishedAt,
    category: item.category,
    coverUrl: item.coverUrl,
    source: { id: item.source.id, name: item.source.name },
  }));

  return {
    query,
    expandedKeywords: keywords,
    matchedTerms,
    items: plainItems,
    total: plainItems.length,
  };
}

/**
 * 简单的同义词展开函数（无 DB 调用）
 * 用于纯查询场景（如预览 / 测试）
 * 输入查询字符串 → 返回扩展关键词集合
 */
export function expandSynonymsLocally(query: string, synonyms: Record<string, string[]>): string[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    for (const [key, syns] of Object.entries(synonyms)) {
      if (key === t || syns.some((s) => s.toLowerCase() === t)) {
        expanded.add(key);
        for (const s of syns) expanded.add(s.toLowerCase());
      }
    }
  }
  return [...expanded];
}