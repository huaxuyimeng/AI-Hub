/**
 * 微信公众号文章解析器（2026-09-03 重大重构）
 *
 * 核心发现：
 *   微信公众号文章的完整 HTML 内容藏在页面 JS 的 window.cgiDataNew.content_noencode 里，
 *   不需要 JS 渲染、不需要 jsdom、不需要 Playwright，直接正则解码即可拿到干净文章结构。
 *
 * 数据来源（2026-09 实测）：
 *   window.cgiDataNew = {
 *     title: '标题',
 *     desc: '摘要',
 *     content_noencode: '\\x3csection style=\\x22...整个文章 HTML...',
 *   }
 *   appuin = "biz字符串"
 *   create_time = "Unix时间戳"
 *
 * 提取流程：
 *   1. 抓取 mp.weixin.qq.com/s/{sig} 公开页面
 *   2. 解码 content_noencode（\\x3c → '<' 等转义）
 *   3. 从中提取 h2 标签 → 新闻标题
 *   4. 提取 blockquote → 摘要
 *   5. 提取 img → 文章图片
 *   6. 从 window.cgiDataNew 提取元信息
 *
 * 反爬说明：
 *   - content_noencode 是微信官方渲染数据，无需 JS 执行
 *   - IP 限制：单 IP < 5次/分钟，建议 2-3s 间隔
 *   - 偶尔触发验证页（return verify_page），此时降级到旧方案
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText } from './types';

export interface WechatArticle {
  title: string;
  url: string;
  account: string;
  summary: string;
  coverUrl?: string;
  /** Unix 秒（0 = 未知）*/
  publishedAt: number;
  /** 解析出的新闻条目（每条对应 ## 二级标题）*/
  items: WechatNewsItem[];
  /** 封面 + 正文图片 */
  images: WechatImage[];
  /** 所属专辑（系列）相关链接 */
  album?: WechatAlbum;
  /** biz 参数（公众号唯一标识）*/
  biz: string;
  /** 错误标记（verify_page / timeout / parse_error）*/
  error?: string;
}

export interface WechatNewsItem {
  title: string;
  /** 紧跟标题的 blockquote 作为摘要 */
  summary: string;
  /** 后续展开正文（用于二次 LLM 提炼）*/
  body: string;
  /** 正文中的图片 URL */
  images: string[];
}

export interface WechatImage {
  url: string;
  type: 'cover' | 'content';
  alt?: string;
  width?: number;
}

export interface WechatAlbum {
  /** 上一篇文章 URL（专辑内时间倒序排列）*/
  prevUrl?: string;
  /** 下一篇文章 URL */
  nextUrl?: string;
  /** 专辑标题 */
  title?: string;
}

/** 匹配公众号文章 URL */
export function isWechatArticleUrl(url: string): boolean {
  return /mp\.weixin\.qq\.com\/s\//i.test(url);
}

/** 从 HTML 提取 biz */
export function extractBiz(html: string): string | null {
  // 方式1：var appuin = "" || "biz"
  const m1 = html.match(/appuin\s*=\s*""\s*\|\|\s*"([^"]+)"/);
  if (m1) return m1[1];
  // 方式2：var biz = "biz"
  const m2 = html.match(/var\s+biz\s*=\s*"([^"]+)"/);
  if (m2) return m2[1];
  // 方式3："biz" in JSON
  const m3 = html.match(/"biz"\s*:\s*"([^"]+)"/);
  if (m3) return m3[1];
  return null;
}

/** 提取专辑导航（上篇/下篇）*/
export function extractAlbumNav(html: string): WechatAlbum | undefined {
  // 方式1：从 profile_ext 或专辑导航区提取
  const prevMatch = html.match(/<a[^>]+class="[^"]*album_read_nav_prev[^"]*"[^>]+href="([^"]+)"/);
  const nextMatch = html.match(/<a[^>]+class="[^"]*album_read_nav_next[^"]*"[^>]+href="([^"]+)"/);
  const albumTitleMatch = html.match(/album_read_nav_title_inner[^>]*>([^<]+)</);

  if (prevMatch || nextMatch) {
    return {
      prevUrl: prevMatch ? fixUrl(prevMatch[1]) : undefined,
      nextUrl: nextMatch ? fixUrl(nextMatch[1]) : undefined,
      title: albumTitleMatch ? cleanText(albumTitleMatch[1]) : undefined,
    };
  }
  return undefined;
}

function fixUrl(url: string): string {
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return 'https://mp.weixin.qq.com' + url;
  return url;
}

// ==================== 解码 ====================

/** 解码 content_noencode（\\x3c → '<' 等转义序列）*/
function decodeContentNoencode(raw: string): string {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

// ==================== 提取 ====================

/**
 * 解码并解析 content_noencode 段落，返回干净的文章 HTML
 */
function extractAndDecodeContent(html: string): string | null {
  // 方式1：window.cgiDataNew.content_noencode（单引号）
  const m1 = html.match(/content_noencode\s*:\s*'((?:[^'\\]|\\.)*)'/);
  if (m1) return decodeContentNoencode(m1[1]);

  // 方式2：双引号版本
  const m2 = html.match(/content_noencode\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m2) return decodeContentNoencode(m2[1]);

  // 方式3：从 cgiDataNew 对象里提取
  const scriptMatch = html.match(/<script[^>]*>\s*window\.cgiDataNew\s*=\s*(\{[\s\S]*?\});/);
  if (scriptMatch) {
    const inner = scriptMatch[1];
    const contentMatch = inner.match(/content_noencode\s*:\s*['"]((?:[^'"\\]|\\.)*)['"]/);
    if (contentMatch) return decodeContentNoencode(contentMatch[1]);
  }
  return null;
}

/** 从 window.cgiDataNew 提取元信息 */
function extractCgiData(html: string): {
  title: string;
  account: string;
  summary: string;
  publishedAt: number;
  coverUrl?: string;
} {
  const result = { title: '', account: '', summary: '', publishedAt: 0, coverUrl: undefined as string | undefined };

  // title
  const titleMatch = html.match(/window\.cgiDataNew\s*=\s*\{[\s\S]*?title\s*:\s*'([^']+)'/);
  if (titleMatch) result.title = decodeHtmlEntities(titleMatch[1]);

  // nickname（公众号名）
  const nickMatch = html.match(/nickname\s*=\s*htmlDecode\s*\(\s*"([^"]+)"\s*\)/);
  if (nickMatch) result.account = nickMatch[1];

  // desc（摘要）
  const descMatch = html.match(/window\.cgiDataNew\s*=\s*\{[\s\S]*?desc\s*:\s*'([^']+)'/);
  if (descMatch) result.summary = decodeHtmlEntities(descMatch[1]);

  // create_time
  const timeMatch = html.match(/create_time\s*=\s*"(\d+)"\s*\*\s*1/);
  if (timeMatch) {
    const ts = Number(timeMatch[1]);
    // BUG-010 修复：防御 NaN 和异常值（如 0、负数、未来年份）
    if (!isNaN(ts) && ts > 0 && ts < 4102444800) {  // 2100-01-01 内
      result.publishedAt = ts;
    }
  }

  // og:image 封面
  const coverMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (coverMatch) result.coverUrl = coverMatch[1];

  return result;
}

/** 从 content HTML 提取新闻条目（橘鸦 AI 早报格式 + 通用格式）*/
function extractNewsItems(contentHtml: string): WechatNewsItem[] {
  const items: WechatNewsItem[] = [];
  const seen = new Set<string>();

  const headingRe = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(contentHtml)) !== null) {
    const rawTitle = decodeHtmlEntities(cleanText(m[1])).replace(/^#+\s*/, '').trim();
    if (!rawTitle) continue;

    // 跳过固定章节标题（AI 早报结构）
    if (/^概览$/.test(rawTitle)) continue;

    // AI 早报格式：h2 + 尾部 #编号（如 "Google 发布 Gemini #1"）
    const numMatch = rawTitle.match(/#(\d+)\s*$/);
    const title = numMatch
      ? rawTitle.replace(/\s*#\d+\s*$/, '').trim()
      : rawTitle;

    if (title.length < 4 || title.length > 200) continue;
    if (seen.has(title)) continue;

    // 取 h2 之后、下一个 h2/h3/h1 之前的内容
    const segStart = m.index + m[0].length;
    const nextHeading = contentHtml.slice(segStart).search(/<h[123][^>]*>/i);
    const segEnd = nextHeading >= 0 ? segStart + nextHeading : contentHtml.length;
    const seg = contentHtml.slice(segStart, segEnd);

    // 提取 blockquote（摘要）+ 首段 p（正文）+ 图片
    const { summary, body, images } = extractSegmentContent(seg);
    if (!summary && !body) continue;

    seen.add(title);
    items.push({ title, summary, body, images });
  }

  return items;
}

/** 提取段落中的 blockquote 摘要 + p 正文 + 图片 */
function extractSegmentContent(seg: string): {
  summary: string;
  body: string;
  images: string[];
} {
  let summary = '';
  let body = '';
  const images: string[] = [];

  // 摘要：第一个 blockquote
  const bq = seg.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (bq) summary = decodeHtmlEntities(cleanText(bq[1])).slice(0, 400);

  // 正文：blockquotes 之后的第一个 p
  const afterBq = bq ? seg.slice(bq.index! + bq[0].length) : seg;
  const p = afterBq.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) body = decodeHtmlEntities(cleanText(p[1])).slice(0, 1500);

  // 图片：从段落内 img 标签提取
  for (const imgM of seg.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)) {
    const src = imgM[1];
    if (src && !src.startsWith('data:') && !images.includes(src)) {
      images.push(src);
    }
  }

  return { summary, body, images };
}

/** 从文章 HTML 提取所有图片 */
function extractArticleImages(contentHtml: string, ogCoverUrl?: string): WechatImage[] {
  const images: WechatImage[] = [];
  const seen = new Set<string>();

  if (ogCoverUrl && !seen.has(ogCoverUrl)) {
    images.push({ url: ogCoverUrl, type: 'cover' });
    seen.add(ogCoverUrl);
  }

  for (const m of contentHtml.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)) {
    const src = m[1];
    if (!src || src.startsWith('data:') || seen.has(src)) continue;
    seen.add(src);
    const widthM = m[0].match(/data-width="(\d+)"/);
    const altM = m[0].match(/alt="([^"]*)"/);
    images.push({
      url: src,
      type: 'content',
      width: widthM ? Number(widthM[1]) : undefined,
      alt: altM ? altM[1] : undefined,
    });
  }

  return images;
}

// ==================== 主入口 ====================

/**
 * 抓取并解析公众号文章（一站式）
 */
export async function fetchWechatArticle(url: string): Promise<WechatArticle> {
  const result: WechatArticle = {
    title: '',
    url,
    account: '',
    summary: '',
    publishedAt: 0,
    items: [],
    images: [],
    biz: '',
  };

  try {
    const res = await fetchWithRetry(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://mp.weixin.qq.com/',
      },
    }, { timeoutMs: 15_000, maxRetries: 2 });

    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      return result;
    }

    // BUG-003 修复：content-length 预检，超大页面直接拒绝（避免 4MB+ 全文读入 OOM）
    const MAX_BYTES = 4 * 1024 * 1024;
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_BYTES) {
      result.error = `HTML too large (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB > 4MB limit)`;
      return result;
    }

    let html = await res.text();
    // 防御：即使 content-length 缺失，也截断超长内容（已读入的情况）
    if (html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);

    // 验证页
    if (/verify_page/i.test(html) || /环境异常|请用微信扫一扫/i.test(html)) {
      result.error = 'verify_page';
      return result;
    }

    // 1) 提取元信息（cgiDataNew）
    const meta = extractCgiData(html);
    result.title = meta.title;
    result.account = meta.account;
    result.summary = meta.summary;
    result.publishedAt = meta.publishedAt;
    if (meta.coverUrl) result.images.push({ url: meta.coverUrl, type: 'cover' });

    // 2) biz
    result.biz = extractBiz(html) ?? '';

    // 3) 专辑导航
    result.album = extractAlbumNav(html);

    // 4) 提取并解码 content_noencode
    const contentHtml = extractAndDecodeContent(html);
    if (!contentHtml) {
      result.error = 'parse_error';
      return result;
    }

    // 5) 提取新闻条目
    result.items = extractNewsItems(contentHtml);

    // 6) 提取图片（正文）
    const articleImages = extractArticleImages(contentHtml, meta.coverUrl);
    result.images.push(...articleImages);

    return result;
  } catch (e) {
    result.error = (e as Error).message;
    return result;
  }
}

// ==================== 工具 ====================

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
