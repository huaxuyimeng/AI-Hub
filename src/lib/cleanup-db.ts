/**
 * 数据库清理模块：cron 任务完成后自动调用，释放容量
 *
 * 策略：
 * - NewsItem：软删除（deletedAt）而非硬删除，保留历史完整性
 * - BilibiliCache：直接 delete（不受日报引用约束）
 * - R2 孤儿文件：见 src/lib/cleanup.ts → cleanupOrphanFiles()
 */

import { prismaBase as prisma } from './db';

const NEWS_RETENTION_DAYS = 45;
const NEWS_PROTECT_RECENT_DAYS = 7;
const BILIBILI_RETENTION_DAYS = 45;

// ========== 新闻清理 ==========

export interface CleanupResult {
  cleaned: number;
  skipped: number;
  errors: number;
}

/**
 * 清理超过 NEWS_RETENTION_DAYS 的旧新闻
 *
 * 跳过条件（安全保护）：
 *   1. 最近 PROTECT_RECENT_DAYS 天内发布的（保留新鲜内容）
 *   2. 仍被最近 1 份 DailyReport 引用的（日报完整性）
 *
 * 采用软删除（deletedAt），不硬删除数据。
 */
export async function cleanupOldNews(): Promise<CleanupResult> {
  const now = Date.now();
  const cutoff = new Date(now - NEWS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const recentCutoff = new Date(now - NEWS_PROTECT_RECENT_DAYS * 24 * 60 * 60 * 1000);

  // 保护：最近 N 天内发布的（始终保留）
  const recentItems = await prisma.newsItem.findMany({
    where: {
      publishedAt: { gte: recentCutoff },
      deletedAt: null,
    },
    select: { id: true },
    take: 10000,
  });
  const recentIds = new Set(recentItems.map((i) => i.id));

  // 保护：最近 1 份 DailyReport 引用的 newsId
  const recentReports = await prisma.dailyReport.findMany({
    where: {},
    orderBy: { date: 'desc' },
    take: 1,
    select: { content: true },
  });
  const protectedIds = new Set<string>();
  for (const r of recentReports) {
    if (!r.content) continue;
    try {
      const parsed = JSON.parse(r.content);
      const ids: string[] = [];
      if (Array.isArray(parsed.items)) {
        for (const item of parsed.items) {
          if (item.id) ids.push(item.id);
        }
      }
      ids.forEach((id) => protectedIds.add(id));
    } catch (e) {
      // B-18 修复：之前静默吞错，现在加日志便于排查"保护集为空导致误删"问题。
      //          注意：仍然不抛错（保护集是最佳努力，DB 清理逻辑要保持可用）。
      console.warn('[cleanup-db] report.content parse failed (skip):', e);
    }
  }

  // 目标：超过保留期 且 不在近期/受保护集合中
  const toClean = await prisma.newsItem.findMany({
    where: {
      publishedAt: { lt: cutoff },
      deletedAt: null,
    },
    select: { id: true, title: true },
    take: 2000,
  });

  const toDelete = toClean.filter((i) => !recentIds.has(i.id) && !protectedIds.has(i.id));

  if (toDelete.length === 0) {
    return { cleaned: 0, skipped: recentIds.size + protectedIds.size, errors: 0 };
  }

  // 软删除
  const idsToDelete = toDelete.map((i) => i.id);
  await prisma.newsItem.updateMany({
    where: { id: { in: idsToDelete } },
    data: { deletedAt: new Date() },
  });

  return {
    cleaned: idsToDelete.length,
    skipped: recentIds.size + protectedIds.size - idsToDelete.length,
    errors: 0,
  };
}

// ========== B 站缓存清理 ==========

/**
 * 清理超过 BILIBILI_RETENTION_DAYS 的旧 B 站缓存
 *
 * BilibiliCache 改为软删（deletedAt），避免被日报引用的缓存被清理后日报断裂（详见 2026-09-09 全量 Bug 排查）。
 * 保留最近 3 条缓存（最多）确保故障恢复有历史可查。
 */
export async function cleanupOldBilibiliCache(): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - BILIBILI_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // 保留最近 3 条缓存（最多），确保故障恢复有历史可查
  const keep = await prisma.bilibiliCache.findMany({
    // B-20 修复：排除已软删的缓存（避免软删的"复活"）
    where: { deletedAt: null },
    orderBy: { fetchedAt: 'desc' },
    take: 3,
    select: { id: true },
  });
  const keepIds = new Set(keep.map((k) => k.id));

  const toClean = await prisma.bilibiliCache.findMany({
    // B-20 修复：只操作未软删的（已软删的忽略）
    where: {
      fetchedAt: { lt: cutoff },
      deletedAt: null,
      id: keepIds.size > 0 ? { notIn: [...keepIds] } : undefined,
    },
    select: { id: true },
    take: 100,
  });

  if (toClean.length === 0) {
    return { cleaned: 0, skipped: keepIds.size, errors: 0 };
  }

  // B-20 修复：改为软删（deletedAt），而不是 deleteMany（详见 2026-09-09 全量 Bug 排查）。
  //          已被日报引用的缓存删不得，软删保留数据可供历史日报回查。
  await prisma.bilibiliCache.updateMany({
    where: { id: { in: toClean.map((c) => c.id) } },
    data: { deletedAt: new Date() },
  });

  return {
    cleaned: toClean.length,
    skipped: keepIds.size,
    errors: 0,
  };
}

// ========== 模型快照清理 ==========

const SNAPSHOT_RETENTION_DAYS = parseInt(process.env.SNAPSHOT_RETENTION_DAYS ?? '90', 10);

/**
 * 清理超过 SNAPSHOT_RETENTION_DAYS 的旧模型快照
 *
 * ModelSnapshot 是瞬态数据（每次刷新覆盖），无引用约束，直接硬删除。
 * 保留最近 N 天的快照，确保价格趋势图表有足够历史数据。
 */
export async function cleanupOldModelSnapshots(): Promise<CleanupResult> {
  const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // 保护：保留最近 3 个快照 per model（确保图表不断链）
  const recentIds = await prisma.modelSnapshot.groupBy({
    by: ['modelId'],
    _max: { snapshotAt: true },
    _count: { id: true },
    where: { snapshotAt: { gte: cutoff } },
  });

  const protectedIds: string[] = [];
  for (const group of recentIds) {
    const recent = await prisma.modelSnapshot.findMany({
      where: {
        modelId: group.modelId,
        snapshotAt: group._max.snapshotAt ?? undefined,
      },
      select: { id: true },
      take: 3,
      orderBy: { snapshotAt: 'desc' },
    });
    protectedIds.push(...recent.map((r) => r.id));
  }

  const toClean = await prisma.modelSnapshot.findMany({
    where: {
      snapshotAt: { lt: cutoff },
      id: { notIn: protectedIds.length > 0 ? protectedIds : undefined },
    },
    select: { id: true },
    take: 500,
  });

  if (toClean.length === 0) {
    return { cleaned: 0, skipped: protectedIds.length, errors: 0 };
  }

  await prisma.modelSnapshot.deleteMany({
    where: { id: { in: toClean.map((s) => s.id) } },
  });

  return {
    cleaned: toClean.length,
    skipped: protectedIds.length,
    errors: 0,
  };
}
