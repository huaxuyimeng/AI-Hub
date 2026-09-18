/**
 * 专家市场 Router（Expert Marketplace）
 *
 * MVP1 来源：腾讯元宝 / 元器 WorkBuddy 专家市场调研
 *
 * 端点：
 *   - list              列出市场专家（分页 + 分类 + 搜索）
 *   - get               获取单个专家详情
 *   - categories        获取分类聚合（每个分类的专家数量）
 *   - duplicate         复制专家（用户私有副本）
 *   - update            更新用户自建专家
 *   - delete            删除用户自建专家（软删）
 *   - createMeeting     从专家直接创建会议（选人面板核心入口）
 *
 * 权限规则：
 *   - 系统内置专家（isBuiltIn=true）：所有人可见；update/delete 仅系统
 *   - 用户自建专家（isBuiltIn=false）：仅本人可见和编辑
 *
 * 多租户：系统内置无 tenantId；用户自建记录在用户自己的会话下（无需 tenantId 隔离，
 *        因为所有操作都经过 userId 校验；userId 由 session 强制注入）。
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../context';
import { prismaRaw } from '../../lib/db';
import { ensureBuiltinExpertAgents } from '../../lib/expert/seed-helper';

// ============================================================================
// Select 模式：避免返回 systemPrompt（安全考虑；MVP1 仅 createMeeting 内部使用）
// ============================================================================

const expertSelectForList = {
  id: true,
  slug: true,
  name: true,
  description: true,
  icon: true,
  category: true,
  scenarios: true,
  tags: true,
  accentColor: true,
  avatarUrl: true,
  recommendedModel: true,
  useCount: true,
  sortOrder: true,
  isBuiltIn: true,
  createdByUserId: true,
  tenantId: true,
  createdAt: true,
  /// MVP2：聚合评分（avgRating + ratingCount 在 prisma _count/_avg 通过 computed field）
  /// 用 aggregate 单独算（SQLite 没有 view/relation aggregate）
} as const;

const expertSelectWithPrompt = {
  ...expertSelectForList,
  systemPrompt: true,
} as const;

// ============================================================================
// Router
// ============================================================================

export const expertRouter = router({
  /**
   * 列出市场专家（分页 + 分类 + 搜索 + 排序）
   *
   * 多租户规则：
   *   - isMine=true：仅返回 (isBuiltIn=false AND createdByUserId=me AND tenantId=me)
   *   - isMine=false：返回 isBuiltIn=true（系统内置，所有人可见）
   *
   * 排序：
   *   - featured：sortOrder ASC（人工置顶优先）
   *   - newest：createdAt DESC（最新上线）
   *   - popular：useCount DESC（使用次数最多）
   *   - name：name ASC（A-Z）
   */
  list: protectedProcedure
    .input(
      z.object({
        take: z.number().int().min(1).max(50).default(24),
        skip: z.number().int().min(0).default(0),
        category: z.string().optional(),
        search: z.string().optional(),
        isMine: z.boolean().optional(),
        sort: z.enum(['featured', 'newest', 'popular', 'name']).default('featured'),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ensureBuiltinExpertAgents();

      const where = input.isMine
        ? {
            // 仅自己的私有副本
            deletedAt: null,
            isBuiltIn: false,
            createdByUserId: ctx.session.user.id,
            tenantId: ctx.tenantId,
            ...(input.category ? { category: input.category } : {}),
            ...(input.search
              ? {
                  OR: [
                    { name: { contains: input.search } },
                    { description: { contains: input.search } },
                    { tags: { contains: input.search } },
                    { scenarios: { contains: input.search } },
                  ],
                }
              : {}),
          }
        : {
            // 市场模式：只看系统内置（用户私有副本不进公开市场）
            deletedAt: null,
            isBuiltIn: true,
            ...(input.category ? { category: input.category } : {}),
            ...(input.search
              ? {
                  OR: [
                    { name: { contains: input.search } },
                    { description: { contains: input.search } },
                    { tags: { contains: input.search } },
                    { scenarios: { contains: input.search } },
                  ],
                }
              : {}),
          };

      // 按 sort 参数选 orderBy
      const orderBy = (() => {
        switch (input.sort) {
          case 'newest':
            return [{ sortOrder: 'asc' as const }, { createdAt: 'desc' as const }];
          case 'popular':
            return [{ useCount: 'desc' as const }, { sortOrder: 'asc' as const }];
          case 'name':
            return [{ name: 'asc' as const }];
          case 'featured':
          default:
            return [{ sortOrder: 'asc' as const }, { useCount: 'desc' as const }];
        }
      })();

      const [experts, total] = await Promise.all([
        prismaRaw.expertAgent.findMany({
          where,
          select: expertSelectForList,
          orderBy,
          take: input.take,
          skip: input.skip,
        }),
        prismaRaw.expertAgent.count({ where }),
      ]);

      // MVP2：聚合每个专家的评分（avg + count）
      const ids = experts.map((e) => e.id);
      const ratingAgg =
        ids.length > 0
          ? await prismaRaw.expertRating.groupBy({
              by: ['agentId'],
              where: { agentId: { in: ids }, deletedAt: null },
              _avg: { rating: true },
              _count: { _all: true },
            })
          : [];
      const ratingMap = new Map(ratingAgg.map((r) => [r.agentId, {
        avgRating: r._avg.rating ?? 0,
        ratingCount: r._count._all,
      }]));

      return {
        experts: experts.map((e) => ({
          ...e,
          avgRating: ratingMap.get(e.id)?.avgRating ?? 0,
          ratingCount: ratingMap.get(e.id)?.ratingCount ?? 0,
        })),
        total,
      };
    }),

  /**
   * 获取单个专家详情（不含 systemPrompt）
   * 可见性：所有人可见系统内置；只有创建者可见自己的私有副本
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const expert = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { isBuiltIn: true },
            {
              isBuiltIn: false,
              createdByUserId: ctx.session.user.id,
              tenantId: ctx.tenantId,
            },
          ],
        },
        select: expertSelectForList,
      });
      if (!expert) throw new TRPCError({ code: 'NOT_FOUND' });
      return expert;
    }),

  /**
   * 获取单个专家详情（含 systemPrompt）
   *
   * MVP1：用户编辑/复制时需要看 prompt
   * 安全：系统内置（所有人可见）+ 用户自建（仅创建者）
   */
  getWithPrompt: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const expert = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { isBuiltIn: true },
            {
              isBuiltIn: false,
              createdByUserId: ctx.session.user.id,
              tenantId: ctx.tenantId,
            },
          ],
        },
        select: expertSelectWithPrompt,
      });
      if (!expert) throw new TRPCError({ code: 'NOT_FOUND' });
      return expert;
    }),

  /**
   * 列出分类列表（按专家数量降序）
   * MVP1：仅统计系统内置（市场可用分类）；用户自建分类不进入市场 tab
   */
  categories: protectedProcedure.query(async () => {
    await ensureBuiltinExpertAgents();

    const groups = await prismaRaw.expertAgent.groupBy({
      by: ['category'],
      where: { deletedAt: null, isBuiltIn: true },
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
    });

    return groups.map((g) => ({
      category: g.category,
      count: g._count.category,
    }));
  }),

  /**
   * 复制专家（用户私有副本）
   *
   * 写入 createdByUserId + tenantId 实现多租户隔离
   */
  duplicate: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().max(60).optional() }))
    .mutation(async ({ ctx, input }) => {
      // 校验源专家可见（系统内置或自己租户的）
      const source = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { isBuiltIn: true },
            {
              isBuiltIn: false,
              createdByUserId: ctx.session.user.id,
              tenantId: ctx.tenantId,
            },
          ],
        },
      });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND' });

      // 用 userId 前缀保证 slug 唯一
      const userPrefix = ctx.session.user.id.slice(0, 8);
      const copy = await prismaRaw.expertAgent.create({
        data: {
          slug: `user-${userPrefix}-${Date.now()}`,
          name: input.name ?? `${source.name}（副本）`,
          description: source.description,
          icon: source.icon,
          category: source.category,
          scenarios: source.scenarios,
          tags: source.tags,
          accentColor: source.accentColor,
          avatarUrl: source.avatarUrl,
          systemPrompt: source.systemPrompt,
          recommendedModel: source.recommendedModel,
          triggers: source.triggers,
          isBuiltIn: false,
          sortOrder: 999,
          createdByUserId: ctx.session.user.id,
          tenantId: ctx.tenantId,
        },
        select: expertSelectWithPrompt,
      });

      return copy;
    }),

  /**
   * 从零创建专家（用户原创）
   *
   * 多租户：必须登录 + tenantId，自动绑定 createdByUserId/tenantId
   * slug 唯一：用 userId 前缀 + 时间戳
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(60),
        description: z.string().min(1).max(500),
        systemPrompt: z.string().min(20).max(4000),
        recommendedModel: z.string().max(60).optional(),
        category: z.string().min(1).max(30),
        accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        tags: z.string().max(200).optional(),
        scenarios: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userPrefix = ctx.session.user.id.slice(0, 8);
      return prismaRaw.expertAgent.create({
        data: {
          slug: `user-${userPrefix}-${Date.now()}`,
          name: input.name.trim(),
          description: input.description.trim(),
          systemPrompt: input.systemPrompt.trim(),
          recommendedModel: input.recommendedModel?.trim() ?? null,
          category: input.category,
          accentColor: input.accentColor ?? '#6366F1',
          tags: input.tags?.trim() ?? '',
          scenarios: input.scenarios?.trim() ?? '',
          icon: 'IconSparkles',
          isBuiltIn: false,
          sortOrder: 999,
          createdByUserId: ctx.session.user.id,
          tenantId: ctx.tenantId,
        },
        select: expertSelectWithPrompt,
      });
    }),

  /**
   * 更新用户自建专家
   *
   * 多租户校验：
   *   - 系统内置：禁止修改（FORBIDDEN）
   *   - 用户自建：必须 createdByUserId=me AND tenantId=me
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(500).optional(),
        systemPrompt: z.string().max(4000).optional(),
        recommendedModel: z.string().max(60).optional(),
        category: z.string().max(30).optional(),
        accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          // 只能改自己的
          isBuiltIn: false,
          createdByUserId: ctx.session.user.id,
          tenantId: ctx.tenantId,
        },
      });
      if (!existing) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '系统内置专家不可编辑；或你无权编辑此专家',
        });
      }

      return prismaRaw.expertAgent.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt }),
          ...(input.recommendedModel !== undefined && { recommendedModel: input.recommendedModel }),
          ...(input.category !== undefined && { category: input.category }),
          ...(input.accentColor !== undefined && { accentColor: input.accentColor }),
        },
        select: expertSelectForList,
      });
    }),

  /**
   * 删除用户自建专家（软删）
   *
   * 多租户校验同 update
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          isBuiltIn: false,
          createdByUserId: ctx.session.user.id,
          tenantId: ctx.tenantId,
        },
      });
      if (!existing) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '系统内置专家不可删除；或你无权删除此专家',
        });
      }

      await prismaRaw.expertAgent.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    }),

  /**
   * 从专家直接创建会议（选人面板核心入口）
   *
   * 与 meeting.create 区别：
   *   - 输入是 expertIds[]（从专家市场选好的）
   *   - 内部从 ExpertAgent 表批量取 systemPrompt + recommendedModel
   *   - 组装成 meeting.create 接受的 participants[] 格式
   *   - 累加每个专家的 useCount
   */
  createMeeting: protectedProcedure
    .input(
      z.object({
        expertIds: z.array(z.string().uuid()).min(2).max(5),
        topic: z.string().min(5).max(2000),
        title: z.string().max(200).optional(),
        // 2026-09-17：默认改为 deepseek-flash（V4.1，1M 上下文，支持 thinking）
        hostModel: z.string().max(60).optional().default('deepseek-flash'),
        // Phase 3 (2026-09-17)：多轮模式
        mode: z.enum(['single', 'multi']).default('single'),
        maxRounds: z.number().int().min(1).max(3).default(2),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const experts = await prismaRaw.expertAgent.findMany({
        where: {
          id: { in: input.expertIds },
          deletedAt: null,
          // 校验可见性：系统内置 OR 自己的私有副本
          OR: [
            { isBuiltIn: true },
            {
              isBuiltIn: false,
              createdByUserId: ctx.session.user.id,
              tenantId: ctx.tenantId,
            },
          ],
        },
        select: {
          id: true,
          name: true,
          recommendedModel: true,
          systemPrompt: true,
        },
      });
      if (experts.length < input.expertIds.length) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '部分专家不存在或无权访问，请重新选择',
        });
      }

      const modeEnum = input.mode === 'multi' ? 'MULTI' : 'SINGLE';
      const maxRoundsValue = input.mode === 'multi' ? input.maxRounds : null;

      const meeting = await prismaRaw.meeting.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.session.user.id,
          topic: input.topic,
          title: input.title ?? input.topic.slice(0, 30),
          hostModel: input.hostModel,
          status: 'ACTIVE',
          mode: modeEnum,
          maxRounds: maxRoundsValue,
          participants: {
            create: experts.map((e, idx) => ({
              model: e.recommendedModel ?? 'deepseek-flash',
              role: e.name,
              systemPrompt: e.systemPrompt,
              order: idx,
              transcript: [],
            })),
          },
        },
        include: { participants: { orderBy: { order: 'asc' } } },
      });

      // 累加每个专家的使用次数（简单的 useCount 自增）
      await prismaRaw.expertAgent.updateMany({
        where: { id: { in: input.expertIds } },
        data: { useCount: { increment: 1 } },
      });

      return meeting;
    }),

  // ============================================================================
  // 收藏（MVP2）
  // ============================================================================

  /**
   * 收藏专家
   * 幂等：重复收藏不会报错
   */
  favorite: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // 校验专家可见
      const expert = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          OR: [
            { isBuiltIn: true },
            {
              isBuiltIn: false,
              createdByUserId: ctx.session.user.id,
              tenantId: ctx.tenantId,
            },
          ],
        },
      });
      if (!expert) throw new TRPCError({ code: 'NOT_FOUND' });

      await prismaRaw.userExpertFavorite.upsert({
        where: {
          userId_agentId: {
            userId: ctx.session.user.id,
            agentId: input.id,
          },
        },
        update: {},
        create: {
          userId: ctx.session.user.id,
          agentId: input.id,
        },
      });
      return { ok: true };
    }),

  /**
   * 取消收藏
   */
  unfavorite: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await prismaRaw.userExpertFavorite.deleteMany({
        where: {
          userId: ctx.session.user.id,
          agentId: input.id,
        },
      });
      return { ok: true };
    }),

  /**
   * 列出当前用户所有收藏的专家 ID（用于 UI 状态）
   */
  listFavoriteIds: protectedProcedure.query(async ({ ctx }) => {
    const rows = await prismaRaw.userExpertFavorite.findMany({
      where: { userId: ctx.session.user.id },
      select: { agentId: true },
    });
    return rows.map((r) => r.agentId);
  }),

  // ============================================================================
  // MVP2：专家评分 + 评论
  // ============================================================================

  /**
   * 给专家评分（1-5 星）+ 评论
   * - 每用户对每专家最多 1 条：upsert
   * - 改分/改评论：再次调用即可
   * - 取消：调 deleteRating
   */
  rate: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 校验专家存在 + 可见性
      const expert = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.agentId,
          deletedAt: null,
          OR: [
            { isBuiltIn: true },
            { isBuiltIn: false, createdByUserId: ctx.session.user.id, tenantId: ctx.tenantId },
          ],
        },
        select: { id: true },
      });
      if (!expert) throw new TRPCError({ code: 'NOT_FOUND' });

      // upsert（包含软删恢复）
      const row = await prismaRaw.expertRating.upsert({
        where: {
          userId_agentId: {
            userId: ctx.session.user.id,
            agentId: input.agentId,
          },
        },
        create: {
          userId: ctx.session.user.id,
          agentId: input.agentId,
          rating: input.rating,
          comment: input.comment ?? null,
        },
        update: {
          rating: input.rating,
          comment: input.comment ?? null,
          deletedAt: null, // 恢复了的话也清空
        },
      });
      return { id: row.id, rating: row.rating, comment: row.comment };
    }),

  /**
   * 取消评分（软删）
   */
  deleteRating: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await prismaRaw.expertRating.updateMany({
        where: {
          userId: ctx.session.user.id,
          agentId: input.agentId,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    }),

  /**
   * 列出专家最近评论（按时间倒序，limit 10）
   * 含评分 + 用户名（脱敏）+ 评论文本
   */
  listComments: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      // 评论公开：只对系统内置专家可见（私有专家不公开评论）
      const expert = await prismaRaw.expertAgent.findFirst({
        where: {
          id: input.agentId,
          deletedAt: null,
          OR: [
            { isBuiltIn: true },
            { isBuiltIn: false, createdByUserId: ctx.session.user.id, tenantId: ctx.tenantId },
          ],
        },
        select: { id: true },
      });
      if (!expert) throw new TRPCError({ code: 'NOT_FOUND' });

      const rows = await prismaRaw.expertRating.findMany({
        where: { agentId: input.agentId, deletedAt: null, comment: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          userId: true,
        },
      });
      // 用户名脱敏：取前 4 字符 + "***"
      return rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment!,
        createdAt: r.createdAt,
        userHash: r.userId.slice(0, 4) + '***',
      }));
    }),

  /**
   * 获取当前用户对某专家的评分（用于 UI 默认值）
   */
  myRating: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await prismaRaw.expertRating.findFirst({
        where: {
          userId: ctx.session.user.id,
          agentId: input.agentId,
          deletedAt: null,
        },
        select: { rating: true, comment: true },
      });
      return row;
    }),
});
