/**
 * B 站 tRPC 路由（D-1）
 *
 * 功能：
 *   - current：当前缓存的 B 站 UP 主视频（用于首页"今日 B 站"分区）
 *   - history：历史时间线
 *   - refresh：手动触发抓取（鉴权）
 *   - videoNews：单视频关联的 NewsItem
 *   - subtitle：单视频字幕（D-1 §5.3）
 *   - fuseEvent：跨模态事件融合（新闻 + 视频 + 模型）（D-1 §5.2）
 */

import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '@/server/context';
import { prismaBase as prisma } from '@/lib/db';
import { scrapeBilibili } from '@/lib/bilibili/scraper';
import { upsertBilibiliWithProtection, getUploaderSummaries } from '@/lib/bilibili/storage';
import { mergeBiliNewsIntoNewsItem } from '@/lib/bilibili/merge';
import { fetchSubtitleContent, getPlayerSubtitle } from '@/lib/bilibili/api';
import { fuseEvent } from '@/lib/multimodal/fuse';

export const bilibiliRouter = router({
  /**
   * 当前最新缓存
   *
   * 返回：UP 主汇总 + 视频列表（扁平化）
   */
  current: publicProcedure.query(async () => {
    const cache = await prisma.bilibiliCache.findFirst({
      // B-20 修复：加 deletedAt: null 过滤，避免返回已软删的缓存
      where: { deletedAt: null },
      orderBy: { fetchedAt: 'desc' },
    });
    if (!cache) {
      return {
        fetchedAt: null,
        ups: [],
        sourceHealth: {},
        note: '尚未抓取过',
      };
    }
    const ups = (cache.ups as Array<{
      uid: string;
      name: string;
      tag: string;
      priority?: number;
      videos: Array<{
        bvid: string;
        title: string;
        description?: string;
        url: string;
        thumbnailUrl?: string;
        duration?: number;
        publishedAt: number;
        playCount?: number;
        method: string;
        articleUrl?: string;
        news: Array<{ title: string; summary: string; category: string }>;
      }>;
    }>) ?? [];

    return {
      fetchedAt: cache.fetchedAt.toISOString(),
      note: cache.note,
      ups: ups.map((u) => ({
        uid: u.uid,
        name: u.name,
        tag: u.tag,
        priority: u.priority ?? 5,
        videos: (u.videos ?? []).map((v) => ({
          bvid: v.bvid,
          title: v.title,
          url: v.url,
          thumbnailUrl: v.thumbnailUrl ?? '',
          durationSec: v.duration ?? 0,
          publishedAt: v.publishedAt,
          playCount: v.playCount ?? 0,
          method: v.method,
          articleUrl: v.articleUrl ?? null,
          news: v.news ?? [],
        })),
      })),
      sourceHealth: (cache.sourceHealth as Record<string, { ok: boolean; count: number; ms: number; error?: string }>) ?? {},
    };
  }),

  /** UP 主汇总（用于侧栏展示）*/
  summaries: publicProcedure.query(async () => {
    const cache = await prisma.bilibiliCache.findFirst({
      // B-20 修复：加 deletedAt: null 过滤
      where: { deletedAt: null },
      orderBy: { fetchedAt: 'desc' },
    });
    if (!cache) return [];
    return getUploaderSummaries(cache);
  }),

  /** 历史时间线 */
  history: publicProcedure
    .input(z.object({ days: z.number().min(1).max(30).default(7) }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 86400000);
      return prisma.bilibiliCache.findMany({
        // B-20 修复：加 deletedAt: null 过滤
        where: { fetchedAt: { gte: since }, deletedAt: null },
        orderBy: { fetchedAt: 'desc' },
        select: {
          id: true,
          fetchedAt: true,
          note: true,
          sourceHealth: true,
        },
      });
    }),

  /** 手动触发抓取 */
  refresh: protectedProcedure.mutation(async () => {
    // 串行化：scrape → upsert 共享一把锁，防并发覆盖同一 BilibiliCache
    const { withLock } = await import('@/lib/observability/distributed-lock');
    return withLock('bilibili:refresh', 180, async () => {
      const biliData = await scrapeBilibili({ maxVideosPerUP: 5 });
      const storage = await upsertBilibiliWithProtection(prisma, biliData);
      const merge = await mergeBiliNewsIntoNewsItem(prisma, biliData);
      return {
        ok: true,
        upCount: biliData.ups.length,
        totalVideos: storage.totalVideos,
        totalNews: storage.totalNews,
        restoredUPS: storage.restored,
        failedUPS: storage.failed,
        newsItems: merge,
      };
    });
  }),

  /** 单视频关联的 NewsItem */
  videoNews: publicProcedure
    .input(z.object({ bvid: z.string() }))
    .query(async ({ input }) => {
      return prisma.newsItem.findMany({
        where: {
          deletedAt: null,
          url: { contains: input.bvid },
        },
        orderBy: { publishedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          title: true,
          url: true,
          summary: true,
          category: true,
          publishedAt: true,
          coverUrl: true,
        },
      });
    }),

  /** 单视频字幕元数据 */
  subtitles: publicProcedure
    .input(z.object({ bvid: z.string(), cid: z.number() }))
    .query(async ({ input }) => {
      const subs = await getPlayerSubtitle(input.bvid, input.cid);
      return subs ?? [];
    }),

  /** 单视频字幕内容（远程拉取 B 站字幕 JSON）
   * C-2 修复：SSRF 防护 —— 改为 protectedProcedure（要求登录），
   *           且 url 仅允许 B 站官方字幕域名（避免被滥用为 SSRF 代理） */
  subtitleContent: protectedProcedure
    .input(
      z.object({
        url: z.string().refine(
          (raw) => {
            // 支持协议相对形式 //host/path
            const full = raw.startsWith('//') ? `https:${raw}` : raw;
            try {
              const u = new URL(full);
              // 1) 协议必须 https
              if (u.protocol !== 'https:') return false;
              // 2) hostname 必须属于 B 站官方域名（防 SSRF 到内网/云元数据）
              const host = u.hostname.toLowerCase();
              return (
                host === 'aisubtitle.hdslb.com' ||
                host === 'subtitle.bilibili.com' ||
                host.endsWith('.hdslb.com') ||
                host.endsWith('.bilibili.com')
              );
            } catch {
              return false;
            }
          },
          { message: 'url 必须为 https 且属于 B 站官方字幕域名' },
        ),
      }),
    )
    .query(async ({ input }) => {
      const segments = await fetchSubtitleContent(input.url);
      return segments;
    }),

  /** 跨模态事件融合：关键词 → 新闻 + 视频 + 模型 */
  fuseEvent: publicProcedure
    .input(z.object({ keyword: z.string().min(2).max(60) }))
    .query(async ({ input }) => {
      return fuseEvent(input.keyword);
    }),
});
