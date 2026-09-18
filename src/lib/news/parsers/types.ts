/**
 * 解析器共享类型与工具
 *
 * 来源：archived/04-新闻聚合爬虫-深度诊断.md §5
 * 说明：原 service.ts 中的 FetchedItem / cleanText / extractTag 抽到这里
 */

/**
 * 单条抓取结果（来自任意 parser）
 */
export interface FetchedItem {
  title: string;
  url: string;
  summary?: string;
  content?: string;
  /** 发布时间（null = 未知） */
  publishedAt: Date | null;
  /** 时间精度 */
  publishPrecision?: string | null;
  /** 爬取时间（无法判断发布时间时的兜底展示） */
  crawledAt: Date;
  sourceName: string;
  /** 封面图 URL（从 RSS enclosure / media:content / og:image 提取） */
  coverUrl?: string | null;
  /** 多源交叉验证的其他源名（去重阶段填充） */
  crossSources?: string[];
}

/**
 * 单源抓取返回
 */
export interface SourceFetchOutcome {
  items: FetchedItem[];
  error?: string;
}

/**
 * 提取简单 XML 标签值（支持 CDATA）
 */
export function extractTag(xml: string, tag: string): string | null {
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const plainRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');

  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1];

  const plainMatch = xml.match(plainRegex);
  return plainMatch ? plainMatch[1] : null;
}

/**
 * 清理 HTML/CDATA 实体，输出纯文本
 */
export function cleanText(text: string): string {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 统一解析 unknown 错误为字符串（BUG-015 修复）
 *
 * 使用场景：catch (err) 块中，err 不一定是 Error 实例（如 DOMException、AbortError、字符串），
 * 直接 .message 可能得到 undefined，造成静默丢失。
 */
export function parseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err ?? 'unknown error');
}