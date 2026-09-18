/**
 * B 站数据写入层（含写入保护）
 *
 * 来源：迁移自 ai-news-daily 的 bilibili-news.json
 *
 * 写入保护策略：
 *   - B 站风控频繁（412/429），单 UP 主失败不应覆盖已有缓存
 *   - 逐 UP 主合并：本次 0 条 → 沿用历史；本次 ≥1 条 → 覆盖
 *   - 返回 restored 列表告诉调用方哪些 UP 主是历史缓存
 *
 * 参考：docs/06-B站与多模态-增量设计.md §3.5
 */

import type { PrismaClient } from '@prisma/client';
import type { BiliData, BiliSourceHealth, BiliUP } from './scraper';

export interface StorageResult {
  id: string;
  totalNews: number;
  totalVideos: number;
  /** 本次回退到历史缓存的 UP 主名 */
  restored: string[];
  /** 本次失败的 UP 主名 */
  failed: string[];
}

/**
 * 持久化 B 站数据，含写入保护
 */
export async function upsertBilibiliWithProtection(
  prisma: PrismaClient,
  newData: BiliData,
): Promise<StorageResult> {
  // 1. 取最新一条作为对比基线
  const old = await prisma.bilibiliCache.findFirst({
    // B-20 修复：过滤软删的缓存（已被清理的不应作为基线）
    where: { deletedAt: null },
    orderBy: { fetchedAt: 'desc' },
  });

  // 2. 首次抓取 → 直接写
  if (!old) {
    const created = await prisma.bilibiliCache.create({
      data: {
        fetchedAt: new Date(newData.fetchedAt * 1000),
        ups: newData.ups as unknown as object,
        sourceHealth: newData.sourceHealth as unknown as object,
        note: '首次抓取',
      },
    });
    return {
      id: created.id,
      totalNews: countNews(newData.ups),
      totalVideos: countVideos(newData.ups),
      restored: [],
      failed: Object.entries(newData.sourceHealth)
        .filter(([, h]) => !h.ok)
        .map(([uid]) => nameByUid(newData.ups, uid)),
    };
  }

  // 3. 逐 UP 主合并
  const oldUpsByUid = new Map<string, BiliUP>(
    ((old.ups as unknown as BiliUP[]) ?? []).map((u) => [u.uid, u]),
  );
  const restored: string[] = [];
  const failed: string[] = [];

  for (const u of newData.ups) {
    const newsCount = u.videos.reduce((s, v) => s + (v.news?.length ?? 0), 0);
    const health = newData.sourceHealth[u.uid];
    if (newsCount > 0 && health?.ok !== false) {
      // 本次成功 → 覆盖
      oldUpsByUid.set(u.uid, u);
    } else if (oldUpsByUid.has(u.uid)) {
      // 本次失败 → 沿用旧
      restored.push(u.name);
      // 但也要更新 fetchedAt/health 字段以反映本次失败
      // 旧数据自然保留，oldUpsByUid 里已有旧对象，无需再 set
    } else {
      failed.push(u.name);
    }
  }

  const note =
    restored.length > 0
      ? `${restored.join(', ')} 沿用历史缓存（本次受 B 站风控影响，处理于 ${new Date()
          .toISOString()
          .slice(0, 16)}）`
      : undefined;

  const mergedUps = [...oldUpsByUid.values()];
  const merged: BiliData = {
    fetchedAt: newData.fetchedAt,
    ups: mergedUps,
    sourceHealth: newData.sourceHealth,
    note,
  };

  const created = await prisma.bilibiliCache.create({
    data: {
      fetchedAt: new Date(merged.fetchedAt * 1000),
      ups: merged.ups as unknown as object,
      sourceHealth: merged.sourceHealth as unknown as object,
      note: merged.note,
    },
  });

  return {
    id: created.id,
    totalNews: countNews(mergedUps),
    totalVideos: countVideos(mergedUps),
    restored,
    failed,
  };
}

function countNews(ups: BiliUP[]): number {
  return ups.reduce((sum, u) => sum + u.videos.reduce((s, v) => s + (v.news?.length ?? 0), 0), 0);
}

function countVideos(ups: BiliUP[]): number {
  return ups.reduce((sum, u) => sum + u.videos.length, 0);
}

function nameByUid(ups: BiliUP[], uid: string): string {
  return ups.find((u) => u.uid === uid)?.name ?? uid;
}

/**
 * 取出某 UP 主在某次抓取里的视频
 */
export function getVideosByUP(cache: { ups: unknown }, uid: string): BiliUP | null {
  const ups = (cache.ups as BiliUP[]) ?? [];
  return ups.find((u) => u.uid === uid) ?? null;
}

/**
 * 取出全部 UP 主汇总
 */
export function getUploaderSummaries(cache: {
  ups: unknown;
  fetchedAt: Date;
}): Array<{
  uid: string;
  name: string;
  tag: string;
  priority: number;
  videoCount: number;
  newsCount: number;
}> {
  const ups = (cache.ups as BiliUP[]) ?? [];
  return ups.map((u) => ({
    uid: u.uid,
    name: u.name,
    tag: u.tag,
    priority: u.priority ?? 5,
    videoCount: u.videos?.length ?? 0,
    newsCount: u.videos?.reduce((s, v) => s + (v.news?.length ?? 0), 0) ?? 0,
  }));
}

/** 类型断言：BiliSourceHealth */
export function asSourceHealth(value: unknown): Record<string, BiliSourceHealth> {
  return (value as Record<string, BiliSourceHealth>) ?? {};
}
