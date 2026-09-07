// 来源：d:\1Money\design\API设计.md §六 usageRouter
// 整合 v3 §5.2：用量统计集成实时模型价格（rankings.list）
//
// 数据流：
//   - 最近 N 天每日聚合（recent）   ← UsageStat
//   - 按模型拆分（byModel）         ← UsageStat × Model（实时价格）
//   - 实时模型价格表（pricing）     ← rankings.list（覆盖 PRICING_TABLE）
//
// 设计取舍（2026-08-30）：
//   - byModel 在 DB 层 groupBy，避免拉全表到内存聚合
//   - null modelId 行不进"按模型"区块（语义模糊，UI 无法展示），但仍计入"recent"总量
//   - pricing 显式声明联合类型，绕开 TS 推 'RANKINGS' 单字面量塌缩的问题

import { z } from 'zod';
import { router, protectedProcedure } from '../context';
import { createTenantPrisma, prismaBase } from '../../lib/db';
import { PRICING_TABLE, getPricing } from '../../lib/ai/pricing';
import { UNKNOWN_MODEL_ID } from '../../lib/usage';

type PricingItem = {
  name: string;
  displayName: string;
  provider: string;
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice?: number;
  maxContextWindow?: number;
  supportsPromptCache?: boolean;
  isPending?: boolean;
  updatedAt: string | null;
  source: 'RANKINGS' | 'FALLBACK';
};

export const usageRouter = router({
  /** 当前租户的最近 N 天每日用量（按日聚合，固定 schema） */
  recent: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - input.days + 1);

      const grouped = await prisma.usageStat.groupBy({
        by: ['date'],
        where: { date: { gte: since } },
        orderBy: { date: 'asc' },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          costCents: true,
          messageCount: true,
          analysisCount: true,
        },
      });
      const rows = grouped.map((row) => ({
        date: row.date,
        inputTokens: row._sum.inputTokens ?? 0n,
        outputTokens: row._sum.outputTokens ?? 0n,
        costCents: row._sum.costCents ?? 0,
        messageCount: row._sum.messageCount ?? 0,
        analysisCount: row._sum.analysisCount ?? 0,
      }));

      const totalInput = rows.reduce((s, r) => s + Number(r.inputTokens), 0);
      const totalOutput = rows.reduce((s, r) => s + Number(r.outputTokens), 0);
      const totalMessages = rows.reduce((s, r) => s + r.messageCount, 0);
      const totalAnalyses = rows.reduce((s, r) => s + r.analysisCount, 0);
      const totalCents = rows.reduce((s, r) => s + r.costCents, 0);

      return {
        days: rows,
        totals: {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          messageCount: totalMessages,
          analysisCount: totalAnalyses,
          costCents: totalCents,
        },
      };
    }),

  /**
   * 按模型拆分用量 + 实时价格（整合 v3 §5.2）
   *
   * 数据流：
   *   1. DB 层 groupBy(modelId) 聚合（避免拉全表到内存）
   *   2. 拉取 Model 表的实时价格
   *   3. 重新计算成本（按 externalId 匹配；找不到回退 PRICING_TABLE）
   *
   * 注意：null modelId 行不计入 byModel（语义模糊），但仍出现在 recent 里。
   */
  byModel: protectedProcedure
    .input(z.object({
      days: z.number().int().min(1).max(90).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - input.days + 1);

      // 1. DB 层 groupBy（modelId 非 null），减少传输
      const grouped = await prisma.usageStat.groupBy({
        by: ['modelId'],
        where: {
          date: { gte: since },
          modelId: { not: null },
        },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          costCents: true,
          messageCount: true,
          analysisCount: true,
        },
      });

      const modelIds = grouped.map((g) => g.modelId).filter((m): m is string => Boolean(m));

      // 2. 拉实时价格
      const models = modelIds.length > 0
        ? await prismaBase.model.findMany({
            where: { externalId: { in: modelIds }, deletedAt: null },
            select: {
              externalId: true,
              name: true,
              provider: true,
              priceInput: true,
              priceOutput: true,
              updatedAt: true,
              isPending: true,
            },
          })
        : [];

      const priceMap = new Map<string, {
        input: number;
        output: number;
        name: string;
        provider: string;
        updatedAt: string;
      }>(models.map((m) => [m.externalId, {
        input: Number(m.priceInput),
        output: Number(m.priceOutput),
        name: m.name,
        provider: m.provider,
        updatedAt: m.updatedAt.toISOString(),
      }]));

      // 3. 合并 + 重算成本
      const items = grouped
        .filter((g): g is typeof g & { modelId: string } =>
          g.modelId !== null && g.modelId !== UNKNOWN_MODEL_ID,
        )
        .map((g) => {
          const inputN = Number(g._sum.inputTokens ?? 0n);
          const outputN = Number(g._sum.outputTokens ?? 0n);
          const costN = g._sum.costCents ?? 0;
          const price = priceMap.get(g.modelId);

          let liveCost = 0;
          let provider = price?.provider ?? '—';
          let priceSource: 'RANKINGS' | 'FALLBACK' | 'MISSING' = 'MISSING';
          if (price && price.input > 0) {
            liveCost = Math.round((inputN / 1_000_000) * price.input * 100)
                     + Math.round((outputN / 1_000_000) * price.output * 100);
            priceSource = 'RANKINGS';
          } else {
            try {
              const fallback = getPricing(g.modelId);
              liveCost = Math.round((inputN / 1_000_000) * fallback.inputPrice * 100)
                       + Math.round((outputN / 1_000_000) * fallback.outputPrice * 100);
              provider = fallback.provider;
              priceSource = 'FALLBACK';
            } catch {
              priceSource = 'MISSING';
            }
          }

          return {
            modelId: g.modelId,
            name: price?.name ?? g.modelId,
            provider,
            inputTokens: inputN,
            outputTokens: outputN,
            messageCount: g._sum.messageCount ?? 0,
            analysisCount: g._sum.analysisCount ?? 0,
            costCents: costN,
            liveCostCents: liveCost,
            priceUpdatedAt: price?.updatedAt ?? null,
            priceSource,
          };
        })
        .sort((a, b) => b.liveCostCents - a.liveCostCents);

      const priceAsOf = models.length > 0
        ? models.reduce((max, m) => (m.updatedAt > max ? m.updatedAt : max), models[0]!.updatedAt).toISOString()
        : null;

      return {
        items,
        totals: {
          models: items.length,
          inputTokens: items.reduce((s, i) => s + i.inputTokens, 0),
          outputTokens: items.reduce((s, i) => s + i.outputTokens, 0),
          messageCount: items.reduce((s, i) => s + i.messageCount, 0),
          analysisCount: items.reduce((s, i) => s + i.analysisCount, 0),
          costCents: items.reduce((s, i) => s + i.costCents, 0),
          liveCostCents: items.reduce((s, i) => s + i.liveCostCents, 0),
        },
        priceAsOf,
        windowDays: input.days,
      };
    }),

  /**
   * 实时模型价格表
   * 来源：rankings.list（实时） + PRICING_TABLE（兜底）
   */
  pricing: protectedProcedure
    .input(z.object({
      preferLive: z.boolean().default(true),
    }).optional())
    .query(async ({ input }) => {
      const preferLive = input?.preferLive !== false;

      // 显式声明 items 类型，让 push 时 TS 能正确推断联合
      const items: PricingItem[] = [];

      if (preferLive) {
        const live = await prismaBase.model.findMany({
          where: { isActive: true, deletedAt: null },
          select: {
            externalId: true,
            name: true,
            provider: true,
            priceInput: true,
            priceOutput: true,
            updatedAt: true,
            isPending: true,
          },
          orderBy: { provider: 'asc' },
        });

        for (const m of live) {
          items.push({
            name: m.externalId,
            displayName: m.name,
            provider: m.provider,
            inputPrice: Number(m.priceInput),
            outputPrice: Number(m.priceOutput),
            isPending: m.isPending,
            updatedAt: m.updatedAt.toISOString(),
            source: 'RANKINGS',
          });
        }
      }

      // 兜底：合并 PRICING_TABLE 中排行榜未收录的
      const covered = new Set(items.map((i) => i.name));
      for (const p of PRICING_TABLE) {
        if (covered.has(p.name)) continue;
        items.push({ ...p, updatedAt: null, source: 'FALLBACK' });
      }

      return items.sort((a, b) => a.provider.localeCompare(b.provider));
    }),

  /** 单个模型定价（保留向后兼容） */
  pricingFor: protectedProcedure
    .input(z.object({ model: z.string() }))
    .query(({ input }) => getPricing(input.model)),
});
