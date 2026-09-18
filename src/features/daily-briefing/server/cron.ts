/**
 * AI 早报生成 cron 业务逻辑
 *
 * 调用链：
 *   /api/cron/generate-daily-report (Next.js 路由)
 *     └─ runDailyReportCron()  (本文件)
 *          ├─ distributed-lock 保证不并发
 *          ├─ generateDailyReport()  (lib/generate.ts，内部含重试 + 降级)
 *          └─ 失败再重试 1 次（覆盖瞬时 LLM/网络抖动）
 *
 * 鉴权由路由层负责（CRON_SECRET），本文件不重复检查。
 */

import { generateDailyReport } from '@/features/daily-briefing/lib/generate';
import { logger } from '@/lib/observability/logger';
import { alert } from '@/lib/observability/alert';
import { isLockSkipped, withLock } from '@/lib/observability/distributed-lock';

const LOCK_KEY = 'cron:daily-report';
const LOCK_TTL_SEC = 600; // 10 分钟（生成可能持续 1~2 分钟）

export interface CronResult {
  ok: boolean;
  date: string;
  status: string;
  degraded: boolean;
  duration: number;
  message?: string;
}

/**
 * 执行一次定时任务：含分布式锁、失败自动重试 1 次。
 * 返回结构化的 CronResult，便于路由层直接序列化响应。
 */
export async function runDailyReportCron(): Promise<CronResult> {
  const startTime = Date.now();

  const locked = await withLock(LOCK_KEY, LOCK_TTL_SEC, async (): Promise<CronResult> => {
    try {
      let result = await generateDailyReport();
      if (result.status === 'failed') {
        logger.warn('daily report cron first attempt failed, retrying', { date: result.date });
        result = await generateDailyReport();
      }
      // 两次都失败才告警（降级不算失败）
      if (result.status !== 'ready') {
        await alert({
          level: 'warn',
          title: 'AI 早报 Cron 重试后仍失败',
          message: `date=${result.date}，请检查日志`,
          ctx: { date: result.date, degraded: result.degraded, duration: Date.now() - startTime },
        });
      }
      logger.info('daily report cron completed', {
        duration: Date.now() - startTime,
        date: result.date,
        status: result.status,
        degraded: result.degraded,
      });
      return {
        ok: result.status === 'ready',
        date: result.date,
        status: result.status,
        degraded: result.degraded,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error('daily report cron failed', {
        duration: Date.now() - startTime,
        error: msg,
      });
      // R-7 修复：失败后发 Slack alert（与 generate-daily-report/route.ts 行为对齐）
      await alert({
        level: 'critical',
        title: 'AI 早报 Cron 失败',
        message: `生成失败，请检查日志。错误：${msg}`,
        ctx: { duration: Date.now() - startTime },
      });
      return {
        ok: false,
        date: '',
        status: 'failed',
        degraded: false,
        duration: Date.now() - startTime,
        message: msg,
      };
    }
  });

  if (isLockSkipped(locked)) {
    return {
      ok: false,
      date: '',
      status: 'locked',
      degraded: false,
      duration: Date.now() - startTime,
      message: 'Another instance is running',
    };
  }

  return locked;
}
