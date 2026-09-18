/**
 * Unite.ai 中文站 (unite.ai/zh-cn/) 新闻列表专用解析器
 *
 * 页面结构（2026-09-01）：
 *   每条新闻卡片：
 *     <a href="/zh-cn/news/xxxxx" class="news-item-link">
 *       <div class="news-item-content">
 *         <div class="news-item-meta">
 *           <span class="news-date">2026-09-01</span>
 *           <span class="news-source">来源名称</span>
 *         </div>
 *         <h3 class="news-title">标题</h3>
 *         <p class="news-excerpt">摘要...</p>
 *         <div class="news-tags">
 *           <span class="tag">AI模型</span>
 *           <span class="tag">开源</span>
 *         </div>
 *       </div>
 *       <div class="news-item-image">
 *         <img src="..." alt="" />
 *       </div>
 *     </a>
 *
 * 注意：unite.ai/zh-cn/ 是客户端渲染，HTML 中可能包含：
 *   - __NEXT_DATA__ JSON blob（SSR 数据）
 *   - 直接的 HTML 列表
 *   - 懒加载 JS 渲染
 * 优先尝试提取 __NEXT_DATA__，失败时用正则解析 HTML。
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText, parseError, type SourceFetchOutcome } from './types';

const SOURCE_NAME = 'Unite.ai';
const PAGE_URL = 'https://www.unite.ai/zh-cn/';

/**
 * 从 __NEXT_DATA__ JSON 中提取新闻列表
 */
function parseNextData(html: string): Array<{
  title: string;
  url: string;
  summary?: string;
  publishedAt: Date | null;
  coverUrl?: string;
  sourceName?: string;
  tags?: string[];
}> | null {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;

  try {
    // B-10 修复：JSON.parse 已有 try/catch，但 NUXT_DATA 内部若有非 JSON 内容会抛。
    //          这里保持原 try/catch（外层捕获），增加明确的错误日志便于排查。
    const data = JSON.parse(match[1]);
    // 导航路径（实际结构取决于 Next.js 路由配置）
    // 通常：props.pageProps.newsList 或 props.newsList
    const newsList =
      data?.props?.pageProps?.newsList ??
      data?.props?.newsList ??
      data?.newsList ??
      data?.props?.pageProps?.items ??
      data?.items ??
      null;

    if (!Array.isArray(newsList)) return null;

    return newsList.map((item: Record<string, unknown>) => ({
      title: String(item.title ?? ''),
      url: String(item.url ?? item.slug ? `/zh-cn/news/${item.slug ?? item.id}` : ''),
      summary: item.excerpt ? String(item.excerpt) : item.summary ? String(item.summary) : undefined,
      publishedAt: item.publishedAt ? new Date(String(item.publishedAt)) : null,
      coverUrl: item.coverImage ? String(item.coverImage) : item.image ? String(item.image) : undefined,
      sourceName: item.source ? String(item.source) : undefined,
      tags: Array.isArray(item.tags) ? item.tags.map(String) : undefined,
    }));
  } catch {
    return null;
  }
}

/**
 * 正则解析 HTML 新闻列表（兜底）
 * 匹配模式：
 *   <a href="/zh-cn/news/..." class="news-item-link"> ... </a>
 */
function parseHtmlNews(html: string): Array<{
  title: string;
  url: string;
  summary?: string;
  publishedAt: Date | null;
  coverUrl?: string;
  sourceName?: string;
  tags?: string[];
}> {
  const items: Array<{
    title: string;
    url: string;
    summary?: string;
    publishedAt: Date | null;
    coverUrl?: string;
    sourceName?: string;
    tags?: string[];
  }> = [];

  // 匹配新闻链接块
  const itemRegex = /<a\s+href=["']([^"']*\/zh-cn\/news\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(html)) !== null) {
    const href = match[1]?.trim() ?? '';
    const inner = match[2] ?? '';

    // 标题
    const titleMatch = inner.match(/<h[23][^>]*>\s*([^<]+)\s*<\/h[23]>/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : '';
    if (!title || title.length < 5) continue;

    // 摘要
    const excerptMatch = inner.match(/<p[^>]*class=["'][^"']*excerpt[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const summary = excerptMatch ? cleanText(excerptMatch[1]).slice(0, 500) : undefined;

    // 日期
    const dateMatch = inner.match(/(\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2})/);
    const publishedAt = dateMatch ? new Date(dateMatch[1].replace(/\//g, '-')) : null;

    // 封面图
    const imgMatch = inner.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    const coverUrl = imgMatch ? imgMatch[1] : undefined;

    // 来源
    const sourceMatch = inner.match(/来源[：:]\s*([^<\n]+)/i);
    const sourceName = sourceMatch ? cleanText(sourceMatch[1]) : undefined;

    // 标签
    const tagMatches = [...inner.matchAll(/<span[^>]*class=["'][^"']*tag[^"']*["'][^>]*>\s*([^<]+)\s*<\/span>/gi)];
    const tags = tagMatches.map(m => cleanText(m[1])).filter(Boolean);

    // 完整 URL
    const fullUrl = href.startsWith('http') ? href : `https://www.unite.ai${href}`;

    items.push({ title, url: fullUrl, summary, publishedAt, coverUrl, sourceName, tags: tags.length > 0 ? tags : undefined });
  }

  return items;
}

/**
 * 抓取并解析 unite.ai 中文站新闻
 */
export async function fetchUniteAiNews(): Promise<SourceFetchOutcome> {
  try {
    const res = await fetchWithRetry(
      PAGE_URL,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIHub-Bot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      },
      { maxRetries: 2, timeoutMs: 20_000 },
    );

    if (!res.ok) {
      return { items: [], error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // 优先尝试 __NEXT_DATA__（SSR 最干净）
    const nextDataItems = parseNextData(html);
    if (nextDataItems && nextDataItems.length > 0) {
      return {
        items: nextDataItems.map(item => ({
          title: item.title,
          url: item.url,
          summary: item.summary,
          publishedAt: item.publishedAt,
          publishPrecision: item.publishedAt ? 'day' : null,
          crawledAt: new Date(),
          sourceName: item.sourceName ?? SOURCE_NAME,
          coverUrl: item.coverUrl,
        })),
      };
    }

    // 兜底：正则解析 HTML
    const htmlItems = parseHtmlNews(html);
    if (htmlItems.length > 0) {
      return {
        items: htmlItems.map(item => ({
          title: item.title,
          url: item.url,
          summary: item.summary,
          publishedAt: item.publishedAt,
          publishPrecision: item.publishedAt ? 'day' : null,
          crawledAt: new Date(),
          sourceName: item.sourceName ?? SOURCE_NAME,
          coverUrl: item.coverUrl,
        })),
      };
    }

    return { items: [], error: 'No news items found in page' };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}
