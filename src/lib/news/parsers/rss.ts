/**
 * RSS 2.0 / Atom 通用解析器
 *
 * 来源：archived/04-新闻聚合爬虫-深度诊断.md §5.1
 * 重构自原 src/lib/news/service.ts 中的 parseRssXml
 *
 * P0-1 修复：pubDate 解析失败显式为 null，不回退为抓取时间
 */

import { parseRssPubDate } from '@/lib/utils/parse-date';
import { extractTag, cleanText, type FetchedItem } from './types';

/**
 * 解析 RSS XML（轻量正则实现，避免引入 xml 解析器依赖）
 */
export function parseRssXml(xml: string, sourceName: string): FetchedItem[] {
  const items: FetchedItem[] = [];

  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 50) {
    const block = match[1];

    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || extractTag(block, 'guid');
    const description = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');

    if (!title || !link) continue;

    // P0-1 修复：解析失败保持 null
    const t = parseRssPubDate(pubDate ?? '');

    // 提取封面图（多种来源）
    const coverUrl = extractCoverUrl(block);

    items.push({
      title: cleanText(title),
      url: cleanText(link),
      summary: description ? cleanText(description).slice(0, 500) : undefined,
      publishedAt: t.ts ? new Date(t.ts) : null,
      publishPrecision: t.precision,
      crawledAt: new Date(),
      sourceName,
      coverUrl,
    });
  }

  return items.slice(0, 50);
}

/**
 * 从 RSS item 块中提取封面图 URL
 *
 * 来源优先级：
 * 1. media:content（标准 RSS 媒体扩展）
 * 2. media:thumbnail（缩略图）
 * 3. enclosure（附件，可能为图片）
 * 4. content:encoded 中第一个 <img>
 * 5. description 中第一个 <img>
 */
function extractCoverUrl(itemBlock: string): string | null {
  // 1. media:content
  const mediaContent = itemBlock.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaContent) return mediaContent[1];

  // 2. media:thumbnail
  const mediaThumb = itemBlock.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (mediaThumb) return mediaThumb[1];

  // 3. enclosure（type 为图片）
  const enclosure = itemBlock.match(/<enclosure[^>]+type=["']image\/[^"']+["'][^>]+url=["']([^"']+)["']/i)
    || itemBlock.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']+["']/i);
  if (enclosure) return enclosure[1];

  // 4. content:encoded 中的第一个 <img>
  const contentEncoded = extractTag(itemBlock, 'content:encoded');
  if (contentEncoded) {
    const imgMatch = contentEncoded.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];
  }

  // 5. description 中的第一个 <img>
  const description = extractTag(itemBlock, 'description');
  if (description) {
    const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];
  }

  return null;
}