// POST /api/upload/bg
// 接收 multipart form 上传，做校验、调 R2 上传、返回 url。
// 同时把 url 写到 UserPreferences.bgImageUrl（旧 url 自动失效）。

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadObject, deleteObject, isR2Configured, validateFile } from '@/lib/r2';
import { prismaBase } from '@/lib/db';

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

  // 4. 校验（buffer 验完后再丢弃）
  const buf = Buffer.from(await file.arrayBuffer());
  const v = validateFile({ size: file.size, type: file.type, buffer: buf });
  if (!v.ok) {
    return NextResponse.json({ error: v.reason }, { status: 400 });
  }

  // 7. 上传
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
    return NextResponse.json({ error: (e as Error).message ?? '上传失败' }, { status: 500 });
  }

  // 8. 写 UserPreferences + 删旧图
  try {
    const existing = await prismaBase.userPreferences.findUnique({ where: { userId } });
    if (existing?.bgImageUrl && existing.bgImageUrl !== url) {
      // Q7 修复：传 key 而非 URL，避免 extractR2Key 前缀不匹配导致静默失败
      deleteObject(key).catch(() => {});
    }
    await prismaBase.userPreferences.upsert({
      where: { userId },
      update: { bgImageUrl: url },
      create: { userId, tenantId, bgImageUrl: url },
    });
  } catch (e) {
    // 入库失败：把已上传图删掉，避免悬挂对象
    deleteObject(key).catch(() => {});
    return NextResponse.json({ error: '入库失败' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existing = await prismaBase.userPreferences.findUnique({
    where: { userId: session.user.id },
  });
  if (existing?.bgImageUrl) {
    deleteObject(existing.bgImageUrl).catch(() => {});
  }
  await prismaBase.userPreferences.update({
    where: { userId: session.user.id },
    data: { bgImageUrl: null },
  }).catch(() => {
    // 如果没有记录，忽略
  });
  return NextResponse.json({ ok: true });
}