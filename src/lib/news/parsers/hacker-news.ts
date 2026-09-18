/**
 * Hacker News Algolia API 解析器
 *
 * 来源：archived/04-新闻聚合爬虫-深度诊断.md §P0-2 末尾"完整 parsers 目录"
 * 重构自原 src/lib/news/service.ts 中的 fetchHackerNews
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { parseError, type SourceFetchOutcome } from './types';

/**
 * 抓取 Hacker News Algolia API
 */
export async function fetchHackerNews(url: string): Promise<SourceFetchOutcome> {
  try {
    const res = await fetchWithRetry(url, {}, { maxRetries: 2, timeoutMs: 15_000 });
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };

    const json = (await res.json()) as { hits?: Array<{ title: string; url: string; created_at: string; story_text?: string }> };
    if (!json.hits) return { items: [] };

    return {
      items: json.hits.slice(0, 20).map((hit) => ({
        title: hit.title,
        url: hit.url,
        content: hit.story_text,
        publishedAt: new Date(hit.created_at),
        crawledAt: new Date(),
        sourceName: 'Hacker News AI',
      })),
    };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}