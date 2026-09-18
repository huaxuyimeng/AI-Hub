/**
 * B 站爬虫主入口（D-1）
 *
 * 流程：
 *   1. 遍历 UP 主池
 *   2. 每个 UP 主 → listLatestVideos（限 5 条）
 *   3. 取每条视频的详情（含 desc）→ getVideoView
 *   4. 尝试从 desc 提取"文字版"外链 → fetchArticleText → parseNewsFromArticle
 *   5. 兜底：用 parseNewsFromTitle 把标题切成多条新闻
 *
 * 输出：BiliData 结构（详见下方），供 storage.ts 持久化
 *
 * 参考：
 *   - docs/06-B站与多模态-增量设计.md §3.3 §3.4
 */

import { logger } from '@/lib/observability/logger';
import { listLatestVideos, getVideoView } from './api';
import { ENABLED_UPLOADERS, type BilibiliUploaderConfig } from './sources';
import { checkBiliCookieHealth } from './cookie';
import { CATEGORY_KEYWORDS } from '@/lib/news/sources';
import { prismaBase as prisma } from '@/lib/db';
import { upsertBilibiliWithProtection } from './storage';
import { mergeBiliNewsIntoNewsItem } from './merge';
import { fetchRssByUid, extractNewsFromRss, type RssVideoEntry } from './rss';
import { fetchWechatArticle, isWechatArticleUrl, parseError } from '@/lib/news/parsers';
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';

// ========== 类型定义 ==========

/** 单条新闻条目（来自 B 站视频）*/
export interface BiliNews {
  title: string;
  summary: string;
  /** 来源（恒为 'bilibili'）*/
  source: 'bilibili';
  /** 自动分类 */
  category: string;
}

export interface BiliVideo {
  bvid: string;
  title: string;
  /** 简介（可能很长）*/
  description: string;
  /** 长度（秒）*/
  duration: number;
  /** 发布时间（秒）*/
  publishedAt: number;
  /** 播放 URL */
  url: string;
  /** 封面 URL */
  thumbnailUrl: string;
  /** 播放量 */
  playCount: number;
}

export interface BiliVideoWithNews extends BiliVideo {
  /** 提取方式 */
  method: 'article' | 'title' | 'subtitle' | 'fallback' | 'rss';
  /** 文字版外链（如有）*/
  articleUrl?: string;
  /** 字幕 ID（如有）*/
  subtitleId?: number;
  /** 字幕语言（如有）*/
  subtitleLan?: string;
  /** 该视频的新闻条目 */
  news: BiliNews[];
}

export interface BiliUP {
  uid: string;
  name: string;
  tag: string;
  priority: number;
  videos: BiliVideoWithNews[];
}

export interface BiliSourceHealth {
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
  /** 是否来自 RSSHub 兜底 */
  fromRss?: boolean;
}

export interface BiliData {
  fetchedAt: number; // unix seconds
  ups: BiliUP[];
  sourceHealth: Record<string, BiliSourceHealth>;
  note?: string;
}

// ========== 主入口 ==========

/**
 * 抓取全部 UP 主视频
 *
 * @param options.maxVideosPerUP 每个 UP 主最多抓的视频数（默认 5）
 * @param options.uploads 自定义 UP 主池（默认 ENABLED_UPLOADERS）
 */
export async function scrapeBilibili(
  options: { maxVideosPerUP?: number; uploads?: BilibiliUploaderConfig[] } = {},
): Promise<BiliData> {
  const { maxVideosPerUP = 5, uploads = ENABLED_UPLOADERS } = options;
  const result: BiliData = {
    fetchedAt: Math.floor(Date.now() / 1000),
    ups: [],
    sourceHealth: {},
  };

  for (let i = 0; i < uploads.length; i++) {
    const up = uploads[i];
    // UP 主之间的间隔。
    //
    // 历史值 15 秒，理由是「应对 B站 IP 频率限制 -799，5s 会连续 -799」。
    // 那个结论建立在**用的是旧端点** `/x/space/arc/search` 之上 ——
    // 实测该端点**无论隔多久、带不带 cookie、签不签名，恒返回 -799**
    // （`out/_cookie_ab.txt`）。所以当年观察到的「间隔太短就 -799」是
    // 把「端点本身不通」误归因成了「频率太高」。
    //
    // 2026-09-16 换成 wbi 端点后重测（`out/_wbi_verify.txt`）：
    //   7 个 UP 以 **1.5s** 间隔连续请求 → 全部返回 `code=0`，无一次 -799。
    //   单次列表请求耗时 265–563ms。
    // 取 3s（约等于实测可用间隔的 2 倍）作保守值，7 个 UP 从 90s 降到约 18s。
    //
    // 可用 `UP_INTERVAL_MS` 环境变量覆盖（想改回 15000 直接设即可）。
    const upIntervalMs = Number(process.env.UP_INTERVAL_MS ?? 3_000);
    if (i > 0 && upIntervalMs > 0) {
      await sleep(upIntervalMs);
    }
    const start = Date.now();
    try {
      const ups: BiliUP = {
        uid: up.uid,
        name: up.name,
        tag: up.tag,
        priority: up.priority,
        videos: [],
      };

      const list = await listLatestVideos(up.uid, maxVideosPerUP);
      for (const v of list) {
        const enriched = await enrichOneVideo(v);
        ups.videos.push(enriched);
      }

      result.ups.push(ups);
      result.sourceHealth[up.uid] = {
        ok: ups.videos.length > 0,
        count: ups.videos.reduce((s, v) => s + v.news.length, 0),
        ms: Date.now() - start,
      };
      logger.info('bilibili up scraped', {
        source: up.name,
        uid: up.uid,
        videoCount: ups.videos.length,
        newsCount: result.sourceHealth[up.uid].count,
        ms: result.sourceHealth[up.uid].ms,
      });
    } catch (e) {
      result.sourceHealth[up.uid] = {
        ok: false,
        count: 0,
        ms: Date.now() - start,
        error: (e as Error).message,
      };
      logger.warn('bilibili up failed', {
        source: up.name,
        uid: up.uid,
        error: (e as Error).message,
      });
    }
  }

  return result;
}

/**
 * 补全单个视频的 description 并提取新闻
 */
async function enrichOneVideo(v: {
  bvid: string;
  title: string;
  duration: number;
  play: number;
  created: number;
  pic: string;
}): Promise<BiliVideoWithNews> {
  const view = await getVideoView(v.bvid);
  const description = view?.desc ?? '';
  const thumbnailUrl = view?.pic ?? v.pic;
  const baseVideo: BiliVideo = {
    bvid: v.bvid,
    title: v.title,
    description,
    duration: view?.duration ?? v.duration,
    publishedAt: view?.pubdate ?? v.created,
    url: `https://www.bilibili.com/video/${v.bvid}`,
    thumbnailUrl,
    playCount: v.play,
  };

  // 1) 优先：description 文字版链接
  const articleLink = findArticleLink(description);

  if (articleLink) {
    // 微信公众号文章：使用专用解析器（content_noencode 解码，无需 JS 渲染）
    if (isWechatArticleUrl(articleLink)) {
      const article = await fetchWechatArticle(articleLink);
      if (article.items.length > 0) {
        return {
          ...baseVideo,
          method: 'article' as const,
          articleUrl: articleLink,
          news: article.items.map((item) => ({
            title: item.title,
            summary: item.summary,
            source: 'bilibili' as const,
            category: classify(item.title, item.summary),
          })),
        };
      }
    }

    // 通用文字版（BUG-022：fetchArticleText 返回 null 表示 fetch 失败）
    const text = await fetchArticleText(articleLink);
    if (text !== null) {
      const news = parseNewsFromArticle(text);
      if (news.length > 0) {
        return {
          ...baseVideo,
          method: 'article' as const,
          articleUrl: articleLink,
          news,
        };
      }
    }
  }

  // 2) 兜底：标题切分（橘鸦/黑鸦式 "A！B！C！"）
  const newsFromTitle = parseNewsFromTitle(v.title);
  if (newsFromTitle.length > 0) {
    return {
      ...baseVideo,
      method: 'title',
      news: newsFromTitle,
    };
  }

  // 3) 完全兜底：整条视频当一条新闻
  return {
    ...baseVideo,
    method: 'fallback',
    news: [
      {
        title: v.title,
        summary: description.slice(0, 300),
        source: 'bilibili',
        category: classify(v.title, description),
      },
    ],
  };
}

// ========== 描述里找文字版外链 ==========

const ARTICLE_PATTERNS: Array<[RegExp, number]> = [
  [/https?:\/\/mp\.weixin\.qq\.com\/\S+/, 0],
  [/https?:\/\S*?(?:zhihu|jianshu|juejin|163|sina|sohu)\.com\/\S+/, 0],
  [/(?:文字版|图文版|详情|原文|完整版|公众号)[^\n]{0,40}?(https?:\/\/\S+)/, 1],
];

/**
 * 从 description 中识别"文字版"链接
 */
export function findArticleLink(desc: string): string | null {
  if (!desc) return null;
  for (const [re, gi] of ARTICLE_PATTERNS) {
    const m = desc.match(re);
    if (m) {
      const raw = m[gi] ?? m[0];
      return raw.replace(/[。，,)）】]+$/, '').trim();
    }
  }
  return null;
}

/**
 * 抓取文字版页面并提取纯文本
 * @returns 正文文本，或 null 表示 fetch 失败（区分空页面）
 *
 * BUG-M 修复（2026-09-06）：加 SSRF 域名白名单防护
 *   - 之前：fetchArticleText 接受任意 URL，description 中的链接可能指向内网/恶意地址
 *   - 之后：只允许预定义的白名单域名；不匹配直接返回 null
 */

/** SSRF 防护：仅允许抓取这些域名（UP 主新闻源常用平台） */
const ALLOWED_ARTICLE_HOSTS = new Set([
  'mp.weixin.qq.com',     // 微信公众号
  'zhuanlan.zhihu.com',   // 知乎专栏
  'juejin.cn',            // 掘金
  'juejin.im',            // 掘金备用
  'www.jianshu.com',      // 简书
  '36kr.com',             // 36 氪
  'www.36kr.com',
  'sspai.com',            // 少数派
  'medium.com',
  'mp.ofweek.com',        // OFweek
  'www.leiphone.com',     // 雷锋网
  'news.sina.com.cn',     // 新浪
  'tech.sina.com.cn',
]);

export async function fetchArticleText(link: string, maxBytes = 2 * 1024 * 1024): Promise<string | null> {
  // SSRF 防护：先校验 URL 域名白名单
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (!ALLOWED_ARTICLE_HOSTS.has(url.hostname)) return null;

  try {
    // BUG-005 修复：使用 fetchWithRetry（重试 + 指数退避）替代原生 fetch
    const res = await fetchWithRetry(link, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
    }, { maxRetries: 2, timeoutMs: 15_000 });

    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') ?? '';
    if (!ctype.includes('text/html') && !ctype.includes('text/plain')) return null;
    const raw = await res.text();
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;?/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return text.replace(/\n{2,}/g, '\n').trim().slice(0, maxBytes);
  } catch (err) {
    logger.warn('fetchArticleText failed', { link, error: parseError(err) });
    return null;
  }
}

// ========== 文字版解析（橘鸦/黑鸦式早报结构）==========

/**
 * 从文字版正文解析新闻条目
 *
 * 支持格式：
 *   - Markdown `## 标题`（橘鸦式）
 *   - 列表 `- 标题`（兜底）
 */
export function parseNewsFromArticle(text: string, limit = 40): BiliNews[] {
  const items: BiliNews[] = [];
  if (!text) return items;
  const seen = new Set<string>();

  // 模式 1：Markdown 二级标题
  const titleRe = /^##\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(text)) !== null && items.length < limit) {
    const title = m[1].trim().replace(/[`*_]/g, '').trim();
    if (!title || title === '概览' || title.length < 4 || seen.has(title)) continue;
    seen.add(title);
    // 紧跟的 1-3 行作为摘要
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const summaryMatch = rest.match(/^\s*>\s*(.+?)$/m);
    const summary = summaryMatch ? summaryMatch[1].trim().replace(/[`*_]/g, '').slice(0, 300) : '';
    items.push({
      title,
      summary,
      source: 'bilibili',
      category: classify(title, summary),
    });
  }

  // 模式 2：列表项
  if (items.length === 0) {
    for (const m2 of text.matchAll(/^-\s+(.+?)\s*$/gm)) {
      const t = m2[1].trim().replace(/[`*_]/g, '').trim();
      if (!t || t.length < 4 || seen.has(t)) continue;
      seen.add(t);
      items.push({
        title: t,
        summary: '',
        source: 'bilibili',
        category: classify(t, ''),
      });
      if (items.length >= limit) break;
    }
  }

  return items;
}

/**
 * 标题切分（多 UP 主风格兼容）
 *
 * - 黑鸦式 "A！B！C！| AI日报0828" → 按 "！" 切
 * - infinite灵感港式 "A，B，C | 8月30日AI日报第503期" → 按 "，" 切
 * - 橘鸦式 "腾讯Workbuddy启动紧急扩容 | 8月30日AI早报第503期" → 整体一条
 *
 * 策略：
 *   - 优先按 "！" 切（最稳）
 *   - 按 "，" 切时要求段数 >= 2 且每段 >= 4 字（避免误切长标题）
 */
export function parseNewsFromTitle(title: string): BiliNews[] {
  // 去掉 "| AI日报..." / "| 8月X日..." 后缀
  const t = title.replace(/\s*[|｜].*$/, '').trim();

  // 模式 1：按 "！" 切（黑鸦式，最稳）
  const byExclaim = t
    .split(/[！!]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (byExclaim.length > 1) {
    return byExclaim.map((p) => ({
      title: p,
      summary: '',
      source: 'bilibili' as const,
      category: classify(p, ''),
    }));
  }

  // 模式 2：按 "，" 切（infinite灵感港式）
  const byComma = t
    .split(/[，,]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (byComma.length >= 2) {
    return byComma.map((p) => ({
      title: p,
      summary: '',
      source: 'bilibili' as const,
      category: classify(p, ''),
    }));
  }

  // 兜底：整条标题当一条新闻
  return [
    {
      title: t,
      summary: '',
      source: 'bilibili' as const,
      category: classify(t, ''),
    },
  ];
}

// ========== 分类（复用 News 的关键词映射）==========

/**
 * 自动分类：复用 News 模块的 CATEGORY_KEYWORDS
 */
export function classify(title: string, summary: string): string {
  const text = `${title} ${summary}`.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) return cat;
    }
  }
  return 'AI资讯';
}

/** sleep 工具（毫秒）*/
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从 B 站视频 URL 提取 BV 号
 *   https://www.bilibili.com/video/BV1GJ411x7h7 → BV1GJ411x7h7
 *   https://b23.tv/abc123              → 原始字符串（RSS link 可能是短链）
 */
function extractBvidFromUrl(url: string): string | null {
  const m = url.match(/bilibili\.com\/video\/(BV[\w]+)/);
  return m ? m[1] : null;
}

// ========================================================================
// 复用：完整 B 站抓取链路（scrape → persist → merge → 监控）
// 可被 fetch-bilibili 路由和 fetch-news 路由同时调用
// ========================================================================

export interface BilibiliFetchResult {
  ok: boolean;
  upCount: number;
  totalVideos: number;
  totalNews: number;
  /** 从 B 站 NewsItem 实际插入/更新的条数 */
  insertedNewsItems: number;
  updatedNewsItems: number;
  /** 错误摘要（任一 UP 主失败或全链路异常都会汇总在这里）*/
  errors: string[];
  failedUPs: string[];
  /** 本次抓取的详细 health */
  sourceHealth: Record<string, { ok: boolean; count: number; ms: number; error?: string }>;
  /** 整个 run 的耗时（毫秒）*/
  duration: number;
  /** 是否走了 RSSHub 兜底（API 全失败时）*/
  rssFallback: boolean;
}

/**
 * 完整 B 站抓取流程：scrape → BilibiliCache 写入保护 → NewsItem 合并
 *
 * - **不获取分布式锁**，由调用方负责（fetch-bilibili 和 fetch-news 都各自管理锁）
 * - 任一阶段失败都不会 throw，全部 catch 到 errors[] 里；保证调用方拿到完整结果
 * - 当 B 站风控或 cookie 过期时，会在 console.error 输出【醒目错误】，便于本地调试
 *
 * @param options.maxVideosPerUP 每个 UP 主最多抓的视频数（默认 3，比 fetch-bilibili 少）
 * @param options.failOnAllFail 当所有 UP 主都失败时是否当作错误（默认 true）
 */
export async function runBilibiliFetch(
  options: { maxVideosPerUP?: number; failOnAllFail?: boolean; silent?: boolean } = {},
): Promise<BilibiliFetchResult> {
  const start = Date.now();
  const { maxVideosPerUP = 3, failOnAllFail = true, silent = false } = options;

  // 0. 预检：cookie 健康度（BUG-K 修复 2026-09-06：suspicious 时主动告警）
  const health = checkBiliCookieHealth();
  if (health === 'suspicious' && !silent) {
    logger.warn('bilibili fetch: SESSDATA 格式可疑（可能已过期）', {
      hint: '重新登录 B 站后导出 cookie 更新 BILI_SESSDATA / BILI_BILI_JCT',
    });
  }
  if (!silent) {
    logger.debug('bilibili fetch: cookie health', { health });
  }

  try {
    // 1. 抓取
    const biliData = await scrapeBilibili({ maxVideosPerUP });

    // 2. 写入保护 + 持久化到 BilibiliCache
    const storage = await upsertBilibiliWithProtection(prisma, biliData);

    // 3. 合并到 NewsItem
    const merge = await mergeBiliNewsIntoNewsItem(prisma, biliData);

    const failedUPs: string[] = [];
    for (const [uid, h] of Object.entries(biliData.sourceHealth)) {
      if (!h.ok) failedUPs.push(`${uid}`);
    }

    const errors: string[] = [];
    // 把每个 UP 主失败的具体错误收上来
    for (const up of biliData.ups) {
      const h = biliData.sourceHealth[up.uid];
      if (h && !h.ok && h.error) {
        errors.push(`UP ${up.name}(${up.uid}): ${h.error}`);
      }
    }

    const okCount = biliData.ups.length - failedUPs.length;
    const ok = failedUPs.length < biliData.ups.length || biliData.ups.length === 0;

    // ---------- RSSHub 兜底 ----------
    //
    // 2026-09-16 改造：从「API 全失败才兜底」改为「逐 UP 主尽力而为」。
    //
    // 旧逻辑用 `ok = failedUPs.length < ups.length` 做开关，导致：
    //   - 橘鸦成功、黑鸦失败（实测常态）→ ok=true → **完全不走 RSS 兜底**
    //   - 黑鸦这条永远拿不到数据，authors 页只能填模板句
    // 所以兜底必须按 UP 主粒度触发：谁没拿到数据给谁补。
    //
    // ⚠️ 曾想把判据收窄成「只对 API 真的报错的 UP 兜底」（靠 `h.error` 区分），
    //    但**这是不安全的，已放弃**：
    //    `listLatestVideos()` 在三种错误下（HTTP 非 200 / code≠0 / 无 vlist）
    //    都只是 `return []`，**不抛异常**，所以 `sourceHealth[uid].error` 不会被写。
    //    结果就是「cookie 过期 → 全部 UP 返回 -352 → 全都没有 error →
    //    全都不走兜底」—— 恰好把 RSS 兜底最该发挥作用的场景完全跳过。
    //    要正确区分，必须让 `listLatestVideos` 返回状态而不是裸数组，
    //    那是一次接口级改动，不在本轮范围内。
    //
    // 已知代价：4 个「API 成功但无投稿」的 UP 仍会走一轮兜底，
    //    3 个镜像 × 8s 超时 ≈ 每次运行多花 ~60s（`out/_e2e_scraper.txt`）。
    //    这是**用可预测的时间换「不丢数据」**，本轮接受。
    let rssFallback = false;
    let result: BilibiliFetchResult = {
      ok,
      upCount: biliData.ups.length,
      totalVideos: storage.totalVideos,
      totalNews: storage.totalNews,
      insertedNewsItems: merge.inserted,
      updatedNewsItems: merge.updated,
      errors,
      failedUPs,
      sourceHealth: biliData.sourceHealth,
      duration: Date.now() - start,
      rssFallback: false,
    };

    // 需要兜底的 UP 主 = 没拿到视频的那些（含 uid 列表）
    const needFallback = ENABLED_UPLOADERS.filter((up) => failedUPs.includes(up.uid));
    if (needFallback.length > 0) {
      if (!silent) {
        console.warn(
          `\n\x1b[33m⚠️  [B站爬虫] ${needFallback.length}/${ENABLED_UPLOADERS.length} 个 UP 主 API 失败，` +
          `对失败者尝试 RSSHub 兜底：${needFallback.map((u) => u.name).join('、')}\x1b[0m`,
        );
      }
      const rssStart = Date.now();
      const rssVideosByUid = new Map<string, RssVideoEntry[]>();
      const rssErrors: string[] = [];
      const controller = new AbortController();

      for (let i = 0; i < needFallback.length; i++) {
        const up = needFallback[i];
        // 1s → 2s。RSS 镜像对「连续不同 UP」的请求很敏感，实测 1s 间隔下
        // 多个 UP 会被风控，而拉长间隔并不能救回「镜像本来就不服务的 UP」
        // （`out/_final_design.txt`：等 15s 后 4 个失败者依然全败）。
        // 所以这里只做轻微放缓，真正的止血手段是 `rss.ts` 里的负缓存。
        if (i > 0) await new Promise((r) => setTimeout(r, 2000));
        const rss = await fetchRssByUid(up.uid, maxVideosPerUP, controller.signal);
        if (rss.videos.length > 0) {
          rssVideosByUid.set(up.uid, rss.videos);
        } else if (rss.error) {
          rssErrors.push(`${up.name}: ${rss.error}`);
        }
      }

      if (rssVideosByUid.size > 0) {
        rssFallback = true;

        const rssBiliData: BiliData = {
          fetchedAt: Math.floor(Date.now() / 1000),
          ups: [],
          sourceHealth: {},
        };
        for (const up of needFallback) {
          const videos = rssVideosByUid.get(up.uid);
          if (!videos) continue;

          const upData: BiliUP = {
            uid: up.uid,
            name: up.name,
            tag: up.tag,
            priority: up.priority,
            videos: videos.map((v) => ({
              bvid: extractBvidFromUrl(v.url) ?? v.url,
              title: v.title,
              description: v.description,
              duration: 0,
              publishedAt: v.publishedAt,
              url: v.url,
              thumbnailUrl: '',
              playCount: 0,
              method: 'rss' as const,
              news: extractNewsFromRss([v]),
            })),
          };

          rssBiliData.ups.push(upData);
          rssBiliData.sourceHealth[up.uid] = {
            ok: true,
            count: upData.videos.reduce((s, vid) => s + vid.news.length, 0),
            ms: 0,
            fromRss: true,
          };
        }

        const rssStorage = await upsertBilibiliWithProtection(prisma, rssBiliData);
        const rssMerge = await mergeBiliNewsIntoNewsItem(prisma, rssBiliData);

        if (!silent) {
          console.warn(
            `\x1b[33m   RSSHub 兜底成功：${rssBiliData.ups.length} 个 UP 主，` +
            `${rssStorage.totalVideos} 个视频，` +
            `${rssMerge.inserted} 条新新闻，耗时 ${Date.now() - rssStart}ms\x1b[0m`,
          );
        }

        // 注意：这里**不能**直接 Object.assign(biliData, rssBiliData) ——
        // 那会用「仅兜底成功的那些 UP 主」整体覆盖 ups，把 API 抓成功的也冲掉。
        // 逐 UP 主兜底后，正确做法是「合并」：API 已有该 uid 就保留，缺失的用 RSS 补。
        for (const rssUp of rssBiliData.ups) {
          const existing = biliData.ups.find((u) => u.uid === rssUp.uid);
          const h = biliData.sourceHealth[rssUp.uid];
          if (existing && h?.ok) {
            // API 已成功，保留 API 结果（信息更全：播放量/封面/时长）
            continue;
          }
          if (existing && !h?.ok) {
            // API 失败但占位存在 → 用 RSS 结果替换
            const idx = biliData.ups.indexOf(existing);
            biliData.ups[idx] = rssUp;
          } else {
            biliData.ups.push(rssUp);
          }
          biliData.sourceHealth[rssUp.uid] = rssBiliData.sourceHealth[rssUp.uid];
        }

        const rssFailedUPs = failedUPs.filter((uid) => !rssVideosByUid.has(uid));
        Object.assign(result, {
          ok: true,
          upCount: biliData.ups.length,
          totalVideos: rssStorage.totalVideos,
          totalNews: rssStorage.totalNews,
          insertedNewsItems: rssMerge.inserted,
          updatedNewsItems: rssMerge.updated,
          errors: [...errors, ...rssErrors, '[RSSHub 兜底]'],
          failedUPs: rssFailedUPs,
          sourceHealth: biliData.sourceHealth,
          rssFallback: true,
        });
        logger.info('bilibili rss fallback success', {
          upCount: rssBiliData.ups.length,
          totalVideos: rssStorage.totalVideos,
          totalNews: rssStorage.totalNews,
          insertedNewsItems: rssMerge.inserted,
          duration: Date.now() - start,
        });
      } else {
        if (!silent) {
          console.error('\x1b[31m   RSSHub 兜底也全部失败。\x1b[0m');
        }
      }
    } // end: RSS 兜底

    // 当有 UP 主失败时，控制台输出醒目错误（不静默）
    if (failedUPs.length > 0 && !silent) {
      console.error('\n\x1b[33m⚠️  [B站爬虫] ' +
        `${failedUPs.length}/${biliData.ups.length} 个 UP 主抓取失败（成功 ${okCount} 条）：\x1b[0m`);
      for (const up of biliData.ups) {
        const h = biliData.sourceHealth[up.uid];
        if (h && !h.ok) {
          console.error(`   - ${up.name} (uid=${up.uid}): ${h.error ?? 'unknown'}`);
        }
      }
      console.error('   常见原因：B 站风控（-799 / 请求过于频繁）→ 等 5-30 分钟重试，或换 SESSDATA');
      console.error('   参考 SOP：docs/实施记录/40-B站爬虫wbi签名cookie注入-修复报告.md §3.3\n');
    }

    if (!ok && failOnAllFail && !silent) {
      console.error('\n\x1b[31m❌ [B站爬虫] 所有 UP 主抓取失败，未写入任何新数据。\x1b[0m');
    }

    logger.info('bilibili fetch pipeline done', {
      ok: result.ok,
      upCount: result.upCount,
      totalVideos: result.totalVideos,
      totalNews: result.totalNews,
      insertedNewsItems: result.insertedNewsItems,
      failedUPs: result.failedUPs,
      duration: result.duration,
    });

    return result;
  } catch (err) {
    const msg = (err as Error).message;
    if (!silent) {
      console.error('\n\x1b[31m❌ [B站爬虫] 抓取链路异常退出：' + msg + '\x1b[0m');
      console.error('   Stack:', (err as Error).stack);
      console.error('   参考 SOP：docs/实施记录/40-B站爬虫wbi签名cookie注入-修复报告.md\n');
    }
    logger.error('bilibili fetch pipeline crashed', { error: msg, stack: (err as Error).stack });
    return {
      ok: false,
      upCount: 0,
      totalVideos: 0,
      totalNews: 0,
      insertedNewsItems: 0,
      updatedNewsItems: 0,
      errors: [msg],
      failedUPs: [],
      sourceHealth: {},
      duration: Date.now() - start,
      rssFallback: false,
    };
  }
}
