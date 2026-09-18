/**
 * RSS/日期解析工具
 * 
 * 移植自 ai-news-daily/scripts/time-utils.mjs
 * 原则：publishedAt 必须是真实发布时间，绝不用抓取时间冒充
 */

export interface ParsedDate {
  ts: number | null;
  precision: 'exact' | 'date' | null;
}

export const timeUnknown = (): ParsedDate => ({ ts: null, precision: null });

/**
 * 未来时间回退
 * 
 * 源站常只给「月日」或「时分」，需推断年份/日期，可能推到未来：
 * - 跨年：2027-01-05 抓到 "12月28" → 应回退为 2026-12-28
 * - 跨午夜：凌晨 00:30 抓到 "23:53" → 应回退为昨天 23:53
 */
export function rewindIfFuture(
  dt: Date,
  unit: 'year' | 'day',
  now: number = Date.now()
): Date {
  const TOL = 3600000; // 容差 1 小时
  if (dt.getTime() - now <= TOL) return dt;
  if (unit === 'year') dt.setFullYear(dt.getFullYear() - 1);
  else dt.setDate(dt.getDate() - 1);
  return dt;
}

/**
 * 修正 RSS pubDate 的年份错误
 * 
 * aitntnews 源站把年份写成 2001，但月/日/时/分真实
 */
export function fixRssYear(raw: string, now: number = Date.now()): ParsedDate {
  const d = new Date(raw);
  if (!raw || isNaN(d.getTime())) return timeUnknown();
  const nowY = new Date(now).getFullYear();
  if (d.getFullYear() < nowY - 1) d.setFullYear(nowY); // 保留月/日/时/分
  rewindIfFuture(d, 'year', now); // 跨年兜底
  return { ts: d.getTime(), precision: 'exact' };
}

/**
 * 解析标准 RSS pubDate (RFC-822)
 * 
 * 示例：
 * - "Fri, 29 Aug 2026 10:30:00 +0800"
 * - "Sat, 28 Aug 2001 09:21:00 +0800" (需要年份修复)
 */
export function parseRssPubDate(raw: string, now: number = Date.now()): ParsedDate {
  if (!raw) return timeUnknown();
  
  // 先尝试标准解析
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const nowY = new Date(now).getFullYear();
    // 年份异常（< nowY - 1）则修正
    if (d.getFullYear() < nowY - 1) {
      d.setFullYear(nowY);
      rewindIfFuture(d, 'year', now);
    }
    return { ts: d.getTime(), precision: 'exact' };
  }
  
  return timeUnknown();
}

/**
 * 解析中文日期时间
 *
 * 格式：
 * - "2026年8月28日 09:21"
 * - "2026-08-28 09:21"
 * - "2026年8月28日"
 *
 * 默认按 UTC+8（北京时间）解析，与 time-utils.ts 中同名函数语义对齐。
 * @param s 原始字符串
 * @param now 当前时间戳（便于测试）
 * @param tzOffsetMs 时区偏移（毫秒）；默认 8h = UTC+8
 */
export function parseCnDateTime(
  s: string,
  now: number = Date.now(),
  tzOffsetMs: number = 8 * 3600 * 1000,
): ParsedDate {
  if (!s) return timeUnknown();

  let m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/);
  if (!m) m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return timeUnknown();

  const [, y, mo, d, h, mi] = m;
  const offsetHours = tzOffsetMs / 3_600_000;
  const dt = new Date(
    Date.UTC(+y, +mo - 1, +d, h ? +h - offsetHours : -offsetHours, mi ? +mi : 0, 0),
  );
  rewindIfFuture(dt, 'year', now);
  return { ts: dt.getTime(), precision: h ? 'exact' : 'date' };
}

/**
 * 解析 yt-dlp upload_date (YYYYMMDD)
 */
export function parseUploadDate(s: string): ParsedDate {
  const str = String(s || '');
  if (!/^\d{8}$/.test(str)) return timeUnknown();
  const dt = new Date(+str.slice(0, 4), +str.slice(4, 6) - 1, +str.slice(6, 8));
  return { ts: dt.getTime(), precision: 'date' };
}

/**
 * 解析当天日期 + HH:MM
 * 
 * 跨午夜自动回退到昨天
 */
export function parseTodayHM(hm: string, now: number = Date.now()): ParsedDate {
  const m = String(hm || '').match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return timeUnknown();
  const n = new Date(now);
  const dt = new Date(n.getFullYear(), n.getMonth(), n.getDate(), +m[1], +m[2], 0);
  rewindIfFuture(dt, 'day', now);
  return { ts: dt.getTime(), precision: 'exact' };
}

/**
 * 解析中文 "月日" (如 "8月28")
 * 
 * 按当前年解析，跨年时自动回退到去年
 */
export function parseMonthDay(s: string, now: number = Date.now()): ParsedDate {
  const m = String(s || '').match(/(\d{1,2})\s*月\s*(\d{1,2})/);
  if (!m) return timeUnknown();
  const n = new Date(now);
  const dt = new Date(n.getFullYear(), +m[1] - 1, +m[2]);
  rewindIfFuture(dt, 'year', now);
  return { ts: dt.getTime(), precision: 'date' };
}
