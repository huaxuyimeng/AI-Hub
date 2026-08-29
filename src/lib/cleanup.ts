// 来源：d:\1Money\design\部署运维.md §11.1
// 批次 B13 + 批次 C16/C17/C18：单一入口；R2 懒初始化；用 Prisma API；extractR2Key 真正生效

import { prismaRaw } from './db';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';

// C16：R2 懒初始化，避免未配置时模块顶层崩溃
let _r2: S3Client | null = null;

function isR2Configured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_R2_ACCOUNT_ID &&
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  );
}

function getR2(): S3Client {
  if (_r2) return _r2;
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 配置缺失：需要 CLOUDFLARE_R2_ACCOUNT_ID / ACCESS_KEY_ID / SECRET_ACCESS_KEY'
    );
  }
  _r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _r2;
}

/**
 * 从字符串规范化 R2 key（防路径穿越）
 *
 * C18 重载：原版只接受完整 URL（https://host/files/xxx）。现在支持：
 *   - 完整 URL（同原版）
 *   - 纯 key（r2Key 列里的值）
 *
 * 纯 key 模式：禁止以 `..` 开头 / 不允许 normalize 后逃出当前目录
 */
// Q7 修复：扩展 extractR2Key 支持 /bg/ 前缀（背景图 URL）
// 原来只认 /files/，导致背景图删除静默失败
export function extractR2Key(input: string): string | null {
  if (typeof input !== 'string' || !input) return null;
  const rawKey = input.startsWith('http://') || input.startsWith('https://')
    ? (() => {
        try {
          const u = new URL(input);
          // 支持 /files/（代码文件）和 /bg/（背景图）两种前缀
          for (const prefix of ['/files/', '/bg/']) {
            if (u.pathname.startsWith(prefix)) {
              return u.pathname.slice(prefix.length);
            }
          }
          return null;
        } catch {
          return null;
        }
      })()
    : input;
  if (rawKey === null) return null;
  return normalizeR2Key(rawKey);
}

function normalizeR2Key(rawKey: string): string | null {
  if (!rawKey) return null;
  const normalized = path.posix.normalize(rawKey);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('..')) {
    return null;
  }
  return normalized;
}

/**
 * 清理孤儿文件：DB 中已软删超过阈值的 File 行，去 R2 删除对应对象
 * 阈值：ORPHAN_RETENTION_DAYS 天的孤儿文件（默认 7 天，与批次 B13 一致）
 */
export async function cleanupOrphanFiles(): Promise<{ deleted: number; errors: number; skipped: boolean }> {
  // C16：R2 未配置时显式跳过，不再尝试构造 S3Client
  if (!isR2Configured()) {
    console.warn('[cleanup] R2 未配置，跳过孤儿文件清理');
    return { deleted: 0, errors: 0, skipped: true };
  }

  const retentionDays = parseInt(process.env.ORPHAN_RETENTION_DAYS ?? '7', 10);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted: string[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];

  // C17：用 Prisma API 替代裸 SQL，跨 SQLite / PostgreSQL 通用
  // 注意：File 模型不在 TENANT_SCOPED_MODELS，仅在软删除范围内，需手动用 prismaRaw 绕过中间件
  const orphanFiles = await prismaRaw.file.findMany({
    where: {
      deletedAt: { not: null, lt: cutoff },
      r2Key: { not: '' },
    },
    select: { r2Key: true },
    take: 1000,
  });

  // 去重：DB 里可能同一 r2Key 对应多行
  const uniqueKeys = Array.from(
    new Set(orphanFiles.map((f) => f.r2Key).filter((k): k is string => Boolean(k)))
  );

  let r2: S3Client;
  try {
    r2 = getR2();
  } catch (e) {
    console.error('[cleanup] R2 初始化失败：', (e as Error).message);
    return { deleted: 0, errors: uniqueKeys.length, skipped: true };
  }

  for (const rawKey of uniqueKeys) {
    // C18：每个 key 都先经过 extractR2Key，防路径穿越
    const safeKey = extractR2Key(rawKey);
    if (!safeKey) {
      skipped.push(rawKey);
      continue;
    }
    try {
      await r2.send(new DeleteObjectCommand({
        Bucket: process.env.CLOUDFLARE_R2_BUCKET,
        Key: safeKey,
      }));
      deleted.push(safeKey);
    } catch {
      errors.push(safeKey);
    }
  }

  if (skipped.length) {
    console.warn(`[cleanup] ${skipped.length} 个不安全 key 已跳过`);
  }
  return { deleted: deleted.length, errors: errors.length, skipped: false };
}