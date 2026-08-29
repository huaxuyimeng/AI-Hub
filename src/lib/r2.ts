// 来源：.cursor/skills/workbench-ui-designer §6.4 + 6.5
// R2 上传通道：供 /api/upload/bg 和 tRPC 调用
// 复用 cleanup.ts 的 R2 client 懒初始化逻辑
//
// 当前实现：客户端 → Next.js Route → R2（服务端转发）
// P2 阶段优化：客户端 → R2 直传（需要 presigned URL，需要 @aws-sdk/s3-request-presigner 包）

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { extractR2Key } from './cleanup';
import { env } from './env';

export const R2_PUBLIC_BASE_URL = env.CLOUDFLARE_R2_PUBLIC_URL ?? '';

let _client: S3Client | null = null;

export function isR2Configured(): boolean {
  return Boolean(
    env.CLOUDFLARE_R2_ACCOUNT_ID &&
      env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
      env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
      env.CLOUDFLARE_R2_BUCKET
  );
}

function client(): S3Client {
  if (_client) return _client;
  if (!isR2Configured()) {
    throw new Error('R2 未配置：检查 env.ts');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

export interface UploadParams {
  /** 业务路径前缀，比如 "bg/" */
  prefix: string;
  body: Buffer | Uint8Array;
  contentType: string;
  /** 原文件名，用于推断扩展名 */
  originalName?: string;
}

export interface UploadResult {
  key: string;
  url: string;
}

/**
 * 上传一个对象到 R2 并返回 public URL。
 * key 用 crypto.randomUUID 防止冲突且无法猜测。
 */
export async function uploadObject(p: UploadParams): Promise<UploadResult> {
  const ext = p.originalName?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase().slice(0, 5) ?? '';
  const safeKey = `${p.prefix}${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
  await client().send(
    new PutObjectCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET,
      Key: safeKey,
      Body: p.body,
      ContentType: p.contentType,
      CacheControl: 'public, max-age=2592000',
    })
  );
  return {
    key: safeKey,
    url: publicUrl(safeKey),
  };
}

// Q7 修复：支持两种调用方式：
// 1. 纯 key（bg/route.ts 直传上传时拿到的 key）→ 直接用
// 2. 完整 URL → extractR2Key 解析（兼容旧调用）
export async function deleteObject(keyOrUrl: string): Promise<void> {
  if (!keyOrUrl) return;
  // 优先按纯 key 处理（bg/route.ts 现在传 key 而非 URL）
  if (!keyOrUrl.startsWith('http://') && !keyOrUrl.startsWith('https://')) {
    const safe = extractR2Key(keyOrUrl);
    if (!safe) return;
    await client().send(
      new DeleteObjectCommand({ Bucket: env.CLOUDFLARE_R2_BUCKET, Key: safe })
    );
    return;
  }
  // 完整 URL：走 extractR2Key（含 /files/ 前缀处理）
  const safe = extractR2Key(keyOrUrl);
  if (!safe) return;
  await client().send(
    new DeleteObjectCommand({ Bucket: env.CLOUDFLARE_R2_BUCKET, Key: safe })
  );
}

export function publicUrl(key: string): string {
  if (R2_PUBLIC_BASE_URL) {
    return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
  }
  // fallback：直接用 R2 endpoint（需要 bucket 设置为 public）
  return `https://${env.CLOUDFLARE_R2_ACCOUNT_ID!}.r2.cloudflarestorage.com/${env.CLOUDFLARE_R2_BUCKET}/${key}`;
}

/** 校验文件大小 / MIME / 魔数（Q9 修复：禁 SVG、服务端定 Content-Type） */
export function validateFile(file: { size: number; type: string; buffer?: Buffer }): { ok: boolean; reason?: string } {
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) return { ok: false, reason: '文件不能超过 5MB' };

  // Q9 修复：白名单 MIME，不接受 SVG（可含 script → 存储型 XSS）
  const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, reason: `只接受 PNG/JPEG/WebP/GIF 图片，收到 ${file.type}` };
  }

  // Q9 修复：魔数校验不信任客户端 type，必须和真实内容匹配
  if (file.buffer && !checkMagicNumber(file.buffer, file.type)) {
    return { ok: false, reason: '文件内容与声明格式不一致' };
  }
  return { ok: true };
}

// Q9 修复：魔数校验，安全默认拒绝
function checkMagicNumber(buf: Buffer, type: string): boolean {
  if (buf.length < 12) return false;
  if (type === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (type === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (type === 'image/webp') {
    return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
           buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  }
  if (type === 'image/gif') {
    return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  }
  // 未知的 image/* 类型默认拒绝（安全默认）
  return false;
}