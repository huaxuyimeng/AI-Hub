// tRPC wallpaper router
// 壁纸历史：list / setActive / delete / rename

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../context';
import { prismaBase } from '../../lib/db';
import { deleteObject } from '../../lib/r2';
import { logger } from '@/lib/observability/logger';

export const wallpaperRouter = router({
  /** 列出当前用户的所有壁纸（按 lastUsedAt desc） */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await prismaBase.wallpaperHistory.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      label: r.label,
      isActive: r.isActive,
      sizeBytes: r.sizeBytes,
      contentType: r.contentType,
      opacity: r.opacity,
      createdAt: r.createdAt.toISOString(),
    }));
  }),

  /** 激活某张历史壁纸（先取消其它，再设为 active + 同步 UserPreferences.bgImageUrl + opacity） */
  setActive: protectedProcedure
    .input(z.object({ id: z.string().uuid(), opacity: z.number().min(0).max(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await prismaBase.wallpaperHistory.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '壁纸不存在' });
      }
      // opacity 取值：优先用传入值，没有则用该壁纸的历史值，都没有则默认 0.35
      const finalOpacity = input.opacity ?? row.opacity ?? 0.35;
      await prismaBase.$transaction([
        prismaBase.wallpaperHistory.updateMany({
          where: { userId: ctx.session.user.id, isActive: true },
          data: { isActive: false },
        }),
        prismaBase.wallpaperHistory.update({
          where: { id: row.id },
          data: { isActive: true, opacity: finalOpacity },
        }),
        prismaBase.userPreferences.upsert({
          where: { userId: ctx.session.user.id },
          update: { bgImageUrl: row.url, bgImageOpacity: finalOpacity },
          create: {
            userId: ctx.session.user.id,
            tenantId: ctx.tenantId!,
            bgImageUrl: row.url,
            bgImageOpacity: finalOpacity,
          },
        }),
      ]);
      return { ok: true, url: row.url, opacity: finalOpacity };
    }),

  /** 删除某张历史壁纸（R2 + DB）；若是 active，则同时清 UserPreferences.bgImageUrl */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await prismaBase.wallpaperHistory.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '壁纸不存在' });
      }
      // R2 异步删（失败不影响主流程，但需要日志以便排查）
      deleteObject(row.r2Key).catch((e) => {
        logger.warn('[wallpaper] R2 delete failed, orphan cleanup will retry', { key: row.r2Key, error: e?.message });
      });
      // DB 删
      await prismaBase.wallpaperHistory.delete({ where: { id: row.id } });
      // 若被删的是 active，清空 UserPreferences
      if (row.isActive) {
        await prismaBase.userPreferences.update({
          where: { userId: ctx.session.user.id },
          data: { bgImageUrl: null },
        }).catch((e) => {
          logger.warn('[wallpaper] bgImageUrl cleanup failed (DB soft-delete already done)', { userId: ctx.session.user.id, error: e?.message });
        });
      }
      return { ok: true };
    }),

  /** 重命名壁纸标签 */
  rename: protectedProcedure
    .input(z.object({ id: z.string().uuid(), label: z.string().max(40) }))
    .mutation(async ({ ctx, input }) => {
      const row = await prismaBase.wallpaperHistory.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '壁纸不存在' });
      }
      await prismaBase.wallpaperHistory.update({
        where: { id: row.id },
        data: { label: input.label.trim() },
      });
      return { ok: true };
    }),

  /** 更新当前激活壁纸的透明度（同时写入 WallpaperHistory.opacity + UserPreferences.bgImageOpacity） */
  setOpacity: protectedProcedure
    .input(z.object({ id: z.string().uuid(), opacity: z.number().min(0).max(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await prismaBase.wallpaperHistory.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '壁纸不存在' });
      }
      await prismaBase.$transaction([
        prismaBase.wallpaperHistory.update({
          where: { id: row.id },
          data: { opacity: input.opacity },
        }),
        // 仅当该壁纸是当前 active 时才同步 UserPreferences（否则只存 WallpaperHistory）
        ...(row.isActive ? [
          prismaBase.userPreferences.updateMany({
            where: { userId: ctx.session.user.id },
            data: { bgImageOpacity: input.opacity },
          }),
        ] : []),
      ]);
      return { ok: true, opacity: input.opacity };
    }),

  /** 清空所有非 active 历史壁纸（保留当前选中的） */
  clearInactive: protectedProcedure.mutation(async ({ ctx }) => {
    const rows = await prismaBase.wallpaperHistory.findMany({
      where: { userId: ctx.session.user.id, isActive: false },
      select: { r2Key: true },
    });
    // 异步批量删除 R2 对象
    Promise.allSettled(rows.map((r) => deleteObject(r.r2Key))).catch((err) => {
      logger.warn('[wallpaper] batch R2 delete failed (orphan cleanup will retry)', { count: rows.length, error: (err as Error)?.message });
    });
    const result = await prismaBase.wallpaperHistory.deleteMany({
      where: { userId: ctx.session.user.id, isActive: false },
    });
    return { deleted: result.count };
  }),
});