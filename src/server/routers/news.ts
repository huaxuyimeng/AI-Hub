/**
 * 新闻 tRPC 路由
 *
 * 来源：整合 plan §3.2
 * 功能：新闻查询、刷新、统计
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure, adminProcedure } from '@/server/context';
import { fetchAllNews, queryNews, countNews, getAvailableDates, beijingDayStart } from '@/lib/news/service';
import { expandQuery } from '@/lib/news/search';
import { newsIntentSearch } from '@/lib/news/news-intent';
import { prismaBase } from '@/lib/db';

export const newsRouter = router({
  /**
   * 新闻列表（带筛选 + 游标分页）
   */
  list: publicProcedure
    .input(z.object({
      date: z.string().optional(),
      category: z.string().optional(),
      source: z.string().optional(),
      search: z.string().optional(),
      companyTag: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
      skip: z.number().min(0).max(10000).default(0),
    }))
    .query(async ({ input }) => {
      // D-2 智能搜索：搜索词先经术语词典同义词展开，再参与查询
      const trimmedSearch = input.search?.trim();
      let searchKeywords: string[] | undefined;
      let matchedTerms: Array<{ canonical: string; displayName: string; type: string }> = [];
      if (trimmedSearch) {
        const expanded = await expandQuery(trimmedSearch);
        searchKeywords = expanded.keywords.length > 0 ? expanded.keywords : undefined;
        matchedTerms = expanded.matchedTerms;
      }

      const [items, filteredTotal] = await Promise.all([
        queryNews({ ...input, searchKeywords }),
        countNews({ ...input, searchKeywords }),
      ]);

      // 转 plain object 便于序列化
      const plainItems = items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        summary: item.summary,
        /** publishedAt 可为 null（时间未知） */
        publishedAt: item.publishedAt?.toISOString() ?? null,
        /** 时间精度 */
        publishPrecision: item.publishPrecision ?? null,
        /** createdAt = 爬取时间（用于 UI 展示"发布时间不可信"的提示） */
        crawledAt: item.createdAt.toISOString(),
        category: item.category,
        /** 封面图 URL（2026-08-30 新增） */
        coverUrl: item.coverUrl,
        crossSources: item.crossSources ? item.crossSources.split(',').filter(Boolean) : [],
        relatedModels: item.relatedModels ? item.relatedModels.split(',').filter(Boolean) : [],
        /** AI 厂家标签（OpenAI、DeepSeek 等）（2026-08-30 新增） */
        companyTags: item.companyTags ? item.companyTags.split(',').filter(Boolean) : [],
        confidence: item.confidence,
        /** 多媒体引用（视频/音频/图片，D-1 B 站爬虫写入）（2026-08-31 新增）*/
        media: item.media as unknown as Array<{
          kind?: 'video' | 'audio' | 'image';
          bvid?: string;
          author?: string;
          thumbnailUrl?: string;
          durationSec?: number;
          url?: string;
        }> | null,
        source: {
          id: item.source.id,
          name: item.source.name,
        },
      }));

      return {
        items: plainItems,
        /** 当前筛选条件下数据库总条数（来自 countNews）—— 不被分页截断 */
        total: filteredTotal,
        /** 同上字段，语义更明确 */
        filteredTotal,
        /** 是否还有更多（用于"加载更多"按钮） */
        hasMore: plainItems.length === input.limit,
        /** 搜索词的同义词展开信息（D-2 智能搜索） */
        search: trimmedSearch
          ? {
              query: trimmedSearch,
              expandedKeywords: searchKeywords ?? [],
              matchedTerms,
            }
          : null,
      };
    }),

  /**
   * 可用日期（用于日历选择）
   */
  dates: publicProcedure
    .query(async () => {
      return getAvailableDates();
    }),

  /**
   * 统计概览
   */
  stats: publicProcedure
    .query(async () => {
      // 「今日」按北京时间日界计算（用户在 UTC+8）
      const dayStart = beijingDayStart();
      const [total, today, sources, byCategory] = await Promise.all([
        prismaBase.newsItem.count({ where: { deletedAt: null } }),
        prismaBase.newsItem.count({
          where: {
            deletedAt: null,
            publishedAt: { gte: dayStart },
          },
        }),
        prismaBase.newsSource.count({ where: { enabled: true } }),
        prismaBase.newsItem.groupBy({
          by: ['category'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
      ]);

      const categoryCounts: Record<string, number> = {};
      for (const row of byCategory) {
        categoryCounts[row.category ?? '未分类'] = row._count._all;
      }

      return { total, today, sources, categoryCounts };
    }),

  /**
   * 手动触发抓取（修复 BUG-05：必须 ADMIN）
   */
  refresh: adminProcedure
    .mutation(async () => {
      const result = await fetchAllNews();
      return {
        success: true,
        totalItems: result.totalItems,
        sources: result.sources,
        warnings: result.warnings,
        errors: result.errors,
      };
    }),

  /**
   * 模型相关新闻（排行详情页用）
   * 精确匹配：relatedModels 是逗号分隔字符串，按元素精确匹配
   */
  byModel: publicProcedure
    .input(z.object({ modelId: z.string(), limit: z.number().default(10) }))
    .query(async ({ input }) => {
      const modelId = input.modelId.trim();
      // relatedModels 是逗号分隔字符串，需精确匹配单个元素，避免 "gpt-4o" 命中 "gpt-4o-mini"
      const items = await prismaBase.newsItem.findMany({
        where: {
          deletedAt: null,
          OR: [
            { relatedModels: modelId },
            { relatedModels: { startsWith: `${modelId},` } },
            { relatedModels: { endsWith: `,${modelId}` } },
            { relatedModels: { contains: `,${modelId},` } },
          ],
        },
        include: { source: true },
        orderBy: { publishedAt: 'desc' },
        take: input.limit,
      });

      return items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        summary: item.summary,
        coverUrl: item.coverUrl,
        /** publishedAt 可为 null */
        publishedAt: item.publishedAt?.toISOString() ?? null,
        publishPrecision: item.publishPrecision ?? null,
        crawledAt: item.createdAt.toISOString(),
        category: item.category,
        crossSources: item.crossSources ? item.crossSources.split(',').filter(Boolean) : [],
        companyTags: item.companyTags ? item.companyTags.split(',').filter(Boolean) : [],
        source: { id: item.source.id, name: item.source.name },
      }));
    }),

  /**
   * 详细统计（图表数据，2026-08-30 新增，2026-09-01 v3 扩展置信度维度）
   * 包含：趋势线、源头分布、分类分布、厂家提及、置信度分布、源头质量榜
   */
  analytics: publicProcedure
    .query(async () => {
      // 「今日」按北京时间日界计算（用户在 UTC+8）
      const dayStart = beijingDayStart();

      // 30 天前
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

      const [totalRow, todayRow, sources, trendByConfidenceRaw, sourceDist, categoryStats, companyStats, confidenceDist, sourceQualityRaw, reliableTodayRow] = await Promise.all([
        // 总数
        prismaBase.newsItem.count({ where: { deletedAt: null } }),
        // 今日
        prismaBase.newsItem.count({
          where: { deletedAt: null, publishedAt: { gte: dayStart } },
        }),
        // 启用源数
        prismaBase.newsSource.count({ where: { enabled: true } }),

        // 30 天按置信度趋势：每天 × 每档置信度的计数
        prismaBase.$queryRaw<Array<{ date: string; confidence: string | null; count: bigint | number }>>`
          SELECT
            DATE(publishedAt / 1000, 'unixepoch', '+8 hours') as date,
            confidence,
            COUNT(*) as count
          FROM NewsItem
          WHERE deletedAt IS NULL
            AND publishedAt >= ${thirtyDaysAgo}
          GROUP BY DATE(publishedAt / 1000, 'unixepoch', '+8 hours'), confidence
          ORDER BY date ASC
        `,

        // 源头分布（近 30 天）
        prismaBase.$queryRaw<Array<{ sourceName: string; count: bigint | number }>>`
          SELECT
            s.name as sourceName,
            COUNT(n.id) as count
          FROM NewsItem n
          INNER JOIN NewsSource s ON n.sourceId = s.id
          WHERE n.deletedAt IS NULL
            AND n.publishedAt >= ${thirtyDaysAgo}
          GROUP BY s.name
          ORDER BY count DESC
        `,

        // 分类分布
        prismaBase.$queryRaw<Array<{ category: string | null; count: bigint | number }>>`
          SELECT
            category,
            COUNT(*) as count
          FROM NewsItem
          WHERE deletedAt IS NULL
            AND category IS NOT NULL
            AND publishedAt >= ${thirtyDaysAgo}
          GROUP BY category
          ORDER BY count DESC
        `,

        // 厂家提及：必须先按 companyTags 分组，否则 SQLite 只返回任意一行
        prismaBase.$queryRaw<Array<{ companyTags: string; count: bigint | number }>>`
          SELECT companyTags, COUNT(*) as count
          FROM NewsItem
          WHERE deletedAt IS NULL
            AND companyTags != ''
            AND publishedAt >= ${thirtyDaysAgo}
          GROUP BY companyTags
          ORDER BY count DESC
        `,

        // 置信度分布（全量，不限时间）—— 给前端饼图
        prismaBase.$queryRaw<Array<{ confidence: string | null; count: bigint | number }>>`
          SELECT confidence, COUNT(*) as count
          FROM NewsItem
          WHERE deletedAt IS NULL
          GROUP BY confidence
        `,

        // 源头质量（按 A=4 / B=3 / C=2 / D=1 加权）—— 给前端源头质量榜
        prismaBase.$queryRaw<Array<{
          sourceName: string;
          total: bigint | number;
          aCount: bigint | number;
          bCount: bigint | number;
          cCount: bigint | number;
          dCount: bigint | number;
        }>>`
          SELECT
            s.name as sourceName,
            COUNT(n.id) as total,
            SUM(CASE WHEN n.confidence = 'A' THEN 1 ELSE 0 END) as aCount,
            SUM(CASE WHEN n.confidence = 'B' THEN 1 ELSE 0 END) as bCount,
            SUM(CASE WHEN n.confidence = 'C' THEN 1 ELSE 0 END) as cCount,
            SUM(CASE WHEN n.confidence = 'D' THEN 1 ELSE 0 END) as dCount
          FROM NewsItem n
          INNER JOIN NewsSource s ON n.sourceId = s.id
          WHERE n.deletedAt IS NULL
          GROUP BY s.name
          ORDER BY total DESC
        `,

        // 今日可信新闻：A+B 且多源验证
        prismaBase.newsItem.count({
          where: {
            deletedAt: null,
            publishedAt: { gte: dayStart },
            confidence: { in: ['A', 'B'] },
            crossSources: { not: '' },
          },
        }),
      ]);

      // ── 厂家提及：同一行内的重复标签只算 1 次 ──
      const companyCounts: Record<string, number> = {};
      for (const row of companyStats) {
        const rowTags = new Set(row.companyTags.split(',').map(t => t.trim()).filter(Boolean));
        for (const tag of rowTags) {
          companyCounts[tag] = (companyCounts[tag] ?? 0) + Number(row.count);
        }
      }

      const companyRanks = Object.entries(companyCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

      // ── 置信度分布（按 A/B/C/D 固定顺序）──
      const confidenceMap: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 };
      for (const row of confidenceDist) {
        const key = row.confidence;
        if (key === 'A' || key === 'B' || key === 'C' || key === 'D') {
          confidenceMap[key] = Number(row.count);
        }
      }
      const total = totalRow;
      const highQualityCount = confidenceMap.A + confidenceMap.B;
      const highQualityPct = total > 0 ? Math.round((highQualityCount / total) * 100) : 0;

      // ── 源头质量（加权分 = A*4 + B*3 + C*2 + D*1） / total ──
      const sourceQuality = sourceQualityRaw.map(r => {
        const t = Number(r.total);
        const score = t > 0
          ? (Number(r.aCount) * 4 + Number(r.bCount) * 3 + Number(r.cCount) * 2 + Number(r.dCount) * 1) / t
          : 0;
        return {
          name: r.sourceName,
          count: t,
          score: Math.round(score * 10) / 10, // 保留 1 位小数
        };
      }).sort((a, b) => b.score - a.score);

      // ── 30 天按置信度趋势：转换为按天的 A/B/C/D 数组（缺失档位补 0） ──
      const trendByConfidenceMap: Record<string, { A: number; B: number; C: number; D: number }> = {};
      for (const row of trendByConfidenceRaw) {
        const date = String(row.date);
        const conf = row.confidence;
        if (conf !== 'A' && conf !== 'B' && conf !== 'C' && conf !== 'D') continue;
        if (!trendByConfidenceMap[date]) trendByConfidenceMap[date] = { A: 0, B: 0, C: 0, D: 0 };
        trendByConfidenceMap[date][conf] += Number(row.count);
      }
      const trendByConfidence = Object.entries(trendByConfidenceMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({ date, ...counts }));

      // 兼容旧字段 trend（按天总数，给仍引用它的前端使用）
      const trend = trendByConfidence.map(d => ({
        date: d.date,
        count: d.A + d.B + d.C + d.D,
      }));

      return {
        total,
        today: todayRow,
        sources,
        /** 高质量新闻占比（A+B / 总数，2026-09-01 新增） */
        highQualityPct,
        /** 今日可信新闻（A+B + 多源验证，2026-09-01 新增） */
        reliableToday: reliableTodayRow,
        /** 置信度分布（2026-09-01 新增）：A/B/C/D 固定顺序 */
        confidenceDistribution: [
          { grade: 'A' as const, label: 'A 可信', count: confidenceMap.A },
          { grade: 'B' as const, label: 'B 较可信', count: confidenceMap.B },
          { grade: 'C' as const, label: 'C 存疑', count: confidenceMap.C },
          { grade: 'D' as const, label: 'D 不可信', count: confidenceMap.D },
        ],
        /** 源头质量榜（2026-09-01 新增）：按加权分排序 */
        sourceQuality: sourceQuality.slice(0, 12),
        /** 30 天按置信度趋势（2026-09-01 新增）：堆叠柱状图用 */
        trendByConfidence,
        /** 30 天总趋势（兼容旧字段） */
        trend,
        /** 源头分布（近 30 天） */
        sourceDistribution: sourceDist.map(r => ({
          name: r.sourceName,
          count: Number(r.count),
        })),
        /** 分类分布 */
        categoryDistribution: categoryStats.map(r => ({
          name: r.category ?? '未分类',
          count: Number(r.count),
        })),
        companyMentions: companyRanks,
      };
    }),

  /**
   * 新闻简要看板（2026-09-01 新增）
   *
   * 返回今日最新 N 条新闻的精简摘要：
   *   标题、时间、数据源、关键词、跳转链接
   * 用于在 AI 新闻页面顶部展示一个紧凑的表格视图
   */
  brief: publicProcedure
    .input(z.object({
      /** 返回条数，默认 20 */
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const dayStart = beijingDayStart();

      const items = await prismaBase.newsItem.findMany({
        where: {
          deletedAt: null,
          publishedAt: { gte: dayStart },
        },
        include: { source: true },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
      });

      return items.map(item => ({
        id: item.id,
        title: item.title,
        url: item.url,
        summary: item.summary ?? null,
        coverUrl: item.coverUrl ?? null,
        /** publishedAt 可为 null */
        publishedAt: item.publishedAt?.toISOString() ?? null,
        sourceName: item.source.name,
        /** 分类标签 */
        category: item.category,
        /** AI 厂家关键词 */
        companyTags: item.companyTags ? item.companyTags.split(',').filter(Boolean) : [],
        /** 多源数 */
        crossSourcesCount: item.crossSources ? item.crossSources.split(',').filter(Boolean).length : 0,
      }));
    }),

  /**
   * 新闻意图搜索（D-3 扩展，D-3 报告 §1）
   *
   * 输入自然语言查询 → LLM 解析为结构化过滤条件 → 执行搜索
   * LLM 失败时降级为字面 contains 搜索（不影响可用性）
   *
   * 用法：用户在搜索框输入"具身智能最近一周"，自动展开为
   *   category=具身智能 + dateRange=last-week + sort=recent
   *
   * 设计：docs/33-Qoder-未来优化建议报告.md §1
   */
  intentSearch: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(500),
    }))
    .query(async ({ ctx, input }) => {
      // B-13 修复：传入真实 tenantId（之前漏传导致 AI Key 永远查不到）
      if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
      const result = await newsIntentSearch(input.query, ctx.tenantId);
      return result;
    }),
});