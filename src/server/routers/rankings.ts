/**
 * 模型排行榜 tRPC 路由
 *
 * 来源：整合 plan §4.2
 * 功能：排行查询、详情、刷新、价格历史
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure, adminProcedure } from '@/server/context';
import { prismaBase as prisma } from '@/lib/db';
import { calculateValueScore, normalizeScores, paretoFrontier } from '@/lib/rankings/algorithm';
import { ModelScraper } from '@/lib/rankings/scraper';
import { intentSearch } from '@/lib/news/intent-search';

export const rankingsRouter = router({
  /**
   * 排行榜列表（带筛选）
   */
  list: publicProcedure
    .input(z.object({
      provider: z.string().optional(),
      onlyActive: z.boolean().default(true),
    }).optional())
    .query(async ({ input }) => {
      const models = await prisma.model.findMany({
        where: {
          ...(input?.onlyActive !== false && { isActive: true }),
          ...(input?.provider && { provider: input.provider }),
          deletedAt: null,
        },
        orderBy: { intelligence: { sort: 'desc', nulls: 'last' } },
      });

      // 计算性价比
      const scored = models.map((m) => {
        const score = calculateValueScore({
          priceInput: m.priceInput,
          priceOutput: m.priceOutput,
          intelligence: m.intelligence ?? 0,
          speed: m.speed ?? 1,
        });

        return {
          id: m.id,
          externalId: m.externalId,
          name: m.name,
          provider: m.provider,
          family: m.family,
          priceInput: m.priceInput,
          priceOutput: m.priceOutput,
          intelligence: m.intelligence,
          speed: m.speed,
          contextWindow: m.contextWindow, // Batch 6
          scoreSource: m.scoreSource,
          isPending: m.isPending,
          description: m.description,
          valueScore: score.valueScore,
          blendPrice: score.blendPrice,
          isExcluded: score.isExcluded,
          excludeReason: score.reason,
          updatedAt: m.updatedAt.toISOString(),
        };
      });

      // 归一化 + 排序
      const normalized = normalizeScores(scored);

      // ★ 修复：isExcluded 的模型永远排到底部，不参与 rank
      //   - 不论用户选哪个 sort 维度，"价格未设置"/"能力分<25" 的都不该出现在 Top
      //   - 排在末尾时 rank 字段标 "—"，UI 表格会显示
      const sorted = normalized.sort((a, b) => {
        // 第一优先级：是否被排除
        if (a.isExcluded !== b.isExcluded) {
          return a.isExcluded ? 1 : -1; // 未排除的在前
        }
        // 第二优先级：价值分降序（都未排除 or 都被排除）
        return b.valueScore - a.valueScore;
      });

      // 添加排名（排除的标记为 —）
      return sorted.map((m, i) => ({
        ...m,
        rank: m.isExcluded ? 0 : i + 1,
      }));
    }),

  /**
   * 模型详情
   *
   * 接受 idOrSlug 参数，三路匹配：
   *   1. 若为标准 UUID v4 格式 → 直接按主键查
   *   2. 否则按 externalId 查（如 "claude-fable-5"）
   *   3. 否则按 name 模糊匹配（兼容旧链接）
   *
   * 这样 rankings 列表跳转 / 直接访问详情页都顺。
   */
  detail: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const { id } = input;

      // 三路匹配
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

      // 第一步：找模型主记录（不带 include，因为 findFirst 不支持）
      const baseModel = await prisma.model.findFirst({
        where: isUuid
          ? { id }
          : {
              OR: [
                { externalId: id },
                { name: id }, // SQLite 不支持 mode: 'insensitive'，靠应用层做小写比较
              ],
            },
        select: { id: true },
      });

      if (!baseModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `模型不存在：${id}` });
      }

      // 第二步：完整查询（带 snapshots）
      const model = await prisma.model.findUnique({
        where: { id: baseModel.id },
        include: {
          snapshots: {
            orderBy: { snapshotAt: 'desc' },
            take: 30,
          },
        },
      });

      if (!model) throw new TRPCError({ code: 'NOT_FOUND' });

      // 获取相关新闻
      const relatedNews = await prisma.newsItem.findMany({
        where: {
          deletedAt: null,
          relatedModels: { contains: model.externalId },
        },
        include: { source: true },
        orderBy: { publishedAt: 'desc' },
        take: 10,
      });

      return {
        model: {
          ...model,
          createdAt: model.createdAt.toISOString(),
          updatedAt: model.updatedAt.toISOString(),
          snapshots: model.snapshots.map((s: typeof model.snapshots[number]) => ({
            ...s,
            snapshotAt: s.snapshotAt.toISOString(),
          })),
        },
        relatedNews: relatedNews.map((n) => ({
          id: n.id,
          title: n.title,
          url: n.url,
          summary: n.summary,
          /** publishedAt 可为 null */
          publishedAt: n.publishedAt?.toISOString() ?? null,
          category: n.category,
          source: { name: n.source.name },
        })),
      };
    }),

  /**
   * 手动触发刷新（修复 BUG-05：必须 ADMIN）
   */
  refresh: adminProcedure
    .input(z.object({ id: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      const scraper = new ModelScraper();

      if (input?.id) {
        const result = await scraper.refreshOne(input.id);
        return { updated: result ? 1 : 0, total: 1 };
      }

      // 先发现新模型，再刷新所有
      const discovered = await scraper.discoverFromNews();
      const result = await scraper.refreshAll();

      return {
        discovered: discovered.length,
        updated: result.succeeded,
        failed: result.failed,
        total: result.total,
      };
    }),

  /**
   * 价格历史
   */
  priceHistory: publicProcedure
    .input(z.object({ id: z.string(), days: z.number().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const snapshots = await prisma.modelSnapshot.findMany({
        where: {
          modelId: input.id,
          snapshotAt: { gte: since },
        },
        orderBy: { snapshotAt: 'asc' },
      });

      return snapshots.map((s) => ({
        ...s,
        snapshotAt: s.snapshotAt.toISOString(),
      }));
    }),

  /**
   * 帕累托前沿（用于图表展示）
   */
  frontier: publicProcedure
    .query(async () => {
      const models = await prisma.model.findMany({
        where: { isActive: true, deletedAt: null },
      });

      const frontier = paretoFrontier(
        models.map((m) => ({
          id: m.id,
          externalId: m.externalId,
          name: m.name,
          priceInput: m.priceInput,
          intelligence: m.intelligence,
        }))
      );

      return frontier.map((m) => ({
        id: m.id,
        externalId: m.externalId,
        name: m.name,
        priceInput: m.priceInput,
        intelligence: m.intelligence,
      }));
    }),

  /**
   * 所有厂商（用于筛选下拉框）
   */
  providers: publicProcedure
    .query(async () => {
      const result = await prisma.model.findMany({
        where: { isActive: true, deletedAt: null },
        select: { provider: true },
        distinct: ['provider'],
      });
      return result.map((r) => r.provider).sort();
    }),

  /**
   * 意图搜索 — 解析自然语言查询 + 执行模型过滤
   *
   * 行为：
   *   1. 用 gpt-4o-mini 把 query 解析为 SearchIntent（provider / priceRange / minIntelligence / sort …）
   *   2. 执行 Prisma 查询 + 性价比计算
   *   3. LLM 失败时降级为字面搜索（degraded=true）
   *
   * 用途：rankings/page.tsx 智能搜索框
   */
  search: protectedProcedure
    .input(
      z.object({
        /** 自然语言查询，如 "性价比高的中文模型"、"GPT-5 发布"、"便宜的速度快的" */
        query: z.string().min(1).max(500),
      })
    )
    .query(async ({ ctx, input }) => {
      // B-13 修复：传入真实 tenantId（之前漏传导致 AI Key 永远查不到）
      if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
      return intentSearch(input.query, ctx.tenantId);
    }),
});