/**
 * 模型发现 Cron — 定期从各 Provider 官方 API 获取最新模型列表
 *
 * 数据源：ModelDiscoveryService（/v1/models 端点）
 * 结果：写入 Model 表（upsert）
 *
 * 调用方式：
 *   GET/POST /api/cron/discover-models?key=<CRON_SECRET>
 *
 * 推荐频率：每天 1 次（模型更新不频繁）
 */

import { NextResponse } from 'next/server';
import { discoverAllProviders } from '@/lib/ai/model-discovery';
import { logger } from '@/lib/observability/logger';
import { alert } from '@/lib/observability/alert';
import { isLockSkipped, withLock } from '@/lib/observability/distributed-lock';

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
  const cronName = 'discover-models';

  const locked = await withLock(`cron:${cronName}`, 600, async () => {
    try {
      const results = await discoverAllProviders();
      const duration = Date.now() - startTime;

      const succeeded = results.filter((r) => r.succeeded).length;
      const failed = results.filter((r) => !r.succeeded).length;
      const totalModels = results.reduce((sum, r) => sum + r.models.length, 0);

      logger.info('cron completed', {
        cron: cronName,
        duration,
        providers: { total: results.length, succeeded, failed },
        models: totalModels,
      });

      if (failed > 0) {
        await alert({
          level: 'warn',
          title: `模型发现：${failed}/${results.length} 个 Provider 失败`,
          message: results.filter((r) => !r.succeeded).map((r) => `${r.provider}: ${r.error}`).join('; '),
        });
      }

      return NextResponse.json({
        ok: true,
        duration,
        providers: { total: results.length, succeeded, failed },
        models: totalModels,
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
        title: '模型发现 cron 异常退出',
        message: (err as Error).message,
      });
      return NextResponse.json(
        { error: 'Internal error', code: 'MODEL_DISCOVERY_FAILED' },
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
