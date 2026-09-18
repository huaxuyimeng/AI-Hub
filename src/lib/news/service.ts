/**
 * AI 新闻聚合服务
 *
 * 来源：整合 plan §3 + ai-news-daily 原型
 * 功能：
 *   1. RSS/HTML/API 多源抓取
 *   2. 实体指纹多源去重 + 交叉验证（P0-4 修复）
 *   3. 模型名自动提取 + 关联
 *   4. 自动分类（AI Coding / 具身智能 / AI政策）
 */

import { prismaBase as prisma } from '@/lib/db';
import { CATEGORY_KEYWORDS, NEWS_SOURCES, AI_COMPANIES, extractCompanyTags, type NewsSourceConfig } from './sources';
import { parseRssPubDate } from '@/lib/utils/parse-date';
import { tokenize, MULTI_SOURCE_MIN_SHARED } from '@/lib/utils/entity-fingerprint';
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { applyHealth, getUnhealthySources } from './health';
import { logger } from '@/lib/observability/logger';
import { Semaphore } from '@/lib/utils/concurrency';
import {
  parseRssXml,
  fetchHtml,
  fetchHackerNews,
  fetchAitntPage,
  fetchTmtpostNews,
  fetchAibotDailyNews,
  fetchMaomuNews,
  fetchAibaseNews,
  fetchUniteAiNews,
  type FetchedItem,
  type SourceFetchOutcome,
  fetchWechatArticle,
  isWechatArticleUrl,
  parseError,
} from './parsers';

// 重新导出，保持向后兼容（其它模块可能 import 自 service）
export type { FetchedItem } from './parsers';

/**
 * 抓取 Hacker News Algolia API 已移至 ./parsers/hacker-news.ts
 */

/**
 * 从单个源抓取
 *
 * 各类型对应的 parser 已拆分到 ./parsers/ 目录
 */
export async function fetchFromSource(source: NewsSourceConfig): Promise<SourceFetchOutcome> {
  switch (source.type) {
    case 'rss': {
      // 拉取 + RSS 解析
      try {
        const res = await fetchWithRetry(
          source.url,
          {
            headers: {
              'User-Agent': 'AIHub-Bot/1.0 (+https://github.com)',
              Accept: 'application/rss+xml, application/xml, text/xml',
            },
          },
          { maxRetries: 2, timeoutMs: 15_000 },
        );
        if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
        const xml = await res.text();
        return { items: parseRssXml(xml, source.name) };
      } catch (err) {
        return { items: [], error: (err as Error).message };
      }
    }
    case 'api': {
      if (source.url.includes('hn.algolia.com')) {
        return fetchHackerNews(source.url);
      }
      return { items: [], error: 'unsupported api' };
    }
    case 'html':
      // 专用解析器优先（URL 模式匹配）
      if (source.url.includes('aitntnews.com/newList.html?typeId=')) {
        const typeIdMatch = source.url.match(/typeId=(\d+)/);
        const typeId = typeIdMatch ? typeIdMatch[1] : '1';
        return fetchAitntPage(typeId, source.name);
      }
      if (source.url.includes('tmtpost.com/new')) {
        return fetchTmtpostNews(source.name);
      }
      if (source.url.includes('ai-bot.cn/daily-ai-news/')) {
        return fetchAibotDailyNews();
      }
      if (source.url.includes('maomu.com/news')) {
        return fetchMaomuNews();
      }
      if (source.url.includes('aibase.com')) {
        return fetchAibaseNews('zh_cn');
      }
      if (source.url.includes('unite.ai/zh-cn/')) {
        return fetchUniteAiNews();
      }
      // 微信公众号文章：直接抓 mp.weixin.qq.com/s/{sig} 公开页面
      //   底层通过 window.cgiDataNew.content_noencode 解码，无需 JS 渲染
      if (isWechatArticleUrl(source.url)) {
        return fetchWechatArticle(source.url).then((article) => {
          if (article.error) return { items: [], error: article.error };
          const ts = article.publishedAt;
          // publishedAt 是 Unix 秒，超过 1e12 说明已经是毫秒（未来年份），直接用；否则转毫秒
          const publishedAt = ts ? new Date(ts > 1e12 ? ts : ts * 1000) : null;
          return {
            items: article.items.map((item) => ({
              title: item.title,
              url: article.url,
              summary: item.summary,
              content: item.body,
              publishedAt,
              publishPrecision: ts ? 'day' : null,
              crawledAt: new Date(),
              // BUG-013 修复：统一用 source.name（与 NewsSource.name 对齐），
              // 便于 fetchAllNews 按 sources 筛选；account 仅用于 logger 上下文
              sourceName: source.name,
              coverUrl: article.images[0]?.url,
            })),
          };
        });
      }
      return fetchHtml(source.url, source.name);
    default:
      return { items: [], error: `unknown type ${source.type}` };
  }
}

/**
 * 标题相似度（简化版 Jaccard，用于精确匹配）
 */
function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 2));

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;

  return union === 0 ? 0 : intersection / union;
}

/**
 * 自动分类（基于关键词）
 *
 * Bug修复：
 *  - 优先 category 顺序：AI IDE > AI Coding > 具身智能 > AI政策
 *    当分数并列时，更具体的分类优先（产品级 > 通用级）。
 *    这是为了避免同一新闻因为关键词同时命中多个 category 时被随机归类。
 */
const CATEGORY_PRIORITY: Record<string, number> = {
  'AI IDE': 100,
  '具身智能': 90,
  'AI Coding': 80,
  'AI政策': 70,
};

export function classifyCategory(title: string, summary?: string): string | null {
  const text = `${title} ${summary ?? ''}`.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = keywords.filter((kw) => text.includes(kw.toLowerCase())).length;
  }

  // 排序：(score desc, priority desc) — 同分时具体分类优先
  const sorted = Object.entries(scores).sort((a, b) => {
    const scoreDiff = b[1] - a[1];
    if (scoreDiff !== 0) return scoreDiff;
    return (CATEGORY_PRIORITY[b[0]] ?? 0) - (CATEGORY_PRIORITY[a[0]] ?? 0);
  });

  return sorted[0] && sorted[0][1] > 0 ? sorted[0][0] : null;
}

/**
 * 模型名提取（标题 + 摘要）
 *
 * Bug修复：
 * - 原版使用 \b word boundary，在中文文本中完全不工作（如"中文GPT-4o"匹配失败）
 * - 改为 (?<![a-zA-Z]) 负向后查，在中英文场景均可用
 * - 统一 i 标志（不再依赖 /gi 全局遍历）
 * - 增加更多常见模型别名
 */
const MODEL_PATTERNS: Array<[RegExp, (m: string) => string]> = [
  // GPT 系列
  [/(?<![a-zA-Z])GPT-[\d]+(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase()],
  [/(?<![a-zA-Z])ChatGPT(?![a-zA-Z])/gi, () => 'chatgpt'],
  // Claude 系列
  [/(?<![a-zA-Z])Claude\s+(?:Fable|Opus|Sonnet|Haiku)\s*[\d]*(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '-')],
  [/(?<![a-zA-Z])Claude(?![a-zA-Z])/gi, () => 'claude'],
  // DeepSeek 系列
  // 注意：必须把 "DeepSeek-V4" 放在 "DeepSeek" 前面（前面规则更具体），否则会先匹配 "DeepSeek" 漏掉版本
  [/(?<![a-zA-Z])DeepSeek[-\s]?V[\d]+(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '')],
  [/(?<![a-zA-Z])DeepSeek[-\s]?(?:Coder|Harness|Chat)?(?![a-zA-Z])/gi, m => `deepseek-${(m.match(/Coder|Harness|Chat/i)?.[0] ?? '').toLowerCase()}`.replace(/-$/, '')],
  [/(?<![a-zA-Z])DeepSeek(?![a-zA-Z])/gi, () => 'deepseek'],
  // Gemini
  [/(?<![a-zA-Z])Gemini\s*[\d]*(?:\.[\d]+)?(?:\s*(?:Pro|Flash|Ultra))?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '-')],
  // Grok
  [/(?<![a-zA-Z])Grok[-\s]?[\d]+(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '-')],
  [/(?<![a-zA-Z])Grok(?![a-zA-Z])/gi, () => 'grok'],
  // Llama
  [/(?<![a-zA-Z])Llama\s*[\d]+(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '-')],
  // Mistral
  [/(?<![a-zA-Z])Mistral[-\s]?(?:Large|Nemo)?[\d]*(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '-')],
  // Qwen / 通义千问
  [/(?<![a-zA-Z])Qwen[-\s]?[\d]*(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '-')],
  [/(?<![a-zA-Z])通义千问(?![a-zA-Z])/gi, () => 'qwen'],
  // MiniMax / 秘塔
  [/(?<![a-zA-Z])MiniMax(?![a-zA-Z])/gi, () => 'minimax'],
  [/(?<![a-zA-Z])Kimi(?![a-zA-Z])/gi, () => 'kimi'],
  [/(?<![a-zA-Z])Moonshot(?![a-zA-Z])/gi, () => 'moonshot'],
  // GLM / 智谱
  [/(?<![a-zA-Z])GLM[\d]*(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase()],
  // Stable Diffusion
  [/(?<![a-zA-Z])Stable\s*Diffusion\s*[\d]*(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase().replace(/\s+/g, '-')],
  // o1 / GPT-4o / o3
  [/(?<![a-zA-Z])o[\d]+(?:\.\d+)?(?![a-zA-Z])/gi, m => m.toLowerCase()],
  [/(?<![a-zA-Z])o1(?![a-zA-Z])/gi, () => 'o1'],
  [/(?<![a-zA-Z])o3(?![a-zA-Z])/gi, () => 'o3'],
  // Yi / 零一
  [/(?<![a-zA-Z])Yi-?[\d]+(?:\.[\d]+)?(?![a-zA-Z])/gi, m => m.toLowerCase()],
  [/(?<![a-zA-Z])零一万物(?![a-zA-Z])/gi, () => '01-ai'],
  // 讯飞星火
  [/(?<![a-zA-Z])讯飞星火(?![a-zA-Z])/gi, () => 'iflytek'],
  // Command-R
  [/(?<![a-zA-Z])Command[-\s]?R(?![a-zA-Z])/gi, () => 'command-r'],
  // NVIDIA NeMo
  [/(?<![a-zA-Z])NeMo(?![a-zA-Z])/gi, () => 'nemo'],
  // Cursor / Origin / Harness
  [/(?<![a-zA-Z])Cursor(?![a-zA-Z])/gi, () => 'cursor'],
  [/(?<![a-zA-Z])Harness(?![a-zA-Z])/gi, () => 'harness'],
  [/(?<![a-zA-Z])Origin(?![a-zA-Z])/gi, () => 'cursor-origin'],
  // Qoder
  [/(?<![a-zA-Z])Qoder(?![a-zA-Z])/gi, () => 'qoder'],
  // WorkBuddy
  [/(?<![a-zA-Z])WorkBuddy(?![a-zA-Z])/gi, () => 'workbuddy'],
  // Windsurf
  [/(?<![a-zA-Z])Windsurf(?![a-zA-Z])/gi, () => 'windsurf'],
  // Perplexity
  [/(?<![a-zA-Z])Perplexity(?![a-zA-Z])/gi, () => 'perplexity'],
];

export function extractModelNames(text: string): string[] {
  const names = new Set<string>();
  for (const [regex, normalize] of MODEL_PATTERNS) {
    const matches = text.matchAll(regex);
    for (const m of matches) {
      if (m[0]) names.add(normalize(m[0]));
    }
  }
  return [...names];
}

/**
 * 多源交叉验证（P0-4 修复）
 * 
 * 使用实体指纹替代 Jaccard 阈值 0.4：
 *   1. 第一步：精确匹配或 Jaccard >= 0.7 的粗合并
 *   2. 第二步：实体指纹发现跨组多源关联
 *   3. 阈值从 MULTI_SOURCE_MIN_SHARED (3) 共享 Token 才认定为同事件
 */
export function dedupeAndCross(items: FetchedItem[]): FetchedItem[] {
  // 第一步：粗粒度合并（精确标题或 Jaccard >= 0.7）
  const groups: FetchedItem[][] = [];
  const SIMILARITY_THRESHOLD = 0.7; // 提高阈值避免误合

  for (const item of items) {
    let matched = false;
    for (const group of groups) {
      if (item.title === group[0].title || titleSimilarity(item.title, group[0].title) >= SIMILARITY_THRESHOLD) {
        group.push(item);
        matched = true;
        break;
      }
    }
    if (!matched) groups.push([item]);
  }

  // 第二步：实体指纹发现跨组多源关联
  // idOf 用 group[0].url || group[0].title；但同一个 id 可能对应多个 group（微信单页多条目等场景），
  // 所以 byId 用 (idOf, groupIndex) 双键避免冲突，flatItems 带 _idx 用于关系回查
  const idOf = (g: FetchedItem[]) => g[0].url || g[0].title;

  const flatItems = groups.map((g, i) => ({
    id: idOf(g),
    source: g[0].sourceName,
    title: g[0].title,
    summary: g[0].summary ?? null,
    ref: g,
    _idx: i,
  }));

  const relations = findMultiSourceRelations(flatItems);

  // byId 用 (idOf + groupIndex) 双键，确保同一 id 的不同 group 不会被覆盖
  const byId = new Map<string, FetchedItem>();
  groups.forEach((grp, i) => byId.set(`${idOf(grp)}::${i}`, grp[0]));

  for (const rel of relations) {
    // 找到 rel.itemId 对应的 group
    const item = byId.get(rel.itemId);
    if (item) {
      item.crossSources = [...new Set([...(item.crossSources ?? []), ...rel.sources.filter(s => s !== item.sourceName)])];
    }
  }

  return groups.map((group) => {
    // 按发布时间排序（null 排到最后）
    group.sort((a, b) => {
      const aT = a.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bT = b.publishedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aT - bT;
    });
    const primary = group[0];
    const otherSources = group.slice(1).map((g) => g.sourceName).filter(Boolean);
    const allSources = [...new Set([...(primary.crossSources ?? []), ...otherSources])];

    return {
      ...primary,
      crossSources: allSources,
    };
  });
}

/** 查找多源关联（内部函数） */
function findMultiSourceRelations<T extends { id: string; source: string; title: string; summary?: string | null }>(
  items: T[]
) {
  const toks = items.map(it => tokenize(it.title, it.summary ?? ''));
  const relations: { sources: string[]; itemId: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const rel = new Set<string>([items[i].source]);

    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;

      let shared = 0;
      for (const t of toks[i]) {
        if (toks[j].has(t)) shared++;
      }

      if (shared >= MULTI_SOURCE_MIN_SHARED) {
        rel.add(items[j].source);
      }
    }

    if (rel.size > 1) {
      relations.push({ sources: [...rel], itemId: items[i].id });
    }
  }

  return relations;
}

/**
 * 保存抓取结果到数据库
 *
 * P0-1 修复：publishedAt 可为 null，不回退为抓取时间
 * P2-2 修复：followedModels 作为兜底 hint — 若 LLM 抽取漏掉用户关注的模型名，
 *           用字符串 contains 把关注模型名附加到 relatedModels，
 *           让排行详情页的"模型相关新闻"能召回冷门新闻
 *
 * Bug修复（历史去重）：新增前先查询数据库中已有标题，标题完全相同则跳过，
 *           避免"同一事件多 URL"重复入库（如 DeepSeek Harness 两条不同 URL 同时入库）
 */
export async function saveItems(
  items: FetchedItem[],
  followedModels?: string[],
): Promise<number> {
  if (items.length === 0) return 0;

  // 关注模型名 → display 名（用于 contains 匹配）
  const followedNames = (followedModels ?? [])
    .map((id) => id.toLowerCase().trim())
    .filter(Boolean);

  const sourceNames = [...new Set(items.map((it) => it.sourceName).filter(Boolean))];
  const existingSources = await prisma.newsSource.findMany({
    where: { name: { in: sourceNames } },
  });
  const sourceMap = new Map(existingSources.map((s) => [s.name, s]));

  const missing = sourceNames.filter((n) => !sourceMap.has(n));
  if (missing.length > 0) {
    // 从 NEWS_SOURCES 配置中查找 URL 和 type（支持 HTML/专用解析器源）
    const configByName = new Map(NEWS_SOURCES.map((s) => [s.name, s]));
    await prisma.newsSource.createMany({
      data: missing.map((name) => {
        const cfg = configByName.get(name);
        return {
          name,
          url: cfg?.url ?? '',
          type: cfg?.type ?? 'rss',
          lastFetchAt: new Date(),
        };
      }),
    });
    const newSources = await prisma.newsSource.findMany({
      where: { name: { in: missing } },
    });
    newSources.forEach((s) => sourceMap.set(s.name, s));
  }

  // 历史去重：查询数据库中已有标题，跳过完全重复的
  const newTitles = items.map((it) => it.title.trim()).filter(Boolean);
  const existingItems = await prisma.newsItem.findMany({
    where: {
      deletedAt: null,
      title: { in: newTitles },
    },
    select: { title: true, url: true },
  });
  const existingTitleSet = new Set(existingItems.map((r) => r.title.trim()));
  // 同时收集已有 url（已有 url 的 item 直接走 update，不重复创建）
  const existingUrlSet = new Set(existingItems.map((r) => r.url));

  let saved = 0;
  const BATCH_SIZE = 50;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    // 过滤掉标题完全重复的（历史去重）
    const toProcess = batch.filter((item) => {
      if (existingTitleSet.has(item.title.trim())) return false;
      if (existingUrlSet.has(item.url)) return false; // 同 URL 不重复
      return true;
    });
    if (toProcess.length === 0) continue;

    try {
      await prisma.$transaction(
        toProcess.map((item) => {
          const source = sourceMap.get(item.sourceName);
          if (!source) throw new Error(`Source not found: ${item.sourceName}`);
          let relatedModels = extractModelNames(`${item.title} ${item.summary ?? ''}`).join(',');
          // P2-2: followedModels 兜底补充（低权重、不覆盖已有抽取）
          if (followedNames.length > 0) {
            const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase();
            const existing = new Set(relatedModels.split(',').filter(Boolean));
            for (const fm of followedNames) {
              if (haystack.includes(fm) && !existing.has(fm)) {
                existing.add(fm);
              }
            }
            relatedModels = [...existing].join(',');
          }
          const companyTags = extractCompanyTags(`${item.title} ${item.summary ?? ''}`).join(',');
          const crossSources = (item.crossSources ?? []).join(',');
          const category = classifyCategory(item.title, item.summary);
          return prisma.newsItem.upsert({
            where: { url: item.url },
            update: {
              summary: item.summary,
              relatedModels,
              companyTags,
              coverUrl: item.coverUrl ?? undefined,
              crossSources,
              category: category ?? undefined,
              // 如果之前 publishedAt 为 null 而现在有值，补上时间
              publishedAt: item.publishedAt ?? undefined,
              publishPrecision: item.publishPrecision ?? undefined,
            },
            create: {
              title: item.title,
              url: item.url,
              sourceId: source.id,
              summary: item.summary,
              content: item.content,
              // 时间未知时存 null（schema 允许），绝不回退为抓取时间或 epoch
              publishedAt: item.publishedAt,
              publishPrecision: item.publishPrecision ?? undefined,
              coverUrl: item.coverUrl ?? null,
              category: category ?? undefined,
              relatedModels,
              companyTags,
              crossSources,
              confidence: crossSources.length > 0 ? 'A' : 'B',
            },
          });
        }),
      );
      saved += toProcess.length;
    } catch (err) {
      // BUG-018 修复：批次事务失败时降级为单条 upsert，避免一条脏数据丢失整批
      logger.error('batch save failed, retrying per-item', {
        error: parseError(err),
        count: toProcess.length,
      });
      for (const item of toProcess) {
        try {
          const source = sourceMap.get(item.sourceName);
          if (!source) continue;
          const haystack = `${item.title} ${item.summary ?? ''}`;
          const relatedModels = extractModelNames(haystack).join(',');
          const companyTags = extractCompanyTags(haystack).join(',');
          const crossSources = (item.crossSources ?? []).join(',');
          const category = classifyCategory(item.title, item.summary);
          await prisma.newsItem.upsert({
            where: { url: item.url },
            update: {
              summary: item.summary,
              relatedModels,
              companyTags,
              coverUrl: item.coverUrl ?? undefined,
              crossSources,
              category: category ?? undefined,
              publishedAt: item.publishedAt ?? undefined,
              publishPrecision: item.publishPrecision ?? undefined,
            },
            create: {
              title: item.title,
              url: item.url,
              sourceId: source.id,
              summary: item.summary,
              content: item.content,
              publishedAt: item.publishedAt,
              publishPrecision: item.publishPrecision ?? undefined,
              coverUrl: item.coverUrl ?? null,
              category: category ?? undefined,
              relatedModels,
              companyTags,
              crossSources,
              confidence: crossSources.length > 0 ? 'A' : 'B',
            },
          });
          saved++;
        } catch (singleErr) {
          logger.warn('single item save failed', {
            title: item.title,
            url: item.url,
            error: parseError(singleErr),
          });
        }
      }
    }
  }

  return saved;
}

/**
 * 主入口：从所有源抓取新闻
 * 
 * @param options 可选的用户偏好参数（P0-3 修复）
 */
export async function fetchAllNews(options?: {
  categories?: string[];
  sources?: string[];
  followedModels?: string[];
}): Promise<{
  sources: Array<{ name: string; count: number; success: boolean; fragile?: boolean }>;
  totalItems: number;
  warnings: string[];
  errors: string[];
}> {
  const sources = await prisma.newsSource.findMany({
    where: { enabled: true },
    orderBy: { priority: 'desc' },
  });

  const fragileByName = new Map(NEWS_SOURCES.map((s) => [s.name, !!s.fragile]));

  const toConfig = (s: { name: string; url: string; type: string; priority: number; fragile?: boolean }): NewsSourceConfig => ({
    name: s.name,
    url: s.url,
    type: s.type as 'rss' | 'api' | 'html',
    priority: s.priority,
    fragile: s.fragile ?? fragileByName.get(s.name) ?? s.type === 'html',
  });

  let configs: NewsSourceConfig[];
  if (options?.sources && options.sources.length > 0) {
    configs = sources.filter((s) => options.sources!.includes(s.name)).map(toConfig);
  } else {
    // BUG-014 修复：降级到 NEWS_SOURCES 时也要过滤掉 enabled: false 的源
    configs = sources.length > 0 ? sources.map(toConfig) : NEWS_SOURCES.filter(s => s.enabled !== false);
  }

  const allItems: FetchedItem[] = [];
  const results: Array<{ name: string; count: number; success: boolean; fragile?: boolean }> = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const sem = new Semaphore(5);
  const settled = await Promise.allSettled(
    configs.map(async (cfg) => {
      await sem.acquire();
      try {
        const t0 = Date.now();
        const outcome = await fetchFromSource(cfg);
        const ms = Date.now() - t0;
        const ok = !outcome.error;
        await applyHealth(
          cfg.name,
          { ok, count: outcome.items.length, ms, error: outcome.error ?? null },
        );
        return { cfg, outcome, ok };
      } finally {
        sem.release();
      }
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const cfg = configs[i];
    if (r.status !== 'fulfilled') {
      const msg = `${cfg.name}: ${String(r.reason)}`;
      if (cfg.fragile) warnings.push(msg);
      else errors.push(msg);
      results.push({ name: cfg.name, count: 0, success: false, fragile: cfg.fragile });
      logger.warn('source fetch rejected', { source: cfg.name, error: String(r.reason) });
      continue;
    }

    const { outcome, ok } = r.value;
    if (outcome.error) {
      const msg = `${cfg.name}: ${outcome.error}`;
      if (cfg.fragile) warnings.push(msg);
      else errors.push(msg);
    } else if (outcome.items.length === 0) {
      warnings.push(`${cfg.name}: empty result`);
    }

    allItems.push(...outcome.items);
    results.push({
      name: cfg.name,
      count: outcome.items.length,
      success: ok,
      fragile: cfg.fragile,
    });
  }

  const deduped = dedupeAndCross(allItems);

  // 关注分类过滤：只入库命中分类的新闻（未分类的一并丢弃）
  let toSave = deduped;
  if (options?.categories && options.categories.length > 0) {
    const allowed = new Set(options.categories);
    toSave = deduped.filter((it) => {
      const cat = classifyCategory(it.title, it.summary);
      return cat !== null && allowed.has(cat);
    });
    const dropped = deduped.length - toSave.length;
    if (dropped > 0) {
      warnings.push(`关注分类过滤：${dropped} 条不在关注分类内，未入库`);
    }
  }

  const totalSaved = await saveItems(toSave, options?.followedModels);

  // P1-7：健康度汇总告警
  const unhealthy = await getUnhealthySources();
  if (unhealthy.length > 0) {
    console.warn(
      `[news] 🚨 ${unhealthy.length} unhealthy sources:`,
      unhealthy.map(s => `${s.name} (failStreak=${s.failStreak}, emptyStreak=${s.emptyStreak})`).join(', ')
    );
  }

  return { sources: results, totalItems: totalSaved, warnings, errors };
}

/**
 * 查询新闻（带筛选）
 */
export interface NewsQueryOptions {
  date?: string;
  category?: string;
  source?: string;
  search?: string;
  /** 同义词展开后的关键词集合（优先于 search） */
  searchKeywords?: string[];
  companyTag?: string;
  limit?: number;
  /** 跳过前 N 条（用于分页，替代累积式 take） */
  skip?: number;
}

/** 北京时区偏移（本项目用户均在 UTC+8，日期边界统一按北京时间） */
const BJ_OFFSET_MS = 8 * 3600 * 1000;

/** 当前时刻对应的北京时间 00:00（返回真实 UTC 时间戳） */
export function beijingDayStart(now: Date = new Date()): Date {
  const bjWall = new Date(now.getTime() + BJ_OFFSET_MS);
  return new Date(
    Date.UTC(bjWall.getUTCFullYear(), bjWall.getUTCMonth(), bjWall.getUTCDate()) - BJ_OFFSET_MS,
  );
}

/** 构建新闻筛选 where 条件（queryNews / countNews 共用） */
function buildNewsWhere(options: NewsQueryOptions = {}): Record<string, unknown> {
  const where: Record<string, unknown> = { deletedAt: null };

  if (options.date) {
    // 用户选择的日期按北京时间解释
    const dayStart = new Date(`${options.date}T00:00:00+08:00`);
    const dayEnd = new Date(`${options.date}T23:59:59.999+08:00`);
    where.publishedAt = { gte: dayStart, lte: dayEnd };
  }

  if (options.category) {
    where.category = options.category;
  }

  if (options.source) {
    where.source = { name: options.source };
  }

  if (options.companyTag) {
    // 逗号分隔串内的精确匹配（contains 会让 "AI" 误命中所有含 AI 的标签）
    const t = options.companyTag;
    // 用 AND 包装 companyTag（不与后续 OR 关键词合并冲突）
    if (!Array.isArray(where.AND)) where.AND = [];
    (where.AND as Array<unknown>).push({
      OR: [
        { companyTags: t },
        { companyTags: { startsWith: `${t},` } },
        { companyTags: { endsWith: `,${t}` } },
        { companyTags: { contains: `,${t},` } },
      ],
    });
  }

  const keywords = options.searchKeywords?.filter(Boolean) ?? [];
  if (keywords.length > 0) {
    // 公司过滤走 AND；关键词搜索走 OR 放在同一个顶层 OR 内（AND/OR 顶层并列）
    const orClauses = keywords.flatMap((kw) => [
      { title: { contains: kw } },
      { summary: { contains: kw } },
    ]);
    if (Array.isArray(where.AND) && where.AND.length > 0) {
      // AND 内既有公司条件，又有关键词 OR：AND([{company OR条件}, {title:..., summary:...}])
      // 但 AND 内每个元素是 AND 关系，不是 OR。这里把关键词 OR 用一个 AND 包装：
      (where.AND as Array<unknown>).push({ OR: orClauses });
    } else {
      where.OR = orClauses;
    }
  } else if (options.search) {
    const orClauses = [
      { title: { contains: options.search } },
      { summary: { contains: options.search } },
    ];
    if (Array.isArray(where.AND) && where.AND.length > 0) {
      (where.AND as Array<unknown>).push({ OR: orClauses });
    } else {
      where.OR = orClauses;
    }
  }

  return where;
}

export async function queryNews(options: NewsQueryOptions = {}) {
  const items = await prisma.newsItem.findMany({
    where: buildNewsWhere(options),
    include: { source: true },
    // Prisma 6 + SQLite 兼容：避免嵌套 orderBy + nulls（部分环境不支持）
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: options.limit ?? 100,
    skip: options.skip ?? 0,
  });

  return items;
}

/** 按相同筛选条件统计总数（用于前端"匹配/剩余"计数） */
export async function countNews(options: NewsQueryOptions = {}): Promise<number> {
  return prisma.newsItem.count({ where: buildNewsWhere(options) });
}

/**
 * 获取所有可用日期（用于日历，按北京时间归日）
 */
export async function getAvailableDates(): Promise<string[]> {
  // Prisma SQLite 把 DateTime 存为毫秒时间戳字符串，需先 /1000 转 unixepoch；
  // 再按北京时间归日（+8 hours），避免凌晨 0-8 点的新闻被归入前一天
  const result = await prisma.$queryRaw<Array<{ date: string }>>`
    SELECT DISTINCT DATE(publishedAt / 1000, 'unixepoch', '+8 hours') as date
    FROM NewsItem
    WHERE deletedAt IS NULL AND publishedAt IS NOT NULL
    ORDER BY date DESC
    LIMIT 365
  `;

  return result
    .map(r => r.date)
    .filter(Boolean)
    .map(d => String(d).slice(0, 10));
}