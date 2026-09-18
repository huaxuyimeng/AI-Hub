/**
 * AITNT AI 资讯专用 HTML 解析器
 *
 * 支持页面：
 *   typeId=1 → AI资讯（priority=9，用户指定最高）
 *   typeId=2 → AI技术研报（priority=8）
 *   typeId=3 → AI监管政策（priority=8）
 *   typeId=4 → AI产品测评（priority=8）
 *
 * 每页约 30 条，结构为 <article class="news-item">，包含：
 *   - 封面图：<img class="news-image" src="...">
 *   - 标题：<h2 class="h_tag"> + <a href="/newDetail.html?newId=...">
 *   - 摘要：<p class="news-description">
 *   - 日期：嵌入在 <p class="small text-muted"> 末尾，如 "2026-09-01 16:11"
 *
 * 不依赖 cheerio 等运行时库，纯正则实现（与项目现有 parsers 策略一致）。
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText, parseError, type SourceFetchOutcome } from './types';

export interface AitntSourceMeta {
  name: string;
  typeId: string;
  priority: number;
  notes: string;
}

export const AITNT_SOURCES: AitntSourceMeta[] = [
  {
    name: 'AITNT-AI资讯',
    typeId: '1',
    priority: 9,
    notes: 'AI综合资讯（用户指定最高优先级）',
  },
  {
    name: 'AITNT-AI技术研报',
    typeId: '2',
    priority: 8,
    notes: 'AI技术深度报告与研究',
  },
  {
    name: 'AITNT-AI监管政策',
    typeId: '3',
    priority: 8,
    notes: '全球AI监管与政策法规',
  },
  {
    name: 'AITNT-AI产品测评',
    typeId: '4',
    priority: 8,
    notes: 'AI产品实测与对比评测',
  },
];

/** 提取 <article class="news-item"> 块内容 */
const ARTICLE_BLOCK_REGEX = /<article class="news-item"[^>]*>([\s\S]*?)<\/article>/gi;

/** 从块内提取封面图 URL */
const COVER_REGEX = /<img[^>]+class="news-image"[^>]+src\s*=\s*(["'])([^"']+)\1/i;

/** 从块内提取标题（优先 h2 h_tag，若缺失则降级取 a 链接文字） */
const TITLE_REGEX = /<h2 class="h_tag"[^>]*>([\s\S]*?)<\/h2>/i;
const TITLE_FALLBACK_REGEX = /<a[^>]+href=["'][^"']*\/newDetail\.html\?newId=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i;

/** 从块内提取文章链接 */
const ARTICLE_LINK_REGEX = /<a[^>]+href=["']([^"']*\/newDetail\.html\?newId=\d+[^"']*)["'][^>]*>/i;

/** 从块内提取摘要 */
const SUMMARY_REGEX = /<p class="news-description"[^>]*>([\s\S]*?)<\/p>/i;

/** 从块内提取日期（格式：YYYY-MM-DD HH:mm） */
const DATE_REGEX = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/;

/**
 * 解析日期字符串
 * @param dateStr "2026-09-01" 或 "2026-09-01 16:11"
 */
function parseAitntDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  try {
    // 补上秒 :00 凑成标准格式
    const normalized = dateStr.trim().replace(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})(?!\d)/, '$1:00');
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export async function fetchAitntPage(
  typeId: string,
  sourceName: string,
): Promise<SourceFetchOutcome> {
  const url = `https://www.aitntnews.com/newList.html?typeId=${typeId}`;

  try {
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIHub-Bot)',
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      { maxRetries: 2, timeoutMs: 20_000 },
    );

    if (!res.ok) {
      return { items: [], error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const items: SourceFetchOutcome['items'] = [];
    let block: RegExpExecArray | null;

    while ((block = ARTICLE_BLOCK_REGEX.exec(html)) !== null) {
      const text = block[1];

      // 1) 封面图
      const coverMatch = text.match(COVER_REGEX);
      const coverUrl = coverMatch ? coverMatch[2] : null;

      // 2) 文章链接
      const linkMatch = text.match(ARTICLE_LINK_REGEX);
      if (!linkMatch) continue;
      let articleUrl = linkMatch[1];
      // 补全相对路径
      if (articleUrl.startsWith('/')) {
        articleUrl = `https://www.aitntnews.com${articleUrl}`;
      }

      // 3) 标题
      const titleMatch = text.match(TITLE_REGEX);
      let title: string;
      if (titleMatch) {
        title = cleanText(titleMatch[1]);
      } else {
        const fallback = text.match(TITLE_FALLBACK_REGEX);
        title = fallback ? cleanText(fallback[1]) : '';
      }
      if (!title || title.length < 8 || title.length > 120) continue;

      // 4) 摘要
      const summaryMatch = text.match(SUMMARY_REGEX);
      const summary = summaryMatch ? cleanText(summaryMatch[1]).slice(0, 500) : undefined;

      // 5) 日期（从整页 HTML 中同位置搜索，不受块内干扰）
      //    近似策略：在块文本中搜索 "YYYY-MM-DD HH:mm" 格式
      const dateMatch = text.match(DATE_REGEX);
      const publishedAt = dateMatch
        ? parseAitntDate(`${dateMatch[1]} ${dateMatch[2]}`)
        : null;

      items.push({
        title,
        url: articleUrl,
        summary,
        coverUrl,
        publishedAt,
        publishPrecision: publishedAt ? 'minute' : null,
        crawledAt: new Date(),
        sourceName,
      });
    }

    return { items };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}
