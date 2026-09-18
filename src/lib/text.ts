/**
 * 文本清洗工具
 *
 * 用例：新闻数据从外部 RSS / HTML 抓取回来，常见两类问题：
 *   1. 标题里残留 HTML 实体（`&#8220;` = "，`&amp;` = &），React 直接渲染会显示为字符本身
 *   2. 摘要里夹了 `<div>` `<a>` 等标签，需要剥掉避免泄露到 UI
 */

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  laquo: '\u00AB',
  raquo: '\u00BB',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
};

/** 把 HTML 实体（含数字实体、命名实体）解码成原始字符 */
export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
      const cp = parseInt(code, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, code) => {
      const cp = parseInt(code, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => (NAMED_ENTITIES[name] ?? m));
}

/** 先解码实体，再剥 HTML 标签，最后合并空白 */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return decodeHtmlEntities(input)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 清洗摘要文本（stripHtml 之后再走一遍）：
 *   - 去掉 RSS/HTML 描述末尾固定模板："点击查看原文>" / "查看更多 →" / "阅读全文>>" 等导引词
 *   - 截断回显符号（≥ > → →》) 后续内容（避免出现"点击查看..."残留）
 *   - 合并多余空白
 *
 * 用例：用户反馈图三摘要末尾出现"点击查看原文>"占位文本。
 *
 * 实现：
 *   1. 找最早一个"导引词"位置（点击查看|查看原文|查看更多|阅读全文|read more|view original）
 *   2. 截断到该位置
 *   3. 移除开头/结尾残余的标点符号、空白
 */
const SUMMARY_TAIL_KEYWORDS = /(点击查看原文|查看原文|点击查看|查看更多|阅读全文|read more|read\s*full|view original|continue reading|view article)/i;

export function cleanSummary(input: string | null | undefined): string {
  const base = stripHtml(input);
  if (!base) return '';
  const idx = base.search(SUMMARY_TAIL_KEYWORDS);
  const trimmed = idx >= 0 ? base.slice(0, idx) : base;
  return trimmed
    .replace(/[\s\.,;:!?。，；：、！?>"»）\)】]+$/g, '')
    .trim();
}

/**
 * 估算字符串视觉宽度（用于中英混排时的排版判断）
 * - CJK（中文/日文/韩文）字符：≈ 1.5em（宽于 ASCII）
 * - ASCII / Latin 字符：≈ 0.55em
 * 用于 PPT 标题超长时判断是否需要缩字号（build-pptx.ts / SlidePreview.tsx 共用）
 */
export function cjkWidth(s: string): number {
  return [...s].reduce(
    (w, ch) => w + (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch) ? 1.5 : 0.55),
    0,
  );
}
