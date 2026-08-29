// POST /api/auth/register
// 批次 C13 配套：注册时生成 bcrypt 密码哈希
// S-01: 加入 IP 限流（5 次/分钟），基于 @upstash/redis（项目已装）
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { Redis } from '@upstash/redis';
import { prismaBase } from '@/lib/db';
import { env } from '@/lib/env';

const RegisterSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
});

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown';
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri;
  return 'unknown';
}

/**
 * 简易 sliding-window 限流：基于 Redis INCR + EXPIRE
 * - key: rl:register:<ip>
 * - 窗口：60 秒
 * - 上限：5 次
 * 返回：是否允许
 */
async function rateLimit(ip: string, max = 5, windowSec = 60): Promise<boolean> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    // 未配置 Redis 时放行（开发环境/无 KV 部署）
    return true;
  }
  try {
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
    const key = `rl:register:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }
    return count <= max;
  } catch {
    // Redis 异常时放行（fail-open），避免 Redis 故障锁死注册
    return true;
  }
}

export async function POST(req: NextRequest) {
  // 限流前置：在 body parse 前就限，避免大 body 消耗
  const ip = getClientIp(req);
  const allowed = await rateLimit(ip, 5, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { email: rawEmail, password, name } = parsed.data;
  // Q8 修复：归一化邮箱到小写，消除大小写歧义
  const email = rawEmail.trim().toLowerCase();

  const existing = await prismaBase.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: '该邮箱已被注册' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    // 同 signIn callback 逻辑：首次注册自动建 Tenant + User
    const slugBase = email.split('@')[0].replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'user';
    const tenant = await prismaBase.tenant.create({
      data: { name: `${name ?? email.split('@')[0]} 的空间`, slug: `${slugBase}-${Date.now().toString(36)}` },
    });
    const user = await prismaBase.user.create({
      data: {
        tenantId: tenant.id,
        email,
        name: name ?? null,
        passwordHash,
        role: 'ADMIN',
      },
    });
    return NextResponse.json({ ok: true, userId: user.id, tenantId: tenant.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: '该邮箱已被注册' }, { status: 409 });
    }
    return NextResponse.json({ error: '注册失败' }, { status: 500 });
  }
}