// 来源：d:\1Money\design\API设计.md §二 projectRouter
// 批次 B6：软删除 (softDelete / trash / restore) + 硬删除 (hardDelete admin)
// 批次 C14：trash/restore/hardDelete 加租户归属校验

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import { protectedProcedure, adminProcedure, router } from '../context';
import { createTenantPrisma, prismaRaw } from '../../lib/db';
import { softDeleteProject, restoreProject, hardDeleteProject } from '../../lib/lifecycle';
import { toPublicProject } from '../../lib/sanitize';

// C14 helper：校验项目是否归属当前租户。软删 / 硬删都先调它。
async function assertProjectOwned(tenantId: string | undefined, projectId: string, includeTrashed = false) {
  if (!tenantId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing tenant context' });
  }
  const owner = await prismaRaw.project.findFirst({
    where: { id: projectId, tenantId, deletedAt: includeTrashed ? undefined : null },
    select: { id: true },
  });
  if (!owner) {
    // 用 NOT_FOUND 而非 FORBIDDEN，避免向攻击者泄露项目存在性
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  }
}

export const projectRouter = router({
  list: protectedProcedure
    .input(z.object({
      cursor: z.string().uuid().optional(),
      take: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const [items, count] = await Promise.all([
        prisma.project.findMany({
          take: input.take + 1,
          cursor: input.cursor ? { id: input.cursor } : undefined,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.project.count(),  // P-04: 总数（不依赖 take）
      ]);
      const nextCursor = items.length > input.take ? items.pop()?.id : null;
      return { items: items.map(toPublicProject), nextCursor, count };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const project = await prisma.project.findUnique({ where: { id: input.id } });
      if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
      return toPublicProject(project);
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(80),
      slug: z.string().regex(/^[a-z0-9-]+$/),
      description: z.string().max(500).optional(),
      visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });

      // B-09 修复：预检软删后的同名 slug（DB 层无 partial unique index，应用层兜底）
      // 软删记录 (deletedAt != null) 不阻塞新建同名——这是设计意图
      // 但同一 tenant 下「存活」的同名 slug 必须拒绝
      const aliveDuplicate = await prisma.project.findFirst({
        where: { tenantId: ctx.tenantId, slug: input.slug, deletedAt: null },
        select: { id: true },
      });
      if (aliveDuplicate) {
        throw new TRPCError({ code: 'CONFLICT', message: `Slug "${input.slug}" 已存在` });
      }

      // DS-04: create 带 retry，不再做预检（避免 TOCTOU 竞态）
      // tryCreate 在 catch 里自动追加后缀重试，最多重试 2 次
      async function tryCreate(slugAttempt: string, retries = 2) {
        const slug = slugAttempt.length > 60
          ? slugAttempt.slice(0, 57) + '-' + randomBytes(2).toString('hex')
          : retries > 0
          ? `${slugAttempt}-${randomBytes(2).toString('hex')}`
          : slugAttempt;
        try {
          return await prisma.project.create({
            data: {
              tenantId: ctx.tenantId,
              name: input.name,
              slug,
              description: input.description,
              visibility: input.visibility,
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && retries > 0) {
            return tryCreate(input.slug, retries - 1);
          }
          throw e;
        }
      }

      try {
        const project = await tryCreate(input.slug);
        return toPublicProject(project);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // P3 修复：tryCreate 内部用 randomBytes 追加后缀，故 P2002 通常是极端竞态
          // （极小概率：两进程同时生成相同 randomBytes）。原错误信息改为更精确的"冲突"
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Slug "${input.slug}" 创建冲突（已重试，请重试）`,
          });
        }
        throw e;
      }
    }),

  trash: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // C14：先校验归属，避免跨租户误删
      await assertProjectOwned(ctx.tenantId, input.id);
      await softDeleteProject(prismaRaw, input.id);
      return { ok: true };
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // C14：restore 也要校验（含已软删项目）
      await assertProjectOwned(ctx.tenantId, input.id, true);
      await restoreProject(prismaRaw, input.id);
      return { ok: true };
    }),

  hardDelete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // BUG-10 修复（2026-09-06）：使用 adminProcedure，实时查库校验 role
      // 避免 JWT 快照在 token 有效期内被降权后仍带 ADMIN 的越权窗口
      // adminProcedure 继承自 protectedProcedure，运行时已断言 tenantId 非空
      await assertProjectOwned(ctx.tenantId ?? undefined, input.id, true);
      await hardDeleteProject(prismaRaw, input.id);
      return { ok: true };
    }),

  // ─────────── API Key 管理（租户级） ───────────

  /** 当前租户的所有 api key */
  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const items = await prismaRaw.apiKey.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, keyLast4: true, provider: true, createdAt: true, lastUsedAt: true },
    });
    return { items };
  }),

  /** 创建新 key（明文只在返回值中显示一次） */
  createApiKey: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });

      // 32 字节随机 → base64url
      const raw = randomBytes(32).toString('base64url');
      const plainKey = `aihub_${raw}`;
      const keyHash = createHash('sha256').update(plainKey).digest('hex');
      const keyLast4 = plainKey.slice(-4);

      const created = await prismaRaw.apiKey.create({
        data: {
          tenantId: ctx.tenantId,
          provider: 'aihub-rest',
          keyHash,
          keyLast4,
          label: input.name,
        },
      });

      return {
        id: created.id,
        name: created.label,
        prefix: `…${created.keyLast4}`,
        createdAt: created.createdAt,
        plainKey, // ⚠️ 只此一次返回明文
      };
    }),

  /** 撤销 key（软删除） */
  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const owner = await prismaRaw.apiKey.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND' });
      await prismaRaw.apiKey.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    }),
});