/**
 * HTML 抓取 + 解析
 *
 * 来源：archived/04-新闻聚合爬虫-深度诊断.md §5.2
 * 重构自原 src/lib/news/service.ts 中的 fetchHtml
 *
 * P0-2 修复：
 *   1. 严格长度阈值（15-120 字符）
 *   2. AI 关键词白名单过滤
 *   3. 同站链接限制（避免抓导航/页脚/外链）
 *   4. 时间显式为 null（HTML 抓取无法拿时间）
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText, parseError, type SourceFetchOutcome } from './types';
import { decodeHtmlEntities } from '@/lib/text';

/**
 * P0-2 白名单关键词（必须含其一）
 * 注意：避免过于宽泛的词（如 "google"/"openai"/"meta"），这些词几乎出现在所有
 *       导航/页脚/外链中。改为仅匹配"标题语义相关"的强 AI 词汇。
 */
const AI_KEYWORDS = /\b(ai|gpt|claude|gemini|llama|qwen|deepseek|模型|机器人|具身|智能体|agent|copilot|训练|推理|anthropic|xai|hugging|人工智能|混元|kimi|ernie|文心|通义|盘古|智谱|百川|芯片|算力|大模型|多模态|机器学习|深度学习|神经网络|自然语言|nlp|llm|rlhf|微调|对齐|transformer)\b/i;

/**
 * HTML 抓取（简化版 - 实际场景需要 cheerio 等依赖）
 */
export async function fetchHtml(url: string, sourceName: string): Promise<SourceFetchOutcome> {
  try {
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIHub-Bot)' } },
      { maxRetries: 1, timeoutMs: 20_000 },
    );
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };

    const html = await res.text();
    const items: SourceFetchOutcome['items'] = [];
    const baseUrl = new URL(url);

    // 修复：属性顺序无关的链接匹配（<a class="x" href="..."> 也能命中）
    // 1) 先抓出 <a ...>...</a> 块
    // 2) 再从块内提取 href 与 innerText
    const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    const hrefRegex = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i;
    let match;

    while ((match = anchorRegex.exec(html)) !== null && items.length < 50) {
      const attrs = match[1] ?? '';
      const inner = match[2] ?? '';
      const hrefMatch = attrs.match(hrefRegex);
      if (!hrefMatch) continue;
      const href = hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? '';
      if (!href) continue;
      const title = cleanText(inner);

      // P0-2 修复：严格长度 + 白名单 + 同站限制
      if (title.length < 15 || title.length > 120) continue;
      if (!AI_KEYWORDS.test(title.toLowerCase())) continue;

      // 必须同站链接
      let fullUrl: string;
      try {
        fullUrl = new URL(href, url).toString();
        const parsed = new URL(fullUrl);
        if (parsed.hostname !== baseUrl.hostname) continue;
      } catch {
        continue;
      }

      // BUG-FIX：补抓封面图（图片链接包裹的新闻条目）
      // 优先级：1) 紧邻 <img> 子元素（卡片式列表）2) 父级 article/section 内的 og:image
      const coverUrl = extractAnchorCover(inner, html, match.index);

      // BUG-FIX：补抓摘要（HTML 列表页通常没有 description 字段，需要从 DOM 抓）
      const summary = extractAnchorSummary(inner, html, match.index);

      items.push({
        title,
        url: fullUrl,
        summary,
        publishedAt: null,           // HTML 抓取本身无法拿时间
        publishPrecision: null,
        crawledAt: new Date(),
        sourceName,
        coverUrl,
      });
    }

    return { items };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}

/**
 * 从锚点上下文提取封面图 URL
 *
 * 三级回退：
 *  1) <a> 内部第一个 <img src>（最常见，卡片式列表）
 *  2) 锚点前后 800 字符上下文里的 og:image / twitter:image
 *  3) 锚点前后 800 字符上下文里第一个非装饰 <img src>
 *
 * @param inner 锚点 innerHTML
 * @param html  完整 HTML
 * @param anchorOffset 锚点匹配在 html 中的起始下标
 * @returns 绝对 URL 或 null
 */
function extractAnchorCover(inner: string, html: string, anchorOffset: number): string | null {
  const IMG_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*("([^"]+)"|'([^']*)'|([^\s>]+))/i;

  // 1) 锚点内部 img
  const innerMatch = inner.match(IMG_SRC_RE);
  if (innerMatch) {
    const src = innerMatch[2] ?? innerMatch[3] ?? innerMatch[4] ?? '';
    if (src) return absolutizeCover(src);
  }

  // 2) 上下文（前后 800 字符）扫 og:image / twitter:image
  const ctxStart = Math.max(0, anchorOffset - 800);
  const ctxEnd = Math.min(html.length, anchorOffset + 800);
  const ctx = html.slice(ctxStart, ctxEnd);
  const ogMatch = ctx.match(/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i)
    ?? ctx.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bproperty\s*=\s*["']og:image["']/i)
    ?? ctx.match(/<meta\b[^>]*name\s*=\s*["']twitter:image["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i)
    ?? ctx.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']twitter:image["']/i);
  if (ogMatch) return absolutizeCover(ogMatch[1]);

  // 3) 上下文里任意非装饰 img（排除 1x1 像素、icon、logo）
  const allImgs = ctx.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi) ?? [];
  for (const tag of allImgs) {
    const m = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/);
    if (!m) continue;
    const src = m[1];
    const lower = src.toLowerCase();
    if (lower.includes('1x1') || lower.includes('pixel') || lower.includes('spacer')) continue;
    if (lower.includes('icon') || lower.includes('logo') || lower.endsWith('.svg')) continue;
    return absolutizeCover(src);
  }

  return null;
}

/**
 * 把相对 URL 补成绝对（用于页内图片）
 */
function absolutizeCover(src: string): string {
  // 已是绝对 / data: / blob: → 原样返回
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  // 协议相对
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}

/**
 * 从锚点上下文提取新闻摘要
 *
 * HTML 列表页通常没有 RSS 的 description 字段，需要从 DOM 抽。多级回退：
 *  1) 锚点同级/邻级 <p>/<span>/<div> 的描述性文本
 *  2) 锚点上下文里常见描述 class（desc/intro/excerpt/summary/content/abstract/lead）
 *  3) 页面级 <meta name="description">（兜底，全页共用）
 *  4) 页面级 og:description / twitter:description
 *
 * @returns 长度 30..300 的纯文本摘要；否则 null
 */
function extractAnchorSummary(inner: string, html: string, anchorOffset: number): string | undefined {
  const ctxStart = Math.max(0, anchorOffset - 1200);
  const ctxEnd = Math.min(html.length, anchorOffset + 1200);
  const ctx = html.slice(ctxStart, ctxEnd);

  // 1) 锚点内部 textContent 之外的兄弟节点（含 <p> <span class="...">）
  // 取锚点 outerHTML 闭合 </a> 之后到下一个 </article|/li|/div 闭合标签的 600 字符窗口
  const closeIdx = html.indexOf('</a>', anchorOffset);
  if (closeIdx >= 0) {
    const afterSlice = html.slice(closeIdx, closeIdx + 600);
    // 描述性 class 优先
    const descClass = afterSlice.match(/<(?:p|span|div)\b[^>]*class\s*=\s*["'][^"']*(?:desc|intro|excerpt|summary|content|abstract|lead|details|meta-info|post-)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|div)>/i);
    if (descClass) {
      const txt = cleanText(descClass[1]);
      if (isUsableSummary(txt)) return sliceSummary(txt);
    }
    // 任意 <p>...</p>
    const anyP = afterSlice.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (anyP) {
      const txt = cleanText(anyP[1]);
      if (isUsableSummary(txt)) return sliceSummary(txt);
    }
  }

  // 2) 上下文直接扫常见描述 class
  const descContextMatch = ctx.match(/<(?:p|span|div)\b[^>]*class\s*=\s*["'][^"']*(?:desc|intro|excerpt|summary|content|abstract|lead|details)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|span|div)>/i);
  if (descContextMatch) {
    const txt = cleanText(descContextMatch[1]);
    if (isUsableSummary(txt)) return sliceSummary(txt);
  }

  // 3) <meta name="description">
  const metaDesc = html.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    ?? html.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']description["']/i);
  if (metaDesc) {
    const txt = cleanText(decodeHtmlEntities(metaDesc[1]));
    if (isUsableSummary(txt)) return sliceSummary(txt);
  }

  // 4) og:description / twitter:description
  const ogDesc = html.match(/<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    ?? html.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:description["']/i)
    ?? html.match(/<meta\b[^>]*name\s*=\s*["']twitter:description["'][^>]*content\s*=\s*["']([^"']+)["']/i)
    ?? html.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']twitter:description["']/i);
  if (ogDesc) {
    const txt = cleanText(decodeHtmlEntities(ogDesc[1]));
    if (isUsableSummary(txt)) return sliceSummary(txt);
  }

  return undefined;
}

function isUsableSummary(txt: string): boolean {
  return txt.length >= 30 && txt.length <= 800;
}

function sliceSummary(txt: string): string {
  return txt.length > 300 ? txt.slice(0, 297) + '…' : txt;
}