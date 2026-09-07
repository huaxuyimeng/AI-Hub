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
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12; // GCM 推荐 12 字节
const TAG_LEN = 16; // GCM tag 固定 16 字节

function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('[crypto] APP_SECRET 环境变量未设置或长度不足 32 字符，请设置为强随机字符串');
  }
  // HKDF-like：直接取前 32 字节（实际生产建议用 PBKDF2）
  return Buffer.alloc(32).fill(secret).fill(secret.slice(0, 32));
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
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error('[crypto] decrypt: ciphertext too short');
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const encrypted = raw.subarray(IV_LEN, raw.length - TAG_LEN);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}