/**
 * B站抓取Cron (D-1)
 *
 * 流程（与fetch-news一致）：
 *   auth -> lock -> scrapeBilibili -> upsertBilibiliWithProtection
 *   -> mergeBiliNewsIntoNewsItem -> alert
 *
 * 调度：每6小时一次 (vercel.json: cron 0-star-slash-6)
 * maxDuration: 300s
 */

import { NextResponse } from 'next/server';
import { prismaBase as prisma } from '@/lib/db';
import { runBilibiliFetch } from '@/lib/bilibili/scraper';
import { logger } from '@/lib/observability/logger';
import { alert } from '@/lib/observability/alert';
import { isLockSkipped, withLock } from '@/lib/observability/distributed-lock';
import { cleanupOldBilibiliCache } from '@/lib/cleanup-db';
import { cleanupOrphanFiles } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  // C-4 修复：expected 未配置时短路到 401（fail-closed），避免忘记配置 CRON_SECRET 时公网裸奔
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const cronName = 'fetch-bilibili';

  const result = await withLock(`cron:${cronName}`, 300, async () => {
    try {
      // 完整 B 站抓取链路：scrape → BilibiliCache 持久化 → NewsItem 合并
      const bili = await runBilibiliFetch({ maxVideosPerUP: 5 });

      const duration = Date.now() - start;
      logger.info('cron completed', {
        cron: cronName,
        duration,
        upCount: bili.upCount,
        totalVideos: bili.totalVideos,
        totalNews: bili.totalNews,
        failedUPs: bili.failedUPs,
        insertedNewsItems: bili.insertedNewsItems,
        updatedNewsItems: bili.updatedNewsItems,
      });

      // health alert
      if (bili.failedUPs.length > bili.upCount / 2) {
        await alert({
          level: 'warn',
          title: 'Bilibili fetch: most uploaders failed',
          message: bili.failedUPs.join(', '),
        });
      }

      // 清理 45 天前 B 站缓存 + R2 孤儿文件
      const [biliCleanup, r2Cleanup] = await Promise.allSettled([
        cleanupOldBilibiliCache(),
        cleanupOrphanFiles(),
      ]);
      const biliCleaned = biliCleanup.status === 'fulfilled' ? biliCleanup.value : null;
      const r2Cleaned = r2Cleanup.status === 'fulfilled' ? r2Cleanup.value : null;
      logger.info('post-fetch cleanup done', {
        biliCache: biliCleaned,
        orphanR2: r2Cleaned,
      });

      return NextResponse.json({
        ok: bili.ok,
        duration,
        upCount: bili.upCount,
        totalVideos: bili.totalVideos,
        totalNews: bili.totalNews,
        failedUPs: bili.failedUPs,
        errors: bili.errors,
        sourceHealth: bili.sourceHealth,
        newsItems: {
          inserted: bili.insertedNewsItems,
          updated: bili.updatedNewsItems,
          attempted: bili.insertedNewsItems + bili.updatedNewsItems,
        },
        cleanup: {
          biliCache: biliCleaned ?? { cleaned: -1, skipped: -1, errors: -1 },
          orphanR2: r2Cleaned ?? { deleted: -1, errors: -1, skipped: true },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('cron failed', {
        cron: cronName,
        duration: Date.now() - start,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      await alert({
        level: 'critical',
        title: 'Bilibili fetch cron exception',
        message: (err as Error).message,
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'BILI_FETCH_FAILED' },
        { status: 500 },
      );
    }
  });

  if (isLockSkipped(result)) {
    return NextResponse.json(result, { status: 409 });
  }
  return result;
}

export async function POST(req: Request) {
  return GET(req);
}
