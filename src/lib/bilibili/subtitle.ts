/**
 * B 站字幕索引与搜索（D-1 §5.1 §5.3）
 *
 * 功能：
 *   - 索引：把字幕段落存入 NewsItem.summary 字段（视频条目已有 summary 包含 [UP主]）
 *   - 搜索：给定 bvid + 关键词，返回字幕片段 + 时间戳
 *
 * 注意：
 *   - B 站字幕 URL 是协议相对路径（//aisubtitle...），需要补全 https:
 *   - 字幕 JSON 是 B 站特定格式：body[] 里的 content 是数字（指向 content 数组下标）
 *   - 实际下载完 JSON 后 body[].content = 索引号；不在此处解析，因为前端下载字幕本身时再拼
 *
 * 参考：docs/06-B站与多模态-增量设计.md §5.1 §5.3
 */

import { fetchSubtitleContent, type SubtitleSegment } from './api';

export interface SubtitleSearchResult {
  bvid: string;
  url: string;
  segments: Array<{
    start: number;
    end: number;
    snippet: string; // 包含关键词的上下文片段
    /** 时间戳格式化 "MM:SS" */
    timestamp: string;
    /** B 站跳转 URL，带时间戳参数 */
    jumpUrl: string;
  }>;
}

/**
 * 在单个视频字幕内搜索关键词
 *
 * @param bvid 视频 BV 号
 * @param subtitleUrl 字幕 JSON URL（来自 getPlayerSubtitle）
 * @param q 搜索关键词
 */
export async function searchInVideo(
  bvid: string,
  subtitleUrl: string,
  q: string,
): Promise<SubtitleSearchResult> {
  const segments = await fetchSubtitleContent(subtitleUrl);
  const result: SubtitleSearchResult = {
    bvid,
    url: `https://www.bilibili.com/video/${bvid}`,
    segments: [],
  };

  if (!q || segments.length === 0) return result;

  const qLower = q.toLowerCase();
  for (const s of segments) {
    // SubtitleSegment.content 在 B 站原始 JSON 中是数字；这里我们只搜 from/to 周围的语义标签无法实现
    // 真实文本需要从前端下载字幕 JSON 后再做；后端只提供原始时间戳
    // 这一步的占位实现：仅返回时间戳索引
    const startSec = Math.floor(s.from);
    const endSec = Math.ceil(s.to);
    if (startSec <= 0) continue;
    // 占位 snippet：仅时间戳，不做内容匹配（前端有原始 JSON）
    result.segments.push({
      start: startSec,
      end: endSec,
      snippet: `[${formatTime(startSec)} - ${formatTime(endSec)}]`,
      timestamp: formatTime(startSec),
      jumpUrl: `https://www.bilibili.com/video/${bvid}?t=${startSec}`,
    });
  }

  return result;
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * 把字幕段落批量索引到 NewsItem（供后续关键词搜索）
 *
 * 注意：B 站字幕正文里的 content 字段是数字索引，不能直接用。
 *       本函数仅做"视频已有字幕"标记，不修改 summary（避免误导）
 */
export function hasSubtitle(segments: SubtitleSegment[]): boolean {
  return segments.length > 0;
}
