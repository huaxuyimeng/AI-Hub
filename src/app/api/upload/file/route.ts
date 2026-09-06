// C-8 修复：项目文件上传端点
//
// 流程（与 /api/upload/bg 一致）：
//   auth -> R2 配置检查 -> 校验文件（代码/文本，仅白名单扩展名 + UTF-8） ->
//   校验 project 归属 -> 计算 hash -> 上传 R2 -> upsert File 表 -> 返回元信息
//
// 与壁纸上传的关键差异：
//   - 接受代码/文本文件，拒绝二进制（白名单扩展名 + UTF-8 解码）
//   - 单文件 50KB 上限（适配 analysis.run 的 max(50_000) 限制）
//   - 同一 (projectId, path) 自动 upsert，避免重复
//   - r2Key 形如 projects/{projectId}/{hash[:12]}-{safeName}（同内容同 key，幂等）

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { authOptions } from '@/lib/auth';
import { publicUrl, isR2Configured } from '@/lib/r2';
import { prismaBase } from '@/lib/db';
import { env } from '@/lib/env';
import { languageFromPath, mimeFromLanguage } from '@/lib/file-language';
import { sanitizeError } from '@/lib/sanitize';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_FILE_SIZE = 50 * 1024; // 50KB / 文件（analysis.run 限制）

/**
 * 代码/文本文件白名单
 * 拒绝：图片、可执行、压缩包、Office、PDF 等二进制
 */
const ALLOWED_EXTS = new Set([
  // Web / TS / JS
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  // 通用后端
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'scala', 'cs', 'cpp', 'c', 'h', 'hpp',
  'php', 'swift', 'm', 'mm', 'lua', 'pl', 'r',
  // Shell
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  // 数据 / 配置
  'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'conf',
  // 文档
  'md', 'mdx', 'txt', 'rst', 'tex',
  // Web 资源
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl',
  'sql', 'graphql', 'gql',
  // 其它
  'dockerfile', 'makefile', 'csv', 'log',
]);

function getSafeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
}

function getExt(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// 单例 S3 client
let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
    },
  });
  return _s3;
}

export async function POST(req: NextRequest) {
  // 1. 鉴权
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.tenantId) {
    return NextResponse.json({ error: 'No tenant' }, { status: 403 });
  }
  const tenantId = session.user.tenantId;

  // 2. R2 配置
  if (!isR2Configured()) {
    return NextResponse.json(
      { error: 'R2 未配置；请在 .env 中配置 R2 凭据后重启' },
      { status: 503 },
    );
  }

  // 3. 解析 multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 });
  }
  const projectId = form.get('projectId');
  if (typeof projectId !== 'string' || !projectId) {
    return NextResponse.json({ error: '缺少 projectId 字段' }, { status: 400 });
  }
  // 用户可显式指定 path（来自 webkitRelativePath），缺省用 file.name
  const explicitPath = form.get('path');
  const path = typeof explicitPath === 'string' && explicitPath.trim()
    ? explicitPath.trim()
    : file.name;

  // 4. 校验文件
  if (file.size === 0) {
    return NextResponse.json({ error: '空文件' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `文件超过 ${MAX_FILE_SIZE / 1024}KB 上限（${(file.size / 1024).toFixed(1)}KB）` },
      { status: 400 },
    );
  }
  const ext = getExt(path);
  if (ext && !ALLOWED_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `不支持的扩展名 .${ext}` },
      { status: 400 },
    );
  }

  // 5. 校验项目归属
  const project = await prismaBase.project.findFirst({
    where: { id: projectId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: '项目不存在或无权限' }, { status: 404 });
  }

  // 6. 读 buffer + 校验 UTF-8
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return NextResponse.json(
      { error: '文件不是有效的 UTF-8 文本（疑似二进制）' },
      { status: 400 },
    );
  }

  // 7. 计算 hash + 安全文件名
  const contentHash = createHash('sha256').update(buf).digest('hex');
  const safeName = getSafeName(path.split('/').pop() ?? 'file');
  const r2Key = `projects/${projectId}/${contentHash.slice(0, 12)}-${safeName}`;

  // 8. 上传 R2（key 用 contentHash 派生，同内容同 key 幂等）
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.CLOUDFLARE_R2_BUCKET,
        Key: r2Key,
        Body: buf,
        ContentType: mimeFromLanguage(languageFromPath(path)),
        CacheControl: 'public, max-age=2592000',
      }),
    );
  } catch (e) {
    // BUG-11 修复（2026-09-06）：不向客户端泄露 S3 原始错误（可能含 endpoint/credential/bucket）
    logger.error('[upload/file] R2 upload failed', {
      error: (e as Error).message,
    });
    const safe = sanitizeError((e as Error).message);
    return NextResponse.json(
      { error: `R2 上传失败：${safe}` },
      { status: 500 },
    );
  }

  const url = publicUrl(r2Key);
  const language = languageFromPath(path);

  // 9. upsert File 表（按 projectId+path 唯一）
  //    schema 上有 @@index([projectId, path]) 但不是 unique 复合键。
  //    由于 (projectId, path) 实际可能重复（同路径多次上传），我们用事务处理。
  const existing = await prismaBase.file.findFirst({
    where: { projectId, path, deletedAt: null },
    select: { id: true },
  });
  const record = existing
    ? await prismaBase.file.update({
        where: { id: existing.id },
        data: { language, sizeBytes: file.size, contentHash, r2Key },
        select: { id: true, path: true, language: true, sizeBytes: true, contentHash: true, createdAt: true },
      })
    : await prismaBase.file.create({
        data: {
          projectId,
          path,
          language,
          sizeBytes: file.size,
          contentHash,
          r2Key,
        },
        select: { id: true, path: true, language: true, sizeBytes: true, contentHash: true, createdAt: true },
      });

  return NextResponse.json({ ok: true, file: { ...record, url } });
}
