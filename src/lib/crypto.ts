// 来源：d:\1Money\design\API设计.md §4.4.1（批次 B7 补全）
// 用途：ApiKey 存储前散列；下载文件时校验字节
// 批次 C23：新增 verifyApiKey（常量时间比较，防时序攻击）
// 批次 C26：删 checkSize 死代码（未被引用）

import crypto from 'crypto';

export function sha256(input: string | Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(input);
  return hash.digest('hex');
}

export function hmacSha256(message: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * 生成 ApiKey 摘要用于存储：
 * - 不存储明文，只存 sha256 + last4
 */
export function hashApiKey(plainKey: string): { hash: string; last4: string } {
  const last4 = plainKey.slice(-4);
  return {
    hash: sha256(plainKey),
    last4,
  };
}

/**
 * C23：校验 ApiKey 是否匹配已存储的 hash
 * - 用 crypto.timingSafeEqual 做常量时间比较，防时序攻击
 * - 长度不一致时直接返回 false（不等同于内容不匹配，提前结束）
 * - 任一入参为空时返回 false
 */
export function verifyApiKey(plainKey: string, storedHash: string): boolean {
  if (!plainKey || !storedHash) return false;
  const a = Buffer.from(sha256(plainKey), 'hex');
  let b: Buffer;
  try {
    b = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}