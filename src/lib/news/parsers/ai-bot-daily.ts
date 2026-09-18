/**
 * AI Bot 每日AI快讯专用 HTML 解析器
 *
 * 支持页面：https://ai-bot.cn/daily-ai-news/
 *
 * 页面结构：
 *   <div class="news-date">9月1·周二</div>          ← 日期分隔（每组第一条前）
 *   <div class="news-item">
 *     <div class="news-content">
 *       <h2><a href="...">Title</a></h2>
 *       <p class="text-muted text-sm">
 *         Description...
 *         <span class="news-time text-xs">来源：XXX</span>
 *       </p>
 *     </div>
 *   </div>
 *
 * 注意：HTML 结构中 news-list 嵌套较多，且部分闭合标签缺失，
 *       使用正则块匹配比 DOM 解析更鲁棒（不依赖完整标签树）。
 *
 * 不依赖 cheerio，纯正则实现。
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText, parseError, type SourceFetchOutcome } from './types';

const SOURCE_NAME = 'AI工具集';
const PAGE_URL = 'https://ai-bot.cn/daily-ai-news/';

/** 匹配单个 <div class="news-item"> 块（起始位置）—— BUG-012 改用 split 策略，避免依赖三层闭合标签 */
const NEWS_ITEM_START_REGEX = /<div class="news-item">/gi;

/** 从 news-item 块中提取 <h2> 内的 <a href="...">Title</a> */
const TITLE_LINK_REGEX = /<h2>\s*<a[^>]+href\s*=\s*(["'])([^"']+)\1[^>]*>\s*([^<]*?)\s*<\/a>\s*<\/h2>/i;

/** 从 news-item 块中提取描述段落（去掉末尾来源 span） */
const DESC_PARAGRAPH_REGEX = /<p class="text-muted text-sm"[^>]*>([\s\S]*?)<\/p>/i;

/** 从描述 HTML 中去掉 <span class="news-time text-xs">来源：XXX</span>，保留正文 */
const SOURCE_SPAN_REGEX = /\s*<span class="news-time text-xs">来源：([^<]*)<\/span>\s*/i;

/** 从日期分隔行中提取"X月Y日·周X"格式 */
const DATE_DIV_REGEX = /<div class="news-date">\s*([^<]+?)\s*<\/div>/gi;

/**
 * 解析日期字符串如"9月1·周二"或"8月31·周一"
 * 推断年份：8月~9月 属于当前年份（2026），
 *           4月~7月 属于当前年份（2026）。
 *           跨年情况（如1月）推断为当前年份-1。
 */
function parseNewsDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // e.g. "9月1·周二" → ["9月1", "周二"]
  const match = dateStr.match(/(\d+)月(\d+)日/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);

  const now = new Date();
  let year = now.getFullYear();

  // 如果推断月份 > 当前月份（比如1月但现在是9月），则年份-1
  if (month > now.getMonth() + 1) {
    year -= 1;
  }

  try {
    return new Date(year, month - 1, day, 12, 0, 0);
  } catch {
    return null;
  }
}

/**
 * 抓取并解析 AI Bot 每日AI快讯页面
 */
export async function fetchAibotDailyNews(): Promise<SourceFetchOutcome> {
  try {
    const res = await fetchWithRetry(
      PAGE_URL,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIHub-Bot/1.0)',
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

    // 1. 提取所有日期分隔行，建立 URL → 日期 的映射
    //    策略：按 HTML 顺序扫描，记录当前活跃日期，遇到 news-item 时应用
    const dateByPos: Array<{ pos: number; date: Date | null }> = [];
    let dateMatch: RegExpExecArray | null;
    DATE_DIV_REGEX.lastIndex = 0;
    while ((dateMatch = DATE_DIV_REGEX.exec(html)) !== null) {
      const dateStr = dateMatch[1]?.trim() ?? '';
      dateByPos.push({
        pos: dateMatch.index,
        date: parseNewsDate(dateStr),
      });
    }

    // 2. BUG-012 修复：用 split 策略替代正则三层嵌套匹配
    //    思路：先定位所有 news-item 起始位置，再在每两个之间切片
    NEWS_ITEM_START_REGEX.lastIndex = 0;
    const startPositions: number[] = [];
    let startMatch: RegExpExecArray | null;
    while ((startMatch = NEWS_ITEM_START_REGEX.exec(html)) !== null) {
      startPositions.push(startMatch.index);
    }
    if (startPositions.length === 0) {
      return { items: [], error: 'no news-item blocks found' };
    }

    for (let idx = 0; idx < startPositions.length; idx++) {
      const blockStart = startPositions[idx];
      const blockEnd = idx + 1 < startPositions.length
        ? startPositions[idx + 1]
        : Math.min(html.length, blockStart + 10_000);  // 单块上限 10KB
      const itemHtml = html.slice(blockStart, blockEnd);
      const itemPos = blockStart;

      // 2a. 当前活跃日期：找到 pos <= itemPos 的最近日期
      let activeDate: Date | null = null;
      for (let i = dateByPos.length - 1; i >= 0; i--) {
        if (dateByPos[i].pos <= itemPos) {
          activeDate = dateByPos[i].date;
          break;
        }
      }

      // 2b. 标题 + 链接
      const titleLinkMatch = itemHtml.match(TITLE_LINK_REGEX);
      if (!titleLinkMatch) continue;
      let url = titleLinkMatch[2]?.trim() ?? '';
      const title = cleanText(titleLinkMatch[3] ?? '');

      // 补全相对路径
      if (url.startsWith('/')) {
        url = `https://ai-bot.cn${url}`;
      }
      if (!url || !title || title.length < 5 || title.length > 150) continue;

      // 2c. 描述 + 来源
      const descMatch = itemHtml.match(DESC_PARAGRAPH_REGEX);
      let summary: string | undefined;
      let sourceLabel: string | undefined;

      if (descMatch) {
        const descHtml = descMatch[1] ?? '';
        const sourceMatch = descHtml.match(SOURCE_SPAN_REGEX);
        if (sourceMatch) {
          sourceLabel = cleanText(sourceMatch[1] ?? '').replace(/^来源：/, '').trim();
          summary = cleanText(descHtml.replace(SOURCE_SPAN_REGEX, '')).slice(0, 500) || undefined;
        } else {
          summary = cleanText(descHtml).slice(0, 500) || undefined;
        }
      }

      items.push({
        title,
        url,
        summary,
        publishedAt: activeDate,
        publishPrecision: activeDate ? 'day' : null,
        crawledAt: new Date(),
        sourceName: sourceLabel ? `${SOURCE_NAME}·${sourceLabel}` : SOURCE_NAME,
      });
    }

    return { items };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}
