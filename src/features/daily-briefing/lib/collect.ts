/**
 * AI 早报 — 当日数据采集
 * 路径：src/lib/daily-report/collect.ts
 *
 * 采集窗口：北京时间"今天"（由 windowHour 分割晨报/晚报）；不足 3 条时自动放宽到近 24 小时。
 * 统计快照（分类分布 / 厂家榜 / 近 7 天）与新闻页 analytics 口径一致。
 */

import { prismaBase as prisma } from '@/lib/db';
import { beijingDayStart } from '@/lib/news/service';
import { cleanText } from '@/lib/news/parsers/types';
import { LIMITS, truncate } from './types';

export interface CollectedItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  category: string | null;
  companyTags: string[];
  publishedAt: Date | null;
  /** v5：og:image / RSS enclosure（详情页杂志风插图） */
  coverUrl: string | null;
}

export interface CollectedSnapshot {
  todayTotal: number;
  sourceCount: number;
  categoryDist: Array<{ name: string; count: number }>;
  companyTop: Array<{ name: string; count: number }>;
  weekSeries: Array<{ date: string; count: number }>;
}

export interface CollectResult {
  /** 北京日期字符串，如 2026-08-31 */
  date: string;
  items: CollectedItem[];
  /** 是否放宽到了 24 小时窗口 */
  widened: boolean;
  snapshot: CollectedSnapshot;
}

/** 北京日期字符串（如 2026-08-31） */
export function beijingDateString(d: Date = new Date()): string {
  const wall = new Date(d.getTime() + 8 * 3600 * 1000);
  return wall.toISOString().slice(0, 10);
}

async function fetchItemsSince(since: Date): Promise<CollectedItem[]> {
  // Prisma 6 + SQLite 兼容性：用顶层 orderBy + 应用层处理 null 排序
  const rows = await prisma.newsItem.findMany({
    where: { deletedAt: null, publishedAt: { gte: since } },
    include: { source: true },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: 80,
  });

  return rows.map(r => ({
    id: r.id,
    title: cleanText(r.title),
    summary: cleanText(truncate(r.summary ?? '', LIMITS.summary)),
    url: r.url,
    source: r.source.name,
    category: r.category,
    companyTags: r.companyTags ? r.companyTags.split(',').map(t => t.trim()).filter(Boolean) : [],
    publishedAt: r.publishedAt,
    coverUrl: r.coverUrl ?? null,
  }));
}

export async function collectDailyNews(now: Date = new Date(), windowHour = 8): Promise<CollectResult> {
  const date = beijingDateString(now);
  // 根据 windowHour 计算采集窗口起点
  // 北京时间 now < windowHour：晨报窗口 = 昨天 windowHour ~ 今天 windowHour
  // 北京时间 now >= windowHour：晚报窗口 = 今天 windowHour ~ 明天 windowHour
  const nowBeijing = new Date(now.getTime() + 8 * 3600 * 1000);
  const dayStart = beijingDayStart(now);
  const dayStartHour = nowBeijing.getHours();
  const since = dayStartHour < windowHour
    ? new Date(dayStart.getTime() - 24 * 3600 * 1000) // 晨报：昨天 windowHour
    : dayStart; // 晚报：今天 windowHour

  let items = await fetchItemsSince(since);
  let widened = false;

  // 当日新闻不足 3 条：放宽到近 24 小时兜底
  if (items.length < 3) {
    const past24h = new Date(now.getTime() - 24 * 3600 * 1000);
    items = await fetchItemsSince(past24h);
    widened = true;
  }

  // ===== 统计快照（近 30 天口径与 analytics 一致，但这里只取需要的部分） =====
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const [todayTotal, sourceCount, byCategory, companyRows, weekRows] = await Promise.all([
    prisma.newsItem.count({ where: { deletedAt: null, publishedAt: { gte: dayStart } } }),
    prisma.newsSource.count({ where: { enabled: true } }),
    prisma.newsItem.groupBy({
      by: ['category'],
      where: { deletedAt: null, publishedAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
    }),
    // 厂家提及：按逗号拆分聚合（与 analytics 相同逻辑）
    prisma.$queryRaw<Array<{ companyTags: string; count: bigint | number }>>`
      SELECT companyTags, COUNT(*) as count
      FROM NewsItem
      WHERE deletedAt IS NULL
        AND companyTags != ''
        AND publishedAt >= ${thirtyDaysAgo}
      GROUP BY companyTags
      ORDER BY count DESC
    `,
    // 近 7 天新闻量（北京时间归日）
    prisma.$queryRaw<Array<{ date: string; count: bigint | number }>>`
      SELECT DATE(publishedAt / 1000, 'unixepoch', '+8 hours') as date, COUNT(*) as count
      FROM NewsItem
      WHERE deletedAt IS NULL AND publishedAt >= ${sevenDaysAgo}
      GROUP BY DATE(publishedAt / 1000, 'unixepoch', '+8 hours')
      ORDER BY date ASC
    `,
  ]);

  const categoryDist = byCategory
    .map(r => ({ name: r.category ?? '未分类', count: r._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const companyCounts: Record<string, number> = {};
  for (const row of companyRows) {
    const tags = new Set(row.companyTags.split(',').map(t => t.trim()).filter(Boolean));
    for (const tag of tags) {
      companyCounts[tag] = (companyCounts[tag] ?? 0) + Number(row.count);
    }
  }
  const companyTop = Object.entries(companyCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 补齐 7 天里没有新闻的日期为 0，保证柱状图连续
  const weekSeries: Array<{ date: string; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const ds = beijingDateString(d);
    const hit = weekRows.find(r => String(r.date) === ds);
    weekSeries.push({ date: ds, count: hit ? Number(hit.count) : 0 });
  }

  return {
    date,
    items,
    widened,
    snapshot: { todayTotal, sourceCount, categoryDist, companyTop, weekSeries },
  };
}
