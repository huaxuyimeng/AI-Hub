/**
 * 新闻抓取 Cron（源级调度版）
 *
 * 策略：
 *   - Vercel cron 每15min触发一次
 *   - 每次只抓 nextFetchAt <= now() 的源（各源独立计时）
 *   - 无锁冲突时：轻量快速；有锁冲突时：skip（另一个实例在跑）
 *
 * 鉴权 → 锁 → fetchDueSources() → 响应
 */

import { NextResponse } from 'next/server';
import { prismaBase as prisma } from '@/lib/db';
import { fetchDueSources, initSourceSchedule } from '@/lib/news/scheduler';
import { runBilibiliFetch } from '@/lib/bilibili/scraper';
import { logger } from '@/lib/observability/logger';
import { alert } from '@/lib/observability/alert';
import { isLockSkipped, withLock } from '@/lib/observability/distributed-lock';
import { cleanupOldNews } from '@/lib/cleanup-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const cronName = 'fetch-news';

  const locked = await withLock('cron:fetch-news', 600, async () => {
    try {
      // 确保所有源都有 nextFetchAt（新增字段后迁移）
      await initSourceSchedule(180); // 默认3小时

      // 拉取所有到期的源（只看 nextFetchAt <= now）
      const news = await fetchDueSources();

      // B 站抓取（沿用现有逻辑，不参与源级调度）
      const bili = await runBilibiliFetch({
        maxVideosPerUP: 3,
        failOnAllFail: false,
      });

      const duration = Date.now() - startTime;
      const unhealthy = await prisma.newsSource.findMany({
        where: { unhealthy: true, enabled: true },
        select: { name: true, failStreak: true, emptyStreak: true, lastError: true },
      });

      logger.info('cron completed', {
        cron: cronName,
        duration,
        news: {
          dueSources: news.due.filter(s => !s.skipped).length,
          skippedSources: news.skipped.length,
          totalItems: news.totalItems,
          warnings: news.warnings.length,
          errors: news.errors.length,
        },
        bilibili: {
          ok: bili.ok,
          upCount: bili.upCount,
          totalVideos: bili.totalVideos,
          totalNews: bili.totalNews,
          failedUPs: bili.failedUPs.length,
        },
        unhealthyCount: unhealthy.length,
      });

      if (unhealthy.length > 0) {
        await alert({
          level: 'warn',
          title: `${unhealthy.length} 个新闻源 unhealthy`,
          message: unhealthy.map((s) => s.name).join(', '),
          ctx: { names: unhealthy.map((s) => s.name).join(',') },
        });
      }

      if (!bili.ok && bili.upCount > 0) {
        await alert({
          level: 'warn',
          title: 'B 站爬虫全部 UP 主失败',
          message: bili.errors.slice(0, 3).join('；') || 'unknown',
          ctx: { failedUPs: bili.failedUPs.join(','), upCount: bili.upCount },
        });
      }

      // 清理45天前旧新闻（软删除）
      const cleanup = await cleanupOldNews();

      return NextResponse.json({
        ok: true,
        duration,
        news: {
          dueSources: news.due.filter(s => !s.skipped).length,
          skippedSources: news.skipped,
          totalItems: news.totalItems,
          warnings: news.warnings,
          errors: news.errors,
        },
        bilibili: {
          ok: bili.ok,
          upCount: bili.upCount,
          totalVideos: bili.totalVideos,
          totalNews: bili.totalNews,
          failedUPs: bili.failedUPs,
          insertedNewsItems: bili.insertedNewsItems,
          updatedNewsItems: bili.updatedNewsItems,
          errors: bili.errors,
          duration: bili.duration,
        },
        cleanup: { cleaned: cleanup.cleaned, skipped: cleanup.skipped, errors: cleanup.errors },
        unhealthy,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('cron failed', {
        cron: cronName,
        duration: Date.now() - startTime,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      await alert({
        level: 'critical',
        title: '新闻抓取 cron 异常退出',
        message: (err as Error).message,
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'NEWS_FETCH_FAILED' },
        { status: 500 },
      );
    }
  });

  if (isLockSkipped(locked)) {
    return NextResponse.json({ skipped: true, message: 'another instance is running' }, { status: 409 });
  }
  return locked;
}

export async function POST(req: Request) {
  return GET(req);
}
