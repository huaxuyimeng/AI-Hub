/**
 * B 站登录态 cookie 工具
 *
 * 两种配置方式（优先级从高到低）：
 *
 *   1. `BILI_COOKIE`（推荐）—— **整条**浏览器 cookie 原样粘贴。
 *      浏览器 DevTools → Network → 任意 api.bilibili.com 请求 → Request Headers → Cookie。
 *      优点：连带 `buvid3` / `buvid4` / `bili_ticket` / `_uuid` / `b_lsid` 一起带上，
 *      这些是真实浏览器会发的**设备指纹**字段，B 站风控（`-352 风控校验失败`）
 *      会看它们。只发 SESSDATA 通常也能过，但带全了更稳。
 *
 *   2. 分字段配置（向下兼容）：
 *      - `BILI_SESSDATA`     登录态凭证（必填）
 *      - `BILI_BILI_JCT`     CSRF token（必填）
 *      - `BILI_DEDE_USER_ID` 用户 UID（可选）
 *
 * 返回拼接好的 Cookie header 字符串；均未配置则返回 ''
 *
 * ⚠️ 2026-09-16 实测补充：cookie 是**必需**的，不是可选优化。
 *   无 cookie 打 `/x/space/wbi/arc/search` → `-352 风控校验失败`；
 *   带 cookie（哪怕只有 3 个字段）→ `code=0`。
 *   见 `out/_referer_matrix.txt`（5 种 Referer/ cookie 组合矩阵）。
 *
 * BUG-K 修复（2026-09-06）：getBiliCookie + checkBiliCookieHealth
 *   - 老版本：SESSDATA 过期静默失败（爬虫返回 -799/-412，无告警）
 *   - 新增：checkBiliCookieHealth() 调用方可主动检测 + alert 告警
 */

import { logger } from '../observability/logger';

export function getBiliCookie(): string {
  // 方式 1：整条 cookie 原样使用（优先级最高）
  const full = (process.env.BILI_COOKIE ?? '').trim();
  if (full) return full;

  // 方式 2：分字段拼接（向下兼容）
  const sess = process.env.BILI_SESSDATA ?? '';
  const jct = process.env.BILI_BILI_JCT ?? '';
  const dede = process.env.BILI_DEDE_USER_ID ?? '';
  const parts: string[] = [];
  if (sess) parts.push(`SESSDATA=${sess}`);
  if (jct) parts.push(`bili_jct=${jct}`);
  if (dede) parts.push(`DedeUserID=${dede}`);
  return parts.join('; ');
}

/**
 * B 站 cookie 健康度检查
 *
 * 返回：
 *   - 'ok'         : 配置齐全且格式合理
 *   - 'empty'      : 未配置（无 BILI_COOKIE，也无 SESSDATA / JCT）
 *   - 'suspicious' : 配置存在但格式可疑（如 SESSDATA 长度异常）
 *
 * 调用方应据此决定是否 alert 告警（不要在这里直接 alert，让调用方决定）
 */
export function checkBiliCookieHealth(): 'ok' | 'empty' | 'suspicious' {
  // 整条 cookie 模式：只要有 SESSDATA 字段就算配置齐全
  const full = (process.env.BILI_COOKIE ?? '').trim();
  if (full) {
    const hasSess = /(?:^|;\s*)SESSDATA=/.test(full);
    if (!hasSess) {
      logger.warn('[bilibili/cookie] BILI_COOKIE 缺少 SESSDATA 字段');
      return 'suspicious';
    }
    return 'ok';
  }

  const sess = process.env.BILI_SESSDATA ?? '';
  const jct = process.env.BILI_BILI_JCT ?? '';
  if (!sess || !jct) return 'empty';
  // SESSDATA 是 base64 编码，通常 80-200 字符之间
  // JCT 是 32 字符 hex
  if (sess.length < 60 || sess.length > 300 || jct.length !== 32) {
    logger.warn('[bilibili/cookie] format suspicious', {
      sessLen: sess.length,
      jctLen: jct.length,
    });
    return 'suspicious';
  }
  return 'ok';
}