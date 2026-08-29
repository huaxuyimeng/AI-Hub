// 来源：d:\1Money\design\API设计.md §2.2 + §2.3 tRPC init
// 核心：context 注入 tenantId + 会话

import { initTRPC, TRPCError } from '@trpc/server';
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { getServerSession } from 'next-auth';
import superjson from 'superjson';
import { authOptions } from '@/lib/auth';

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