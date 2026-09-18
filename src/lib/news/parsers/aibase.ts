/**
 * AIbase (aibase.com/zh/news) 专用解析器
 *
 * API 发现：分析 JS chunk 28 发现后端 API 基础 URL
 *   Base: https://app.chinaz.com/djflkdsoisknfoklsyhownfrlewfknoiaewf
 *   News list: /ai/GetAiInfoList.aspx
 *   Params: flag=zh_cn (中文) | en (英文), page, pagesize, type, sort, weight
 *
 * API 返回格式：
 *   { "0": { Id, title, subtitle, description, thumb, tags, sourcename,
 *             addtime, weight, type, ... }, ... }
 *
 * 注意：aibase.com 是 Next.js 客户端渲染，无 __NEXT_DATA__，RSS 也不可用。
 *       API 是唯一可靠数据源。
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText, parseError, type SourceFetchOutcome } from './types';

const SOURCE_NAME = 'AIbase';
const API_BASE = 'https://app.chinaz.com/djflkdsoisknfoklsyhownfrlewfknoiaewf';

/** API 返回的单条新闻 */
interface AibaseNewsItem {
  Id: number;
  title: string;
  subtitle: string;
  description: string;
  thumb: string;
  tags: string;
  sourcename: string;
  author: string;
  addtime: string; // "2026-09-01 17:01:59"
  updtime: string;
  weight: number;
  type: number;
  url: string;
}

/** API 整体响应：数字键指向新闻对象 */
interface AibaseApiResponse {
  [key: string]: AibaseNewsItem;
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * 抓取并解析 AIbase 新闻
 *
 * @param lang  语言标志：zh_cn | en | jp | zh_tw
 * @param page  页码（从 1 开始）
 * @param pageSize 每页数量（默认 20）
 */
export async function fetchAibaseNews(
  lang: 'zh_cn' | 'en' | 'jp' | 'zh_tw' = 'zh_cn',
  page: number = 1,
  pageSize: number = 20,
): Promise<SourceFetchOutcome> {
  try {
    const params = new URLSearchParams({
      flag: lang,
      page: String(page),
      pagesize: String(pageSize),
    });

    const apiUrl = `${API_BASE}/ai/GetAiInfoList.aspx?${params}`;

    const res = await fetchWithRetry(
      apiUrl,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIHub-Bot/1.0)',
          'Referer': 'https://www.aibase.com/',
          'Accept': 'application/json',
        },
      },
      { maxRetries: 2, timeoutMs: 15_000 },
    );

    if (!res.ok) {
      return { items: [], error: `API HTTP ${res.status}` };
    }

    const json = await res.json() as AibaseApiResponse;

    const keys = Object.keys(json).filter(k => !isNaN(Number(k)));
    const items: SourceFetchOutcome['items'] = [];

    for (const key of keys) {
      const item = json[key];
      if (!item || typeof item !== 'object') continue;

      const title = item.title?.trim();
      if (!title || title.length < 5) continue;

      // aibase 自身就是 AI 新闻平台，无需关键词过滤
      const description = cleanText(item.description || '').slice(0, 500) || undefined;
      const summary = item.subtitle?.trim()
        ? cleanText(item.subtitle).slice(0, 500)
        : description;

      const publishedAt = parseDate(item.addtime);
      const coverUrl = item.thumb && item.thumb.length > 0 ? item.thumb : undefined;
      const sourceLabel = item.sourcename?.trim()
        ? `AIbase·${item.sourcename}`
        : SOURCE_NAME;

      // AIbase 文章详情页 URL
      const detailUrl = `https://www.aibase.com/news/${item.Id}`;

      items.push({
        title: cleanText(title),
        url: detailUrl,
        summary,
        publishedAt,
        publishPrecision: publishedAt ? 'second' : null,
        crawledAt: new Date(),
        sourceName: sourceLabel,
        coverUrl,
      });
    }

    return { items };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}
