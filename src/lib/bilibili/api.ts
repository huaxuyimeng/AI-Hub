/**
 * B 站公开 API 封装（D-1）
 *
 * 目标：用最少代码拿到 UP 主视频列表、视频详情、字幕信息
 * - 走 B 站公开接口（需登录态 cookie 才能过风控校验）
 * - 失败安全：429 / 412 → 返回 null，调用方按 UP 主粒度降级
 *
 * API 来源：
 *   - 视频列表：https://api.bilibili.com/x/space/wbi/arc/search?mid={uid}&order=pubdate
 *     （注意路径中必须有 `wbi` 段，见下）
 *   - 视频详情：https://api.bilibili.com/x/web-interface/view?bvid={bvid}
 *   - 播放信息：https://api.bilibili.com/x/player/v2?bvid={bvid}&cid={cid}
 *
 * ⚠️ 2026-09-16 修复：视频列表端点**必须**是 `/x/space/wbi/arc/search`。
 *   历史版本用的是旧端点 `/x/space/arc/search`，该端点恒返回 `-799 请求过于频繁`，
 *   对**它**做 wbi 签名并不会让它变得可用（实测见 `out/_cookie_ab.txt`）——
 *   真正起作用的是路径里的 `wbi` 段。这一个词的差别，决定了整条 B 站链路
 *   是「全部走 RSS 兜底」还是「官方 API 直连可用」。
 *
 * 参考：
 *   - docs/06-B站与多模态-增量设计.md §3.3
 *   - https://socialsisteryi.github.io/bilibili-API-collect/
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { signWbi } from './wbi';
import { getBiliCookie } from './cookie';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const COMMON_HEADERS: HeadersInit = {
  'User-Agent': UA,
  Referer: 'https://www.bilibili.com/',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

/**
 * 从环境变量读 cookie，按 B站要求拼接
 * 实现见 ./cookie.ts（避免循环依赖 + 复用）
 */

// ========== 类型定义 ==========

/** UP 主视频列表项 */
export interface BiliListVideo {
  bvid: string;
  /** 标题 */
  title: string;
  /** 长度（秒）*/
  duration: number;
  /** 播放数 */
  play: number;
  /** 发布时间（秒）*/
  created: number;
  /** 封面 URL */
  pic: string;
  /** aid（数字 ID，备用）*/
  aid: number;
  /** 视频简介（前 250 字）*/
  description?: string;
}

/** 视频详情（view API）*/
export interface BiliViewVideo {
  bvid: string;
  aid: number;
  /** 标题 */
  title: string;
  /** 简介（可能很长）*/
  desc: string;
  /** 长度（秒）*/
  duration: number;
  /** 封面 URL */
  pic: string;
  /** 发布时间（秒）*/
  pubdate: number;
  /** cid：用于 player/v2 接口 */
  cid: number;
  /** 视频 owner 信息 */
  owner: { mid: number; name: string; face: string };
  /** 分区 tname */
  tname: string;
  /** 子标题列表（player/v2）*/
  subtitle?: {
    /** 是否允许 AI 总结 */
    ai_switch: { show: boolean };
    /** 字幕条目 */
    subtitles: Array<{
      /** 字幕 ID */
      id: number;
      /** 语言代码：zh-CN / zh-Hans / en-US */
      lan: string;
      /** 语言名 */
      lan_doc: string;
      /** 是否自动生成 */
      is_lock: boolean;
      /** 字幕元数据 URL */
      subtitle_url: string;
    }>;
  };
}

// ========== API 实现 ==========

interface ListApiResponse {
  code: number;
  message: string;
  ttl: number;
  data?: {
    list?: {
      vlist?: Array<{
        bvid: string;
        title: string;
        length: string; // "MM:SS" or "HH:MM:SS"
        play: number;
        created: number;
        pic: string;
        aid: number;
        description?: string;
      }>;
    };
  };
}

/**
 * 列出 UP 主最新视频（按发布时间倒序）
 *
 * @param mid UP 主 UID
 * @param limit 返回条数（默认 5）
 * @returns 视频数组；失败返回空数组
 */
export async function listLatestVideos(mid: number | string, limit = 5): Promise<BiliListVideo[]> {
  // ⚠️ 2026-09-16 修复（本次最大的一个 bug，只有一个词）
  //
  // 原代码用的是**旧版**端点 `/x/space/arc/search`，然后对它做 wbi 签名，
  // 注释写着「加 wbi 签名（解决 -799 风控）」。这个因果判断是错的。
  //
  // 实测对照（`out/_cookie_ab.txt`，同一个 cookie、同一时刻）：
  //   旧 API `/x/space/arc/search`     + 完整 cookie → code=-799 请求过于频繁，0 条
  //   旧 API `/x/space/arc/search`     + 3 字段 cookie → code=-799，0 条
  //   **wbi API `/x/space/wbi/arc/search` + 3 字段 cookie → code=0，5 条 ✅**
  //
  // 即：**决定成败的是路径里的 `wbi` 段，不是签名本身。**
  // 对旧端点签名等于给一扇锁着的门配钥匙 —— 门本身不通。
  //
  // 连带影响：旧端点永远返回 -799，于是下面那段「15s/30s/60s 指数退避」
  // 每个失败的 UP 都会**真实等待 105 秒**，7 个 UP 就是 90s+ 的纯空转
  // （`scraper.ts` 的 UP 间隔 15s 之外还要再叠这一层）。
  // 换成 wbi 端点后 -799 不再出现，长退避失去意义。
  const rawUrl = `https://api.bilibili.com/x/space/wbi/arc/search?mid=${mid}&ps=${Math.min(
    Math.max(limit, 1),
    50,
  )}&pn=1&order=pubdate`;

  // wbi 端点实测稳定（7/7 返回 code=0，见 `out/_wbi_verify.txt`），
  // 因此只需一次轻量重试兜住网络抖动，不再需要 15/30/60s 的长退避。
  const RETRY_DELAYS_MS = [3_000];

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      // wbi 端点**必须**签名，参数不全会被判 -352 风控校验失败
      let url: string;
      try {
        url = await signWbi(rawUrl);
      } catch (e) {
        console.error('[bilibili] wbi sign failed:', (e as Error).message);
        return [];
      }
      const cookie = getBiliCookie();
      const headers = cookie ? { ...COMMON_HEADERS, Cookie: cookie } : COMMON_HEADERS;
      const res = await fetchWithRetry(
        url,
        { headers },
        { maxRetries: 1, timeoutMs: 12_000, backoffMs: 2000 },
      );
      if (!res.ok) {
        console.warn('[bilibili] list http not ok', { mid, status: res.status });
        return [];
      }
      const json = (await res.json()) as ListApiResponse;

      // -799 理论上不该再出现（那只在旧端点发生）。保留一次短重试兜底，
      // 但不再等 15/30/60 秒 —— 实测它对旧端点毫无作用，纯属浪费。
      if (json.code === -799) {
        if (attempt < RETRY_DELAYS_MS.length) {
          console.warn(`[bilibili] -799（mid=${mid}），${RETRY_DELAYS_MS[attempt] / 1000}s 后重试`);
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        console.error(`[bilibili] -799（mid=${mid}）重试耗尽，放弃`);
        return [];
      }

      if (json.code !== 0) {
        console.warn('[bilibili] list api code error', { mid, code: json.code, msg: json.message });
        return [];
      }
      // code=0 但 vlist 为空是**正常情况**（该 UP 无公开投稿），不是错误，
      // 所以只 debug 记录，不 warn —— 避免健康度告警被噪声打满。
      if (!json.data?.list?.vlist) {
        console.debug('[bilibili] list empty', { mid });
        return [];
      }
      return json.data.list.vlist.map((v) => ({
        bvid: v.bvid,
        title: v.title,
        duration: parseDuration(v.length),
        play: v.play,
        created: v.created,
        pic: normalizePic(v.pic),
        aid: v.aid,
        description: v.description,
      }));
    } catch (e) {
      // P2 修复：超出重试上限才记录 warn，避免日志风暴
      if (attempt >= RETRY_DELAYS_MS.length) {
        console.warn('[bilibili.api] search exhausted retries:', (e as Error).message);
        return [];
      }
    }
  }
  return [];
}

function parseDuration(s: string): number {
  if (!s) return 0;
  const parts = s.split(':').map((x) => parseInt(x, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function normalizePic(url: string): string {
  if (!url) return '';
  // 协议相对路径转 https
  return url.startsWith('//') ? `https:${url}` : url;
}

interface ViewApiResponse {
  code: number;
  message: string;
  data?: {
    bvid: string;
    aid: number;
    title: string;
    desc: string;
    duration: number;
    pic: string;
    pubdate: number;
    cid: number;
    owner: { mid: number; name: string; face: string };
    tname: string;
  };
}

/**
 * 获取视频详情（含 description, cid）
 */
export async function getVideoView(bvid: string): Promise<BiliViewVideo | null> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  try {
    const cookie = getBiliCookie();
    const headers = cookie ? { ...COMMON_HEADERS, Cookie: cookie } : COMMON_HEADERS;
    const res = await fetchWithRetry(
      url,
      { headers },
      { maxRetries: 1, timeoutMs: 10_000, backoffMs: 1500 },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as ViewApiResponse;
    if (json.code !== 0 || !json.data) return null;
    const d = json.data;
    const base: BiliViewVideo = {
      bvid: d.bvid,
      aid: d.aid,
      title: d.title,
      desc: d.desc,
      duration: d.duration,
      pic: normalizePic(d.pic),
      pubdate: d.pubdate,
      cid: d.cid,
      owner: d.owner,
      tname: d.tname,
    };
    // 顺手拉字幕信息
    const sub = await getPlayerSubtitle(bvid, d.cid);
    if (sub) base.subtitle = { ai_switch: { show: false }, subtitles: sub };
    return base;
  } catch (e) {
    // P2 修复：单条视频详情失败降级为无字幕，UP 主其余视频继续
    console.warn('[bilibili.api] getVideoView failed:', (e as Error).message);
    return null;
  }
}

interface PlayerV2Response {
  code: number;
  message: string;
  data?: {
    subtitle?: {
      subtitles?: Array<{
        id: number;
        lan: string;
        lan_doc: string;
        is_lock: boolean;
        subtitle_url: string;
      }>;
    };
  };
}

/**
 * 获取视频字幕元数据
 *
 * @returns 字幕列表（可能为空）；失败返回 null
 */
export async function getPlayerSubtitle(
  bvid: string,
  cid: number,
): Promise<Array<{
  id: number;
  lan: string;
  lan_doc: string;
  is_lock: boolean;
  subtitle_url: string;
}> | null> {
  const url = `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`;
  try {
    const cookie = getBiliCookie();
    const headers = cookie ? { ...COMMON_HEADERS, Cookie: cookie } : COMMON_HEADERS;
    const res = await fetchWithRetry(
      url,
      { headers },
      { maxRetries: 1, timeoutMs: 8_000, backoffMs: 1500 },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as PlayerV2Response;
    if (json.code !== 0) return null;
    const subs = json.data?.subtitle?.subtitles ?? [];
    // 过滤：优先人工字幕（is_lock=false），其次自动字幕
    const sorted = [...subs].sort((a, b) => Number(a.is_lock) - Number(b.is_lock));
    return sorted.length > 0 ? sorted : null;
  } catch (e) {
    // P2 修复：字幕列表解析失败降级为无字幕
    console.warn('[bilibili.api] getPlayerSubtitle failed:', (e as Error).message);
    return null;
  }
}

/** 单条字幕条目（来自 JSON 字幕文件）*/
export interface SubtitleSegment {
  /** 起始时间（秒）*/
  from: number;
  /** 结束时间（秒）*/
  to: number;
  /** 文本 */
  content: number | string; // B 站 JSON 字幕是数字（定位到数组）
}

interface RawSubtitle {
  body: Array<{
    from: number;
    to: number;
    content: number; // B 站原始是索引号，指向 content 字段
    location?: number;
  }>;
}

/**
 * 解析字幕 URL 内容（字幕 JSON 是 B 站特定格式）
 *
 * @param url 字幕 JSON URL（来自 subtitle.subtitle_url）
 * @returns 字幕段落数组
 */
export async function fetchSubtitleContent(url: string): Promise<SubtitleSegment[]> {
  try {
    // B 站字幕 URL 协议相对
    const fullUrl = url.startsWith('//') ? `https:${url}` : url;
    const res = await fetchWithRetry(
      fullUrl,
      { headers: COMMON_HEADERS },
      { maxRetries: 1, timeoutMs: 10_000, backoffMs: 1500 },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as RawSubtitle;
    return (json.body ?? []).map((s) => ({ from: s.from, to: s.to, content: s.content }));
  } catch (e) {
    // P2 修复：字幕内容解析失败降级为空数组
    console.warn('[bilibili.api] fetchSubtitleContent failed:', (e as Error).message);
    return [];
  }
}
