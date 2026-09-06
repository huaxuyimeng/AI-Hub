// POST /api/upload/bg
// 接收 multipart form 上传，做校验、调 R2 上传、写历史、写 UserPreferences。
// 每次上传都写到 WallpaperHistory（用户可见的历史列表）。
//
// DELETE /api/upload/bg?id=<historyId>
//   - 不带 id：移除当前激活壁纸，并清空 UserPreferences
//   - 带 id：删除历史记录项（若是 active 则同时清空）

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadObject, deleteObject, isR2Configured, validateFile } from '@/lib/r2';
import { prismaBase } from '@/lib/db';
import { sanitizeError } from '@/lib/sanitize';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // 1. 鉴权
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  if (!session.user.tenantId) {
    return NextResponse.json({ error: 'No tenant' }, { status: 403 });
  }
  const tenantId = session.user.tenantId;

  // 2. R2 可用性
  if (!isR2Configured()) {
    return NextResponse.json(
      { error: 'R2 未配置；请联系管理员或在 .env 中配置 R2 凭据' },
      { status: 503 }
    );
  }

  // 3. 解析 multipart form
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

  // 4. 校验
  const buf = Buffer.from(await file.arrayBuffer());
  const v = validateFile({ size: file.size, type: file.type, buffer: buf });
  if (!v.ok) {
    return NextResponse.json({ error: v.reason }, { status: 400 });
  }

  // 5. 上传
  let url: string;
  let key: string;
  try {
    const r = await uploadObject({
      prefix: `bg/${tenantId}/`,
      body: buf,
      contentType: file.type,
      originalName: file.name,
    });
    url = r.url;
    key = r.key;
  } catch (e) {
    // BUG-11 修复（2026-09-06）：不向客户端泄露 R2 原始错误
    logger.error('[upload/bg] R2 upload failed', { error: (e as Error).message });
    return NextResponse.json(
      { error: sanitizeError((e as Error).message ?? '上传失败') },
      { status: 500 },
    );
  }

  // 6. DB：写历史 + 更新 active + 设置 active 为唯一 active + 写 UserPreferences
  try {
    await prismaBase.$transaction([
      // 取消所有 active
      prismaBase.wallpaperHistory.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      }),
      // 写新历史
      prismaBase.wallpaperHistory.create({
        data: {
          userId,
          tenantId,
          r2Key: key,
          url,
          isActive: true,
          sizeBytes: file.size,
          contentType: file.type,
          label: (form.get('label') as string | null)?.trim().slice(0, 40) ?? '',
        },
      }),
      // UserPreferences.bgImageUrl
      prismaBase.userPreferences.upsert({
        where: { userId },
        update: { bgImageUrl: url },
        create: { userId, tenantId, bgImageUrl: url },
      }),
    ]);
  } catch (e) {
    // 入库失败：把已上传图删掉，避免悬挂对象
    deleteObject(key).catch(() => {});
    return NextResponse.json({ error: '入库失败' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (id) {
    // 删除指定历史项
    const row = await prismaBase.wallpaperHistory.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    deleteObject(row.r2Key).catch(() => {});
    await prismaBase.wallpaperHistory.delete({ where: { id: row.id } });
    if (row.isActive) {
      await prismaBase.userPreferences.update({
        where: { userId: session.user.id },
        data: { bgImageUrl: null },
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  // 不带 id：移除当前激活壁纸
  const existing = await prismaBase.userPreferences.findUnique({
    where: { userId: session.user.id },
  });
  if (existing?.bgImageUrl) {
    // 直接传 URL，deleteObject 内部会 parse key
    deleteObject(existing.bgImageUrl).catch(() => {});
  }
  // active 历史也一起标 inactive 删掉
  await prismaBase.wallpaperHistory.updateMany({
    where: { userId: session.user.id, isActive: true },
    data: { isActive: false },
  });
  await prismaBase.userPreferences.update({
    where: { userId: session.user.id },
    data: { bgImageUrl: null },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}