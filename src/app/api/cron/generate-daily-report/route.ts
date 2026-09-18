/**
 * AI 早报生成 Cron 路由
 *
 * 鉴权：Bearer CRON_SECRET（Vercel Cron 配置同步注入）
 * 入口：runDailyReportCron()  ──  业务逻辑详见 src/features/daily-briefing/server/cron.ts
 * 调度：北京时间每天 7:00（UTC 23:00）
 */

import { NextResponse } from 'next/server';
import { runDailyReportCron } from '@/features/daily-briefing/server/cron';
import { cleanupOrphanFiles } from '@/lib/cleanup';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

async function handle(req: Request) {
  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;

  // C-4 修复：expected 未配置时短路到 401（fail-closed），避免忘记配置 CRON_SECRET 时公网裸奔
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runDailyReportCron();

  // 日报生成成功后：清理 R2 孤儿文件（日报相关旧文件）
  if (result.ok) {
    const r2 = await cleanupOrphanFiles().catch((e) => {
      logger.warn('daily-report post-cleanup failed', { error: (e as Error).message });
      return { deleted: -1, errors: 1, skipped: true } as const;
    });
    logger.info('daily-report post-cleanup done', { r2 });
    return NextResponse.json({
      ...result,
      cleanup: r2,
      timestamp: new Date().toISOString(),
    });
  }

  if (result.status === 'locked') {
    return NextResponse.json({ error: result.message, code: 'LOCKED' }, { status: 409 });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Internal error', code: 'DAILY_REPORT_FAILED', ...result },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...result,
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
