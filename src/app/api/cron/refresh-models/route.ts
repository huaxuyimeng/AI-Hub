import { NextResponse } from 'next/server';
import { ModelScraper } from '@/lib/rankings/scraper';
import { discoverAllProviders } from '@/lib/ai/model-discovery';
import { logger } from '@/lib/observability/logger';
import { alert } from '@/lib/observability/alert';
import { isLockSkipped, withLock } from '@/lib/observability/distributed-lock';
import { cleanupOldModelSnapshots } from '@/lib/cleanup-db';

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

  const startTime = Date.now();
  const cronName = 'refresh-models';

  const locked = await withLock('cron:refresh-models', 600, async () => {
    try {
      // Step 1: 先发现新模型（从各 Provider 官方 API 拉取最新列表）
      logger.info('cron: step 1 — model discovery');
      const discoverResults = await discoverAllProviders();
      const newModelCount = discoverResults.reduce((sum, r) => sum + r.models.length, 0);
      logger.info('cron: step 1 done', { newModelCount });

      // Step 2: 刷新已知模型的价格/能力分
      const scraper = new ModelScraper();
      const discovered = await scraper.discoverFromNews();
      const result = await scraper.refreshAll();
      const duration = Date.now() - startTime;

      logger.info('cron completed', {
        cron: cronName,
        duration,
        discovered: discovered.length,
        updated: result.succeeded,
        failed: result.failed,
        total: result.total,
      });

      if (result.failed > 0) {
        await alert({
          level: 'warn',
          title: `模型刷新失败 ${result.failed}/${result.total}`,
          message: '详见 cron JSON 日志',
          ctx: { failed: result.failed, total: result.total },
        });
      }

      // H-8/H-9 修复：清理 90 天前旧快照（保留最近 3 条 per model）
      const snapshotCleanup = await cleanupOldModelSnapshots();
      logger.info('snapshot cleanup done', { cleaned: snapshotCleanup.cleaned, skipped: snapshotCleanup.skipped });

      return NextResponse.json({
        ok: true,
        duration,
        discovery: { newModelCount, providers: discoverResults.length },
        discovered: discovered.length,
        updated: result.succeeded,
        failed: result.failed,
        total: result.total,
        cleanup: snapshotCleanup,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('cron failed', {
        cron: cronName,
        duration: Date.now() - startTime,
        error: (err as Error).message,
      });
      await alert({
        level: 'critical',
        title: '模型刷新 cron 异常退出',
        message: (err as Error).message,
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'MODEL_REFRESH_FAILED' },
        { status: 500 },
      );
    }
  });

  if (isLockSkipped(locked)) {
    return NextResponse.json(locked, { status: 409 });
  }
  return locked;
}

export async function POST(req: Request) {
  return GET(req);
}
