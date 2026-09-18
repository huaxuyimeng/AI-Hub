/**
 * NewsSource 级别调度：只抓"该抓"的源
 *
 * 数据流：
 *   Vercel cron（每15min）→ fetchDueSources() → 各源 nextFetchAt 更新
 *   手动刷新（设置页）→ fetchSources() → 不更新 nextFetchAt（保持计划不变）
 *
 * nextFetchAt 计算：
 *   源有 fetchIntervalMinutes 覆盖 → now + 覆盖值
 *   否则 → now + 全局 newsRefreshInterval（分钟）
 */

import { prismaBase as prisma } from '@/lib/db';
import { Semaphore } from '@/lib/utils/concurrency';
import { NEWS_SOURCES } from './sources';
import { fetchFromSource, dedupeAndCross, saveItems, classifyCategory } from './service';
import { applyHealth, getUnhealthySources } from './health';
import type { FetchedItem } from './parsers/types';
import type { NewsSourceConfig } from './sources';
import { logger } from '@/lib/observability/logger';

export interface SourceFetchResult {
  name: string;
  count: number;
  success: boolean;
  fragile?: boolean;
  skipped: boolean;  // true = 未到计划时间
}

export interface FetchDueSourcesResult {
  due: SourceFetchResult[];
  skipped: string[];
  totalItems: number;
  warnings: string[];
  errors: string[];
}

/**
 * 计算某源的"下次抓取时间"。
 * 全局间隔 + 源级覆盖，优先级：覆盖 > 全局
 */
function calcNextFetchAt(
  globalIntervalMinutes: number,
  sourceOverrideMinutes: number | null,
): Date {
  const interval = sourceOverrideMinutes ?? globalIntervalMinutes;
  return new Date(Date.now() + interval * 60_000);
}

/**
 * 拉取所有"到期"（nextFetchAt <= now）的源。
 * 由 cron 每15min 调用。
 */
export async function fetchDueSources(): Promise<FetchDueSourcesResult> {
  // 取全局默认间隔（所有 UserPreferences 的众数）
  const globalIntervalMinutes = await getGlobalInterval();

  // 查所有启用的源
  const allSources = await prisma.newsSource.findMany({
    where: { enabled: true },
    orderBy: { priority: 'desc' },
  });

  // 分类：到期 vs 跳过
  const now = new Date();
  const due: typeof allSources = [];
  const skipped: string[] = [];

  for (const s of allSources) {
    if (!s.nextFetchAt || s.nextFetchAt <= now) {
      due.push(s);
    } else {
      skipped.push(s.name);
    }
  }

  if (due.length === 0) {
    return { due: [], skipped, totalItems: 0, warnings: [], errors: [] };
  }

  return fetchSources(due, globalIntervalMinutes);
}

/**
 * 拉取指定源列表（通用底层函数）。
 * 更新 nextFetchAt（基于当前全局间隔）。
 *
 * @param sources DB 中的源记录
 * @param globalIntervalMinutes 全局刷新间隔（分钟），用于计算 nextFetchAt
 * @param touchNextFetchAt 是否更新 nextFetchAt；手动刷新时传 false（保持原计划）
 */
export async function fetchSources(
  sources: Array<{ id: string; name: string; url: string; type: string; priority: number; fetchIntervalMinutes: number | null }>,
  globalIntervalMinutes: number,
  touchNextFetchAt = true,
): Promise<FetchDueSourcesResult> {
  const fragileByName = new Map(
    NEWS_SOURCES.map((s) => [s.name, !!s.fragile])
  );

  const toConfig = (s: typeof sources[number]): NewsSourceConfig => ({
    name: s.name,
    url: s.url,
    type: s.type as 'rss' | 'api' | 'html',
    priority: s.priority,
    fragile: fragileByName.get(s.name) ?? s.type === 'html',
  });

  const configs = sources.map(toConfig);
  const allItems: FetchedItem[] = [];
  const results: SourceFetchResult[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const sem = new Semaphore(5);
  const settled = await Promise.allSettled(
    configs.map(async (cfg) => {
      await sem.acquire();
      try {
        const t0 = Date.now();
        const outcome = await fetchFromSource(cfg);
        const ms = Date.now() - t0;
        const ok = !outcome.error;
        await applyHealth(cfg.name, {
          ok,
          count: outcome.items.length,
          ms,
          error: outcome.error ?? null,
        });

        // 更新 nextFetchAt（下次计划时间）
        if (touchNextFetchAt) {
          const dbSource = sources.find((s) => s.name === cfg.name);
          if (dbSource) {
            const nextAt = calcNextFetchAt(globalIntervalMinutes, dbSource.fetchIntervalMinutes);
            await prisma.newsSource.update({
              where: { id: dbSource.id },
              data: { nextFetchAt: nextAt },
            });
          }
        }

        return { cfg, outcome, ok };
      } finally {
        sem.release();
      }
    })
  );

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const cfg = configs[i];
    if (r.status !== 'fulfilled') {
      const msg = `${cfg.name}: ${String(r.reason)}`;
      if (cfg.fragile) warnings.push(msg);
      else errors.push(msg);
      results.push({ name: cfg.name, count: 0, success: false, fragile: cfg.fragile, skipped: false });
      logger.warn('source fetch rejected', { source: cfg.name, error: String(r.reason) });
      continue;
    }

    const { outcome, ok } = r.value;
    if (outcome.error) {
      const msg = `${cfg.name}: ${outcome.error}`;
      if (cfg.fragile) warnings.push(msg);
      else errors.push(msg);
    } else if (outcome.items.length === 0) {
      warnings.push(`${cfg.name}: empty result`);
    }

    allItems.push(...outcome.items);
    results.push({
      name: cfg.name,
      count: outcome.items.length,
      success: ok,
      fragile: cfg.fragile,
      skipped: false,
    });
  }

  const deduped = dedupeAndCross(allItems);
  const totalSaved = await saveItems(deduped);

  return {
    due: results,
    skipped: [],
    totalItems: totalSaved,
    warnings,
    errors,
  };
}

/**
 * 初始化新源的 nextFetchAt（在源被创建/启用时调用）。
 * 对已存在 nextFetchAt 的源不做修改。
 */
export async function initSourceSchedule(
  globalIntervalMinutes: number,
): Promise<void> {
  const now = new Date();
  await prisma.newsSource.updateMany({
    where: {
      enabled: true,
      nextFetchAt: null,
    },
    data: {
      nextFetchAt: new Date(now.getTime() + globalIntervalMinutes * 60_000),
    },
  });
}

/**
 * 全局刷新间隔：取所有用户 newsRefreshInterval 的众数（默认3小时）。
 */
async function getGlobalInterval(): Promise<number> {
  try {
    const rows = await prisma.userPreferences.findMany({
      select: { newsRefreshInterval: true },
      where: { newsRefreshInterval: { gt: 0 } },
    });
    if (rows.length === 0) return 3 * 60; // 默认3小时

    // 众数
    const freq = new Map<number, number>();
    for (const r of rows) {
      freq.set(r.newsRefreshInterval, (freq.get(r.newsRefreshInterval) ?? 0) + 1);
    }
    let best = 3 * 60;
    let bestCount = 0;
    for (const [v, c] of freq) {
      if (c > bestCount) { bestCount = c; best = v; }
    }
    return best;
  } catch {
    return 3 * 60;
  }
}
