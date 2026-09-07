/**
 * B 站 wbi 签名工具（D-1 修复）
 *
 * 官方算法（来自 https://socialsisteryi.github.io/bilibili-API-collect/docs/misc/sign/wbi.html）：
 *   1. 拿 img_url + sub_url → 提取 key → 生成 32 char mixin key
 *   2. 待签名的 params：
 *      - 加 wts = 当前 unix 秒
 *      - value 过滤字符：! ' ( ) *
 *   3. 按 key 排序
 *   4. 拼接成 query string：k1=v1&k2=v2&...
 *   5. 对**整个 query string** 做 URL 编码（注意：不是单个 value 编码）
 *   6. md5(encoded_query + mixin_key) → w_rid
 *
 * SECURITY 公告（2026-09-07 / SA-1 审计 SEC-F-01）：
 *   - 此处使用 md5 哈希是 **B 站官方 WBI 签名算法**的一部分，无法替换
 *   - md5 在密码学上已不安全（2004 王小云碰撞攻击），但 WBI 是 B 站 API 完整性校验，
 *     安全性由 B 站官方保证，本项目仅适配接口协议
 *   - 严禁在项目其他位置使用 md5 做安全哈希（密码 / token / 签名）
 *   - 如需替换为 B 站新版 Wbi/WS 鉴权，请评估接口兼容性后整体升级
 *   - 已知风险：理论上攻击者可利用 md5 碰撞伪造 B 站请求签名
 *   - 风险等级：低（仅影响 B 站数据抓取，不影响账号安全 / 财务数据）
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { getBiliCookie } from './cookie';
import { logger } from '@/lib/observability/logger';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// 32 char mixin key 字符表（顺序固定）
const MIXIN_KEY_ENC_TAB: number[] = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
];

const WBI_HEADERS: HeadersInit = {
  'User-Agent': UA,
  Referer: 'https://www.bilibili.com/',
  Cookie: '',
};

/** 从 img_url / sub_url 中提取 wbi key */
function extractKey(url: string): string {
  const m = url.match(/wbi\/([a-zA-Z0-9]+)\.png/);
  return m ? m[1] : '';
}

/** 生成 32 char mixin key */
function genMixinKey(imgKey: string, subKey: string): string {
  const s = imgKey + subKey;
  let mixin = '';
  for (const i of MIXIN_KEY_ENC_TAB) {
    if (i < s.length) mixin += s[i];
  }
  return mixin.slice(0, 32);
}

/**
 * Node md5
 *
 * ⚠️ SECURITY: 本函数仅供 B 站 WBI 签名使用，是 B 站官方算法的组成部分
 * （参见文件顶部 SECURITY 公告）。md5 在密码学上已不安全，**严禁**：
 *   - 用于密码哈希
 *   - 用于 token / session / API key 签名
 *   - 用于文件完整性校验（如有需要改用 sha256）
 *   - 在项目其他位置复制此函数（重复使用 = 扩大攻击面）
 *
 * 如需新增 md5 调用点，请先确认：
 *   1. 该用途是否可替换为 sha256
 *   2. 是否属于 B 站接口兼容需求
 *   3. 风险是否可接受（参见文件顶部公告）
 */
function md5(str: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('md5').update(str).digest('hex');
}

interface NavApiResponse {
  code: number;
  data?: {
    wbi_img?: {
      img_url: string;
      sub_url: string;
    };
  };
}

/** mixin key 缓存（1 小时） */
let cachedMixinKey: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

/** 拉 nav 接口拿 mixin key */
export async function getMixinKey(): Promise<string> {
  if (cachedMixinKey && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedMixinKey;
  }
  const url =
    'https://api.bilibili.com/x/web-interface/nav?wts=' + Math.floor(Date.now() / 1000);
  const cookie = getBiliCookie();
  const headers = cookie ? { ...WBI_HEADERS, Cookie: cookie } : WBI_HEADERS;
  const res = await fetchWithRetry(
    url,
    { headers },
    { maxRetries: 2, timeoutMs: 10_000, backoffMs: 1500 },
  );
  if (!res.ok) {
    throw new Error(`B站 nav 接口返回 ${res.status}`);
  }
  const json = (await res.json()) as NavApiResponse;
  const wbi = json.data?.wbi_img;
  if (!wbi?.img_url || !wbi?.sub_url) {
    throw new Error(`B站 nav 接口未返回 wbi_img（code=${json.code}）`);
  }
  const imgKey = extractKey(wbi.img_url);
  const subKey = extractKey(wbi.sub_url);
  if (!imgKey || !subKey) {
    throw new Error(`无法从 nav 提取 wbi key: img=${imgKey}, sub=${subKey}`);
  }
  cachedMixinKey = genMixinKey(imgKey, subKey);
  cachedAt = Date.now();
  // 用 logger.debug 而非 console.log：避免泄漏到生产日志，且符合项目日志规范
  logger.debug('[wbi] mixin key refreshed', { prefix: cachedMixinKey.slice(0, 8) });
  return cachedMixinKey;
}

/**
 * 给 URL 加 wbi 签名
 *
 * 关键算法（按官方 JS 实现 1:1 翻译）：
 *   1. 把 URL 上的现有 query 参数收集到对象
 *   2. 每个 value 过滤：! ' ( ) *
 *   3. 加 wts 参数
 *   4. 按 key 排序
 *   5. 拼成 "k1=v1&k2=v2&..."
 *   6. 对**整个串**做 encodeURIComponent（注意：encodeURIComponent 本身会 encode 这些特殊字符之外的所有不安全字符）
 *   7. md5(encoded + mixin_key) → w_rid
 *   8. 把 wts 和 w_rid 加回 URL
 */
export async function signWbi(rawUrl: string): Promise<string> {
  const mixinKey = await getMixinKey();
  const u = new URL(rawUrl);

  // 1. 收集现有参数
  const params: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    const cleaned = v.replace(/[!'()*]/g, '');
    if (cleaned) params[k] = cleaned;
  });

  // 2. 加 wts
  params.wts = String(Math.floor(Date.now() / 1000));

  // 3. 按 key 排序
  const sortedKeys = Object.keys(params).sort();

  // 4. 拼接 "k=v&k=v"
  const queryStr = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  // 5. md5(query + mixin_key)
  const wRid = md5(queryStr + mixinKey);

  u.searchParams.set('wts', params.wts);
  u.searchParams.set('w_rid', wRid);
  return u.toString();
}