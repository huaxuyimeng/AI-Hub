// 来源：d:\1Money\design\API设计.md §2.2 + §2.3 tRPC init
// 核心：context 注入 tenantId + 会话

import { initTRPC, TRPCError } from '@trpc/server';
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { getServerSession } from 'next-auth';
import superjson from 'superjson';
import { authOptions } from '@/lib/auth';
import { logger } from '@/lib/observability/logger';
import { prismaRaw } from '@/lib/db';

export async function createContext(opts: FetchCreateContextFnOptions) {
  // ✅ v3.3.1 修复：getServerSession 必须传 authOptions，否则 session 永远 null
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { session: null, tenantId: null };
  }

  // 批次 A 必修：tenantId 必须来自 session 而非客户端
  const tenantId = session.user.tenantId ?? null;

  return { session, tenantId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause && typeof error.cause === 'object' && 'flatten' in error.cause
          ? (error.cause as unknown as { flatten: () => unknown }).flatten()
          : null,
    },
  }),
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * 受保护 procedure：要求 session + tenantId 必须存在
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.tenantId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Login required' });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      tenantId: ctx.tenantId,
    },
  });
});

/**
 * ADMIN 门禁：实时查库校验角色（修复 BUG-10 部分 + BUG-05 部分）
 *
 * 为什么不能用 ctx.session.user.role：
 *   1. JWT 快照在 token 有效期内不会刷新（典型 7 天），降权后旧 token 仍带 ADMIN
 *   2. 安全敏感操作（refresh / hardDelete）必须用"现在"的角色，而非"登录时"的角色
 *
 * 用法：
 *   const adminProcedure = protectedProcedure.use(requireAdmin);
 *   refresh: adminProcedure.mutation(...)
 */
export const requireAdmin = t.middleware(async ({ ctx, next, path }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  // 实时查库（避免 JWT 快照带来的越权窗口）
  const user = await prismaRaw.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { role: true, deletedAt: true },
  });
  if (!user || user.deletedAt !== null) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User no longer valid' });
  }
  if (user.role !== 'ADMIN') {
    logger.warn('[requireAdmin] forbidden access attempt', {
      userId: ctx.session.user.id,
      path,
      actualRole: user.role,
    });
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin role required' });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      tenantId: ctx.tenantId,
      isAdmin: true as const,
    },
  });
});

/** 受保护 + ADMIN 校验的 procedure（修复 BUG-05） */
export const adminProcedure = protectedProcedure.use(requireAdmin);