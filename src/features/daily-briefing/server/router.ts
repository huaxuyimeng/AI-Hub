/**
 * AI 早报 tRPC 路由
 * 路径：src/server/routers/daily-report.ts
 *
 * 读（今天/列表/详情）+ 写（生成/换主题/删除）+ 下载（缓存命中即返，否则即时构建）。
 * 生成为异步：立即返回状态，前端轮询 today；Vercel 中断时由次日 7:00 cron 兜底恢复。
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/context';
import { prismaBase as prisma } from '@/lib/db';
import { generateDailyReport } from '@/features/daily-briefing/lib/generate';
import { briefingFileName } from '@/features/daily-briefing/lib/build-pptx';
import { buildBriefingPptxAuto } from '@/features/daily-briefing/lib/build-pptx-dispatch';
import { DailyReportContentSchema, BRIEFING_THEMES } from '@/features/daily-briefing/lib/types';
import { beijingDateString } from '@/features/daily-briefing/lib/collect';
import { adaptV1ToV4, isV1Content } from '@/features/daily-briefing/lib/adapters/v1-to-v4';
import { logger } from '@/lib/observability/logger';

function parseContent(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // v4 schema 校验通过直接返回
    return DailyReportContentSchema.parse(parsed);
  } catch {
    // v1 降级兼容：尝试适配到 v4
    try {
      const obj = JSON.parse(raw);
      if (isV1Content(obj)) {
        logger.info('daily report: adapting v1 content to v4 format', { date: obj.date });
        return adaptV1ToV4(obj);
      }
    } catch (e) {
      // P2 修复：v1 适配失败（既不是 v4 也不是 v1 格式），静默返回 null
      // 报告会展示"内容格式无法识别"，用户可手动重新生成
      console.warn('[briefing] parseContent: v1 adaptation failed:', (e as Error).message);
    }
    return null;
  }
}

export const dailyReportRouter = router({
  /** 今天的早报（含内容 + phase，用于首屏弹窗与面板） */
  today: protectedProcedure.query(async () => {
    const date = beijingDateString();
    const row = await prisma.dailyReport.findUnique({
      where: { date },
      // 不读 pptxBase64（PPT 缓存只在 download 时才需要；这里只关心元数据 + 内容）
      select: {
        date: true, status: true, degraded: true, theme: true,
        phase: true, error: true, content: true,
        pptxBuiltAt: true, // O3'：把缓存构建时间暴露给前端，让用户能看到「上次构建 PPT 是什么时候」
      },
    });
    if (!row) {
      return { exists: false as const, date, status: 'none' as const, degraded: false, theme: 'paper', content: null, error: null, phase: null, pptxBuiltAt: null };
    }
    return {
      exists: true as const,
      date: row.date,
      status: row.status,
      degraded: row.degraded,
      theme: row.theme,
      phase: row.phase,
      error: row.error,
      content: row.status === 'ready' ? parseContent(row.content) : null,
      pptxBuiltAt: row.pptxBuiltAt,
    };
  }),

  /** 历史列表（不含内容） */
  list: protectedProcedure.query(async () => {
    const rows = await prisma.dailyReport.findMany({
      orderBy: { date: 'desc' },
      take: 60,
      select: { date: true, status: true, degraded: true, theme: true, updatedAt: true },
    });
    return rows;
  }),

  /** 某一天的完整内容 */
  get: protectedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const row = await prisma.dailyReport.findUnique({
        where: { date: input.date },
        // 不读 pptxBase64：面板只显示元数据 + 内容；pptxBase64 是 PPT 缓存，由 download 单独读取
        select: { date: true, theme: true, degraded: true, content: true, status: true, pptxBuiltAt: true },
      });
      if (!row || row.status !== 'ready') {
        throw new TRPCError({ code: 'NOT_FOUND', message: '早报不存在或未就绪' });
      }
      const parsedContent = parseContent(row.content);
      if (!parsedContent) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '早报内容损坏，请重新生成' });
      }
      return {
        date: row.date,
        theme: row.theme,
        degraded: row.degraded,
        content: parsedContent,
        pptxBuiltAt: row.pptxBuiltAt,
        isDraft: row.degraded && parsedContent.cover.subtitle.includes('草稿'),
      };
    }),

  /** 触发生成（异步，立即返回当前状态；前端轮询 today）
   * @param mode - 'auto'（默认）走 LLM → 失败自动降级草稿；'draft' 强制草稿模式
   */
  generate: protectedProcedure
    .input(z.object({ mode: z.enum(['auto', 'draft']).optional().default('auto') }))
    .mutation(async ({ ctx, input }) => {
      const date = beijingDateString();
      const existing = await prisma.dailyReport.findUnique({ where: { date } });
      if (existing?.status === 'ready') {
        return { date, status: 'ready' as const, message: '今日早报已生成' };
      }
      if (existing?.status === 'generating') {
        return { date, status: 'generating' as const, message: '正在生成中，请稍候' };
      }

      const prefs = await prisma.userPreferences.findUnique({
        where: { userId: ctx.session.user.id },
        select: { briefingWindowHour: true },
      });
      const windowHour = prefs?.briefingWindowHour ?? 8;
      const mode = input.mode ?? 'auto';

      // Batch 3：mode='draft' → 直接传 'draft'，generateDailyReport 跳过 LLM
      generateDailyReport(undefined, windowHour, mode).catch((err) => {
        logger.error('daily report async generation crashed', { error: (err as Error).message });
      });

      return { date, status: 'generating' as const, message: mode === 'draft' ? '正在生成机器草稿' : '正在生成今日早报' };
    }),

  /** 重新生成：清掉旧记录（含 PPT 缓存）+ 再异步跑（用于 failed 或主题变化后重制）
   * @param mode - 'draft' 强制草稿模式，其余走 LLM（默认 auto）
   */
  regenerate: protectedProcedure
    .input(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      mode: z.enum(['auto', 'draft']).optional().default('auto'),
    }))
    .mutation(async ({ ctx, input }) => {
      const date = input?.date ?? beijingDateString();
      const mode = input.mode ?? 'auto';

      await prisma.$transaction(async (tx) => {
        await tx.dailyReport.deleteMany({ where: { date } });
        await tx.dailyReport.create({
          data: {
            date,
            status: 'generating',
            degraded: false,
            theme: 'paper',
            phase: 'pending',
          },
        });
      });
      const prefs = await prisma.userPreferences.findUnique({
        where: { userId: ctx.session.user.id },
        select: { briefingWindowHour: true },
      });
      const windowHour = prefs?.briefingWindowHour ?? 8;
      generateDailyReport(undefined, windowHour, mode).catch((err) => {
        logger.error('daily report regenerate async crashed', { date, error: (err as Error).message });
      });
      return { date, status: 'generating' as const, message: mode === 'draft' ? '已清空旧记录，正在生成机器草稿' : '已清空旧记录，正在重新生成' };
    }),

  /** 换主题（清掉对应主题的 PPT 缓存，下次下载时重建） */
  setTheme: protectedProcedure
    .input(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      theme: z.enum(BRIEFING_THEMES as unknown as [string, ...string[]]),
    }))
    .mutation(async ({ input }) => {
      // P1-2 修复：先检查记录是否存在，不存在报 NOT_FOUND 而不是抛 P2025 500
      const exists = await prisma.dailyReport.findUnique({
        where: { date: input.date },
        select: { date: true },
      });
      if (!exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `日期 ${input.date} 的早报不存在` });
      }
      await prisma.dailyReport.update({
        where: { date: input.date },
        data: { theme: input.theme, pptxBase64: null, pptxBuiltAt: null },
      });
      return { ok: true };
    }),

  /** 删除（永久保存，仅用户手动删除） */
  delete: protectedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input }) => {
      await prisma.dailyReport.deleteMany({ where: { date: input.date } });
      return { ok: true };
    }),

  /**
   * 下载：DB 缓存命中即返 base64，未命中即时构建 + 写库。
   * 缓存以 (date, theme) 为键：换主题会自动清缓存。
   */
  download: protectedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const row = await prisma.dailyReport.findUnique({ where: { date: input.date } });
      if (!row || row.status !== 'ready') {
        throw new TRPCError({ code: 'NOT_FOUND', message: '早报不存在或未就绪' });
      }
      const content = parseContent(row.content);
      if (!content) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '早报内容损坏，请重新生成' });
      }

      let base64 = row.pptxBase64;
      let cacheHit = !!base64;
      const t0 = Date.now();

      if (cacheHit) {
        // 校验缓存有效性：长度太小 / 含非法字符都视为损坏，重新构建
        // 否则 Next.js 序列化这个大响应时会触发内部解压错误（ERR_MEMORY_ALLOCATION_FAILED）
        const ok = base64!.length > 1024 && /^[A-Za-z0-9+/=\s]+$/.test(base64!);
        if (!ok) {
          logger.warn('pptx cache corrupted, regenerating', { date: input.date, len: base64!.length });
          base64 = null;
          cacheHit = false;
        } else {
          // 二次校验：尝试真正解码，确保 base64 可还原成 Buffer
          try {
            const buf = Buffer.from(base64!, 'base64');
            if (buf.length < 1024) {
              throw new Error(`pptx buffer too small: ${buf.length}`);
            }
            // PPTX 是 ZIP，magic number 是 PK\x03\x04
            if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
              throw new Error('not a valid ZIP/PPTX (missing PK signature)');
            }
          } catch (err) {
            logger.warn('pptx cache invalid, regenerating', { date: input.date, error: (err as Error).message });
            base64 = null;
            cacheHit = false;
          }
        }
      }

      if (!cacheHit) {
        const outcome = await buildBriefingPptxAuto(content, row.theme);
        base64 = outcome.buffer.toString('base64');
        // R-6 修复：缓存写回带重试（最多 3 次，间隔 500ms），避免高频访问场景下首次写入失败后缓存永远缺失
        const writeCache = async (attempt = 1): Promise<void> => {
          try {
            await prisma.dailyReport.update({
              where: { date: input.date },
              data: { pptxBase64: base64, pptxBuiltAt: new Date() },
            });
          } catch (err) {
            if (attempt < 3) {
              logger.warn('pptx cache write failed, retrying', { date: input.date, attempt, error: (err as Error).message });
              await new Promise(r => setTimeout(r, 500));
              return writeCache(attempt + 1);
            }
            logger.error('pptx cache write failed permanently', { date: input.date, error: (err as Error).message });
          }
        };
        void writeCache(); // fire-and-forget，不阻塞下载响应
        logger.info('daily report pptx built', {
          date: input.date,
          theme: row.theme,
          engine: outcome.producedBy,
          mode: outcome.mode,
          pages: outcome.engineReport?.pageCount ?? null,
          fallback: outcome.fallbackReason,
          duration: Date.now() - t0,
        });
      } else {
        logger.debug('daily report pptx cache hit', { date: input.date, theme: row.theme });
      }

      return {
        fileName: briefingFileName(row.date),
        base64,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        cacheHit,
        isDraft: row.degraded && content.cover.subtitle.includes('草稿'),
      };
    }),
});
