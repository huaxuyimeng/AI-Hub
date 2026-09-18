/**
 * B 站 RSSHub 兜底层（D-2）
 *
 * 当 B 站官方 API 触发 -799 风控（所有 UP 主都失败）时，
 * 自动切换到 RSSHub 兜底，确保至少有数据来源。
 *
 * 数据限制：
 *   - 只有标题 / 发布时间 / 链接 / 简介（description）
 *   - 无播放量、无封面完整 URL、无字幕
 *   - description 通常是视频简介，无法提取"文字版"外链
 *
 * 适用场景：橘鸦/黑鸦式"标题即新闻"的 AI 早报类 UP 主
 * 不适用：需要从 description 提取外链（公众号/Jianshu）才能拿到新闻的场景
 *
 * RSSHUB 支持的端点：
 *   https://rsshub.app/bilibili/user/video/{uid}
 *
 * 参考：docs/架构设计/06-B站与多模态-增量设计.md §3.3
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { CATEGORY_KEYWORDS } from '@/lib/news/sources';
import type { BiliNews } from './scraper';

const RSS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// ========== AI 关键词过滤（2026-09-03 新增）==========
//
// 目的：RSS 数据无播放量/封面等元信息，且纯靠标题切分（如黑鸦"X！Y！Z！"），
//      偶尔会切出非 AI 内容（彩蛋/抽奖/生活琐事）。为减少噪声入库，
//      标题必须命中 AI 关键词白名单之一。
//
// 词表来源：聚合 maomu/tmtpost/html 三处 parser 的 AI_KEYWORDS，
//         取并集 + 补充 B 站 UP 主实际常用命名（如"WorkBuddy"）。
//
// 注意：与 scraper.ts 现有 CATEGORY_KEYWORDS 是两个独立维度：
//   - isAiRelated → 是否入库（粗粒度白名单）
//   - classify    → 入哪个分类（细粒度）
//
const AI_KEYWORDS =
  /(?:^|[^a-z0-9])(ai|gpt(?:-?4o|-?4turbo|-?3\.5|-?nano)?|claude(?:-?sonnet|-?opus|-?haiku|-?fable)?|gemini(?:-?pro|-?flash)?|llama(?:-?3)?|qwen(?:-?code)?|千问|deepseek|deep[\s-]?grey|deepgrey|模型|大模型|机器人|具身|智能体|agent|智能助手|copilot(?:\+)?|训练|推理|anthropic|xai|hugging(?:face)?|人工智能|混元|kimi|ernie|文心|通义|盘古|智谱|百川|零一万物|算力|多模态|机器学习|深度学习|神经网络|自然语言|nlp|llm|rlhf|微调|对齐|transformer|agi|moe|aigc|agentic|midjourney|stable[\s-]?diffusion|runway|openai|sora|artificial[\s-]?intelligence|machine[\s-]?learning|小模型|端侧|编程|代码|cursor|qoder|workbuddy|windsurf|人形机器人|机械臂|自动驾驶|robot|embodied|humanoid|deepmind|mistral|llamaindex|trae|豆包|doubao|清华|北大|高校|招生|大厂|融资|估值|开源|闭源|巨头|震撼|炸裂|惊艳|重磅|黑马|突围|复旦|智源|yi-)/iu;

/**
 * 判断标题或简介是否与 AI 相关
 *
 * @example
 *   isAiRelated('腾讯 WorkBuddy 启动紧急扩容') // true（"workbuddy" 命中）
 *   isAiRelated('抽奖 | AI 早报')              // true（"AI" 命中）
 *   isAiRelated('五一旅游攻略')                // false（未命中）
 */
export function isAiRelated(title: string, description = ''): boolean {
  if (!title) return false;
  if (AI_KEYWORDS.test(title)) return true;
  if (description && AI_KEYWORDS.test(description)) return true;
  return false;
}

/**
 * RSSHub 镜像列表（支持环境变量覆盖，可逗号分隔多个）
 *
 * 背景（2026-09-16 实测，见 docs/实施记录/B站取数与PPT模板调研_2026-09-16.md）：
 *   - 官方站 `rsshub.app` 已不可用：HTTP 0 / 10.5s 超时 / 0 条
 *   - `rsshub.rssforever.com`：HTTP 503
 *   - `rsshub.pseudoyu.com`：HTTP 0 超时
 *   - **`rss.injahow.cn`：HTTP 200，82–403ms，稳定 30 条** ← 唯一可用
 *
 * 因为镜像可用性会随时间变化，这里按顺序逐个尝试，而不是写死单个 base。
 * 环境变量 `RSSHUB_BASE_URL` 可覆盖（支持逗号分隔多个，排在最前优先尝试）。
 */
const DEFAULT_RSSHUB_MIRRORS = [
  'https://rss.injahow.cn',
  'https://rsshub.rssforever.com',
  'https://rsshub.app',
];

/**
 * 单个镜像单次请求的超时（毫秒）
 *
 * 2026-09-16 实测（`out/_verify_bili.txt`）：
 *   死镜像 `rsshub.app` 每次都要耗满超时才失败（10552 / 10561 / 10575 ms），
 *   3 轮就是 31.5 秒纯浪费。而可用镜像 `rss.injahow.cn` 成功耗时 2470ms、
 *   缓存命中最快 82ms。
 *   → 超时从 15s 降到 8s：仍在成功路径（2.5s）的 3 倍以上，但把死镜像的
 *     代价砍掉近一半。
 */
const MIRROR_TIMEOUT_MS = 8_000;

/**
 * 镜像健康度短路缓存（进程内熔断器）
 *
 * ⚠️ 2026-09-16 第一版设计是**错的**，实测被推翻：
 *   第一版按「镜像连续失败次数」熔断，阈值 3。结果一次多 UP 压测里
 *   `infinite灵感港` 连拿 3 个 503，直接把 `rss.injahow.cn`（唯一可用镜像）
 *   熔断掉了 —— 后面两个 UP 全部 0ms 直接跳过并报失败（`out/_verify_bili2.txt`）。
 *
 * 根因：**失败是 per-(镜像,UID) 的，不是 per-镜像 的。**
 *   同一个镜像对橘鸦能返回 200，对 infinite灵感港返回 503。
 *   拿 UP 级的失败去惩罚镜像，等于用一个人的错误封掉整条路。
 *
 * 正确设计（当前版本）：熔断键 = `镜像::UID`
 *   - 只对「某个镜像上的某个 UID」短路，不影响该镜像服务其它 UP
 *   - 只对**网络级失败**（超时/DNS，说明镜像本身可能挂了）做较长冷却
 *   - **`upstream` 类 503（镜像活着、B站风控拒了）不做熔断**，因为它是
 *     逐请求概率性的，实测同 UID 连打第 3 次就能成功（`out/_throttle.txt`），
 *     重试本身就是解药，熔断反而会挡掉本该成功的那次。
 */
const UID_TRIP_THRESHOLD = 3;
const UID_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * 「已知死路」配对缓存（进程内）：`镜像::UID` → 失败次数
 *
 * 这是**负缓存**，不是熔断。区别很重要：
 *   - 熔断：因为一个 UP 失败就**封掉整条镜像**，会让其它 UP 一起完蛋（已被实测否定 4 次，见下）
 *   - 负缓存：只记住「这个镜像确实不服务这个 UP」，**不影响该镜像服务其它 UP**
 *
 * 实测依据（`out/_final_design.txt`）：
 *   `我是小杰JayC` / `AI悦创` / `大谷Spitzer` / `OpenBMB` 这 4 个 UP
 *   在 `rss.injahow.cn` 上**每一轮都是 503/0**，两个 pass 共 8 次尝试全部失败，
 *   而且在我全部 7 次实验里从未成功过一次 → 镜像就是不服务他们。
 *   对这类配对继续重试是 **100% 纯浪费**（那一轮 pass 2 白烧 24.7 秒、零收益）。
 */
const DEAD_PAIR_THRESHOLD = 2;
const deadPairs = new Map<string, number>();

function pairKey(base: string, uid: string): string {
  return `${base}::${uid}`;
}

/** 记录一次失败（负缓存）*/
function notePairFailure(base: string, uid: string): void {
  const k = pairKey(base, uid);
  deadPairs.set(k, (deadPairs.get(k) ?? 0) + 1);
}

/** 记录一次成功：清掉该配对的历史失败 */
function notePairSuccess(base: string, uid: string): void {
  deadPairs.delete(pairKey(base, uid));
}

/** 该配对是否已被判定为死路（失败 ≥ DEAD_PAIR_THRESHOLD 次）*/
function isDeadPair(base: string, uid: string): boolean {
  return (deadPairs.get(pairKey(base, uid)) ?? 0) >= DEAD_PAIR_THRESHOLD;
}

/**
 * 「已验证可用」镜像集合（进程内），用于**镜像排序**
 *
 * 2026-09-16 实测（`out/_verify_bili5.txt`）：镜像顺序恒为
 * `[injahow, rssforever, rsshub.app]` 时，一个失败 UP 会被 `rssforever` 罚 3 轮、
 * 被 `rsshub.app` 罚 3 次 8s 超时 → 单 UP 36.7 秒。
 * 而死镜像对**所有** UP 都是死的，唯一的止血办法就是不再把它排在前面。
 *
 * 注意排序只是**优化**，不是正确性依赖：所有镜像仍都会被尝试。
 */
const provenGoodMirrors = new Set<string>();

/** 按「已验证可用优先」重排镜像，保持组内原序 */
function sortMirrorsByHealth(mirrors: string[]): string[] {
  if (provenGoodMirrors.size === 0) return mirrors;
  const good = mirrors.filter((m) => provenGoodMirrors.has(m));
  const rest = mirrors.filter((m) => !provenGoodMirrors.has(m));
  return [...good, ...rest];
}

/**
 * ⚠️ 已废弃且**不要再加回来**：镜像级熔断。留此记录以免重蹈覆辙。
 *
 * 我先后实现了 4 个版本的熔断，**全部被实测否定**：
 *
 *   1. **v1 键=镜像**（连续失败 3 次即封）：`infinite灵感港` 连拿 3 个 503，
 *      把唯一可用的 `rss.injahow.cn` 封掉，后续 UP 全部 0ms 报失败
 *      （`out/_verify_bili2.txt`）。
 *   2. **v2 键=镜像::UID，仅 network 熔断**：不误封镜像了，但死镜像仍被每个 UP
 *      重复惩罚（`out/_verify_bili3.txt`：5 UP 耗 75.6s）。
 *   3. **v3 加「2 个不同 UID 失败即封镜像」**：`injahow` 在成功服务 3 个 UP 之后，
 *      仍因后 2 个 UP 的瞬时失败被封（`out/_verify_bili4.txt`）。
 *   4. **v4 把 v3 收窄到「仅 network」**：依然封掉 `injahow`，最致命的是
 *      **第二轮 5 个 UP 全部 0ms、成功 0/5** —— 三个镜像全被熔断，
 *      把「降级可用」直接变成「整体不可用」（`out/_verify_bili6.txt`）。
 *
 * 根本原因：**熔断的前提是「有多条可互换的路径」**，而这里
 * `rss.injahow.cn` 是**唯一**可用镜像，封它没有任何替代方案，
 * 省下的几秒远不值丢掉当天全部 B 站数据。
 *
 * 同理，**「多轮重试」也被实测否定**（`out/_retry_ab.txt`）：
 *   策略 B（同 UID 连打 3 轮）：**1/7 成功、72.9s**
 *   策略 A（每个只打 1 次）：**2/7 → 3/7 成功、19.2s → 11.9s**
 * 即：连打不仅更慢，成功率反而更低。**503 不是「等一下就好」，重试不是解药。**
 *
 * 最终收敛出的有效手段只有三条（都有实测支撑）：
 *   ① 单请求超时 8s        —— 让真死的 `rsshub.app` 少耗 40% 时间
 *   ② 已验证镜像优先排序    —— 让好镜像先被命中
 *   ③ 负缓存（本文件上方）  —— 不再重试「镜像确实不服务的 UP」
 */

/**
 * 测试/诊断用：查看负缓存与「已验证可用」镜像
 */
export function getMirrorHealthSnapshot(): {
  deadPairs: Array<{ key: string; failures: number }>;
  provenGood: string[];
} {
  return {
    deadPairs: [...deadPairs.entries()].map(([key, failures]) => ({ key, failures })),
    provenGood: [...provenGoodMirrors],
  };
}

export function getRsshubMirrors(): string[] {
  const fromEnv = (process.env.RSSHUB_BASE_URL ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const all = [...fromEnv, ...DEFAULT_RSSHUB_MIRRORS];
  // 去重保序
  return [...new Set(all)];
}

/**
 * 单个镜像的尝试结果分类
 *
 * - `ok`        ：拿到 XML 且解析出条目
 * - `empty`     ：HTTP 200 但 0 条（镜像活着，上游可能无内容）
 * - `upstream`  ：503 + 页面含 "Got error code"（镜像活着，但它上游被 B 站风控拒了）
 * - `blocked`   ：403 / 404 / 412 等
 * - `network`   ：超时 / DNS / 连接失败
 */
type RssAttempt = { kind: 'ok' | 'empty' | 'upstream' | 'blocked' | 'network'; status: number; error?: string };

/** 单个镜像单次请求（不含重试）*/
async function fetchOnce(
  base: string,
  uid: string,
  signal?: AbortSignal,
): Promise<{ attempt: RssAttempt; xml?: string }> {
  const url = `${base}/bilibili/user/video/${uid}`;
  try {
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': RSS_UA,
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal,
      },
      { maxRetries: 1, timeoutMs: MIRROR_TIMEOUT_MS, backoffMs: 1500 },
    );

    if (res.status === 503) {
      // 区分「镜像挂了」与「镜像活着但上游被风控」
      // RSSHub 的 503 页面会带 `Got error code -352 while fetching: 风控校验失败`
      const body = await res.text().catch(() => '');
      const upstream = /Got error code|风控校验失败/.test(body);
      return { attempt: { kind: upstream ? 'upstream' : 'network', status: 503, error: upstream ? 'B站风控(-352)' : 'HTTP 503' } };
    }
    if (!res.ok) {
      return { attempt: { kind: 'blocked', status: res.status, error: `HTTP ${res.status}` } };
    }
    const xml = await res.text();
    const n = (xml.match(/<item>/g) ?? []).length;
    return { attempt: { kind: n > 0 ? 'ok' : 'empty', status: res.status }, xml };
  } catch (e) {
    return { attempt: { kind: 'network', status: 0, error: (e as Error).message } };
  }
}

// ========== 类型定义 ==========

/** RSS XML item（来自 xml2js 解析）*/
interface RssItem {
  title?: Array<string>;
  link?: Array<string>;
  description?: Array<string>;
  pubDate?: Array<string>;
  'atom:link'?: Array<{ $: Record<string, string> }>;
}

/** RSS XML channel */
interface RssChannel {
  item?: RssItem[];
}

/** RSS 输出结构（对应 BiliVideo）*/
export interface RssVideoEntry {
  title: string;
  url: string;
  /** 简介（通常是视频简介，非封面）*/
  description: string;
  publishedAt: number; // unix seconds
  /** 来源：恒为 'rsshub' */
  source: 'rsshub';
}

/** 单个 UP 主的 RSS 拉取结果 */
export interface RssFetchResult {
  uid: string;
  videos: RssVideoEntry[];
  error?: string;
}

// ========== 核心实现 ==========

/**
 * 拉取单个 UP 主的 RSS（逐个镜像、每个只打一次）
 *
 * ⚠️ 设计依据全部来自实测，且**推翻了两次直觉**：
 *
 * 直觉一「503 是限流，重试就好」→ **错**。
 *   早期我用同一 UID 连打 10 次得到 8/10 成功（`out/_throttle.txt`），
 *   于是以为重试是解药。但那个实验只测了**一个** UP。
 *   换成多 UP 对照（`out/_retry_ab.txt`）：
 *     策略 B（同 UID 连打 3 轮）：1/7 成功、72.9s
 *     策略 A（每个只打 1 次）：  3/7 成功、11.9s
 *   连打**更慢且成功率更低**。
 *
 * 直觉二「失败的 UP 多等一会儿就能成」→ **错**。
 *   实测第二轮（等 15s 再打 4 个失败者）：4 个全败，白烧 24.7s
 *   （`out/_final_design.txt`）。这 4 个 UP 在我全部 7 次实验里**从未成功过**，
 *   它们就是不被该镜像服务。
 *
 * 因此最终策略：
 *   1. 按「已验证可用镜像优先」排序后逐个尝试
 *   2. **每个镜像只打一次**，失败即换下一个（不连打）
 *   3. 对失败的 (镜像, UP) 配对记**负缓存**，达到阈值后不再重试该配对
 *   4. 全程受 `BUDGET_MS` 时间预算约束
 *
 * 注：现在官方 wbi API 已修复可用（见 `api.ts`），RSS 退居**兜底**角色，
 * 主要价值是官方接口偶发失败时仍能拿到标题。
 *
 * @param uid B 站 UID
 * @param limit 返回条数（默认 5）
 * @param signal abort signal
 */
export async function fetchRssByUid(
  uid: string,
  limit = 5,
  signal?: AbortSignal,
): Promise<RssFetchResult> {
  const mirrors = sortMirrorsByHealth(getRsshubMirrors());
  const errors: string[] = [];

  // 全局时间预算：避免「一个坏 UP 拖垮整批」。
  // 2026-09-16 实测单 UP 最坏曾达 50.3s，加预算后封顶。
  const BUDGET_MS = 20_000;
  const startedAt = Date.now();
  const budgetLeft = () => BUDGET_MS - (Date.now() - startedAt);

  for (const base of mirrors) {
    if (signal?.aborted) return { uid, videos: [], error: 'aborted' };

    // 负缓存命中：这个 (镜像, UP) 配对已被证明不通，本次直接跳过。
    // 这是纯省时优化，不影响其它 UP 走该镜像。
    if (isDeadPair(base, uid)) {
      errors.push(`${base}: 已知不通(负缓存)`);
      continue;
    }

    // 预算见底就停，但至少把第一个镜像试完
    if (budgetLeft() <= 0 && errors.length > 0) {
      errors.push('预算耗尽');
      break;
    }

    // ⚠️ 只打**一次**，不连打。
    //
    // 这是被实测推翻后改的（`out/_retry_ab.txt`）：
    //   策略 B（同 UID 连打 3 轮）：1/7 成功、72.9s
    //   策略 A（每个只打 1 次）：  3/7 成功、11.9s
    // 连打不仅更慢，成功率反而更低 —— 因为 503 不是「等一下就好」，
    // 而是「这个镜像这一刻不服务这个 UP」，继续打只会加重风控。
    const { attempt, xml } = await fetchOnce(base, uid, signal);

    if (attempt.kind === 'ok' && xml) {
      const entries = parseRssXml(xml, limit);
      if (entries.length > 0) {
        notePairSuccess(base, uid);
        provenGoodMirrors.add(base);
        return { uid, videos: entries };
      }
      // 拿到 XML 但解析 0 条：可能是上游确无内容，也可能是格式变了。
      // 记一笔并继续换镜像（不再重试本镜像）。
      notePairFailure(base, uid);
      errors.push(`${base}: 解析 0 条`);
      continue;
    }

    if (attempt.kind === 'empty') {
      // 镜像活着、上游正常，只是这个 UP 没内容 —— **不算故障**，
      // 也不能记负缓存（否则会把「暂时没投稿」误判成「永久不通」）
      provenGoodMirrors.add(base);
      errors.push(`${base}: 200 但 0 条`);
      continue;
    }

    // upstream（B站风控 503）/ blocked（403/412）/ network（超时）：
    // 统一记一次负缓存，然后换下一个镜像。达到阈值后该配对不再被尝试。
    notePairFailure(base, uid);
    errors.push(`${base}: ${attempt.error ?? attempt.kind}`);
  }

  return { uid, videos: [], error: errors.slice(-4).join(' | ') };
}

/**
 * 解析 RSS XML → RssVideoEntry[]
 *
 * RSSHub bilibili/user/video 返回标准 RSS 2.0 格式：
 *   <item>
 *     <title>视频标题</title>
 *     <link>https://www.bilibili.com/video/BVxxx</link>
 *     <description>视频简介（可能含 HTML）</description>
 *     <pubDate>Wed, 02 Sep 2026 10:00:00 GMT</pubDate>
 *   </item>
 */
export function parseRssXml(xml: string, limit = 5): RssVideoEntry[] {
  const entries: RssVideoEntry[] = [];

  // 逐条提取 <item>...</item>
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRe.exec(xml)) !== null && entries.length < limit) {
    const itemXml = itemMatch[1];

    const title = extractTag(itemXml, 'title')?.replace(/<[^>]+>/g, '').trim() ?? '';
    const link = extractTag(itemXml, 'link')?.replace(/<[^>]+>/g, '').trim() ?? '';
    const rawDesc = extractTag(itemXml, 'description') ?? '';
    const description = rawDesc
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#?\w+;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const pubDateStr = extractTag(itemXml, 'pubDate');

    if (!title || !link) continue;

    const publishedAt = pubDateStr ? parseRssDate(pubDateStr) : 0;

    entries.push({ title, url: link, description, publishedAt, source: 'rsshub' });
  }

  return entries;
}

/**
 * 提取 XML 中第一个指定标签的内容
 */
function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

/**
 * 解析 RFC 2822 / RFC 822 日期字符串 → unix seconds
 *
 * 支持格式：
 *   Wed, 02 Sep 2026 10:00:00 GMT
 *   02 Sep 2026 10:00:00 +0000
 */
function parseRssDate(str: string): number {
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  } catch { /* fallthrough */ }

  // 手写解析（兜底 RFC 2822）
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const re = /(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{1,2}):(\d{2}):?(\d{2})?/i;
  const m = str.match(re);
  if (m) {
    const [, day, mon, year, hour, min, sec = '0'] = m;
    return Math.floor(
      new Date(Number(year), months[mon] ?? 0, Number(day), Number(hour), Number(min), Number(sec)).getTime() / 1000,
    );
  }
  return 0;
}

// ========== 新闻提取 ==========

/**
 * 从 RSS 视频列表提取新闻条目（复用 scraper 的标题切分逻辑）
 *
 * RSS 数据没有 description 文字版链接，只能靠标题切分。
 * 对 AI 早报类 UP 主（橘鸦/黑鸦/infinite灵感港）效果较好。
 *
 * 过滤策略（2026-09-03 新增）：
 *   1. 切分前先检查整条视频标题是否 AI 相关（避免彩票/花絮整条误入）
 *   2. 切分后对每条子标题单独过滤（黑鸦式 "AI 早报 + 抽奖" 会切出"抽奖"）
 *
 * @param videos RSS 视频列表
 * @returns BiliNews[]（每个视频标题可能切出多条）
 */
export function extractNewsFromRss(videos: RssVideoEntry[]): BiliNews[] {
  const items: BiliNews[] = [];

  for (const v of videos) {
    // 视频级粗筛：标题或简介任一含 AI 关键词才处理
    if (!isAiRelated(v.title, v.description)) {
      continue;
    }

    const news = parseRssTitle(v.title, v.description);
    items.push(...news);
  }

  return items;
}

/**
 * RSS 标题切分（兼容黑鸦/橘鸦/infinite灵感港 风格）
 * 逻辑与 scraper.parseNewsFromTitle 保持一致
 *
 * 子条目过滤（2026-09-03 新增）：
 *   黑鸦式 "X！Y！Z！" 切完后，每段子标题必须再过一次 AI 关键词。
 *   例如 "AI 资讯！抽奖通知！粉丝群福利" → 切出 3 段后过滤掉"抽奖通知"/"粉丝群福利"，
 *   只保留 "AI 资讯"。
 */
export function parseRssTitle(title: string, description = ''): BiliNews[] {
  const t = title.replace(/\s*[|｜].*$/, '').trim();

  // 模式 1：按 "！" 切（黑鸦式，最稳）
  const byExclaim = t
    .split(/[！!]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (byExclaim.length > 1) {
    return byExclaim
      .filter((p) => isAiRelated(p, description))
      .map((p) => ({
        title: p,
        summary: '',
        source: 'bilibili' as const,
        category: classify(p),
      }));
  }

  // 模式 2：按 "，" 切（infinite灵感港式）
  const byComma = t
    .split(/[，,]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (byComma.length >= 2) {
    return byComma
      .filter((p) => isAiRelated(p, description))
      .map((p) => ({
        title: p,
        summary: '',
        source: 'bilibili' as const,
        category: classify(p),
      }));
  }

  // 兜底：整条标题当一条新闻
  return [
    {
      title: t,
      summary: '',
      source: 'bilibili' as const,
      category: classify(t),
    },
  ];
}

/** 分类（复用 News 模块的 CATEGORY_KEYWORDS）*/
function classify(text: string): string {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) return cat;
    }
  }
  return 'AI资讯';
}
