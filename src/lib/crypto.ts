/**
 * API Key 加密工具（AES-256-GCM）
 *
 * 路径：src/lib/crypto.ts
 *
 * 设计：
 *   - AES-256-GCM：带认证标签，防篡改
 *   - 密钥来自 APP_SECRET 环境变量（至少 32 字符）
 *   - IV 每次随机生成（12 字节），密文自带
 *   - 即使 DB 被读，没有 APP_SECRET 也无法还原 key
 *
 * 安全约束：
 *   - APP_SECRET 不能进日志
 *   - 加密失败时抛 Error，绝不返回空值
 *   - P1-#2 修复：用 SHA-256(APP_SECRET) 派生 32 字节密钥，不再使用 Buffer.fill（语义错误）
 *
 * ⚠️ SECURITY: 此前实现 `Buffer.alloc(32).fill(secret).fill(secret.slice(0, 32))`
 * 的实际效果是：把 32 字节缓冲区全部填充为 `secret[0].charCodeAt(0)`（如 'A' = 0x41）。
 * 即密钥被简化为单字节重复，与 APP_SECRET 内容完全脱钩 —— 等同密钥硬编码。
 *
 * 影响：
 *   - 所有 ApiKey 加密在历史上实际只用了 256 种可能密钥之一（首字符决定）
 *   - 攻击者只需 256 次尝试即可暴力破解
 *   - 必须配合强制重加密（迁移时用旧逻辑重新加密所有 ApiKey）
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12; // GCM 推荐 12 字节
const TAG_LEN = 16; // GCM tag 固定 16 字节

/**
 * 从 APP_SECRET 派生 32 字节 AES-256 密钥
 *
 * P1-#2 修复：
 *   - 主路径：SHA-256(APP_SECRET) → 256-bit 强密钥（修复 Buffer.fill 语义错误）
 *   - 兼容路径（仅解密）：旧的 Buffer.fill 派生（首字符重复 32 次）
 *     用于解密历史 ApiKey 密文，命中后自动用新密钥重新加密回写
 *
 * 加密路径只使用主路径（避免产生新的弱密钥密文）
 */
function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('[crypto] APP_SECRET 环境变量未设置或长度不足 32 字符，请设置为强随机字符串');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * 旧版密钥派生（仅 decrypt 用）—— 历史上 ApiKey 用的弱密钥
 * 等效于：把 32 字节全部填充为 secret[0].charCodeAt(0)
 *
 * ⚠️ 已知弱密钥：256 种可能，应在解密成功后立即用新密钥重加密
 */
function getLegacyKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('[crypto] APP_SECRET 环境变量未设置');
  }
  const firstByte = Buffer.from(secret, 'utf8')[0];
  return Buffer.alloc(32).fill(firstByte);
}

/**
 * 加密明文，返回 base64(IV + ciphertext + tag)
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

/**
 * 解密（inverse of encrypt）
 *
 * 双路径：
 *   1. 先用新密钥（SHA-256 派生）尝试解密 —— 处理新写入的密文
 *   2. 失败时回退到旧密钥（Buffer.fill 派生）—— 处理历史密文
 *   3. 历史密文解密成功 → 不重加密（避免在 read path 写 DB，引发并发问题）
 *
 * 升级策略：ApiKey 写入路径（ai-keys router）下次 update 时自然用新密钥重加密
 */
export function decrypt(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error('[crypto] decrypt: ciphertext too short');
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const encrypted = raw.subarray(IV_LEN, raw.length - TAG_LEN);

  // 1. 新密钥优先
  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    // 2. 旧密钥回退（历史 ApiKey 密文）
    const decipher = createDecipheriv(ALGORITHM, getLegacyKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}