// 来源：d:\1Money\design\API设计.md §六 usageRouter
// MVP：按日聚合 UsageStat + model pricing

import { z } from 'zod';
import { router, protectedProcedure } from '../context';
import { createTenantPrisma } from '../../lib/db';
import { PRICING_TABLE, getPricing } from '../../lib/ai/pricing';

export const usageRouter = router({
  /** 当前租户的最近 N 天每日用量 */
  recent: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - input.days + 1);

      const rows = await prisma.usageStat.findMany({
        where: { date: { gte: since } },
        orderBy: { date: 'asc' },
      });

      const totalInput = rows.reduce((s, r) => s + Number(r.inputTokens), 0);
      const totalOutput = rows.reduce((s, r) => s + Number(r.outputTokens), 0);
      const totalMessages = rows.reduce((s, r) => s + r.messageCount, 0);
      // Q2 修复：聚合 analysisCount，前端可展示"分析次数"
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

  /** 模型定价表 */
  pricing: protectedProcedure.query(() => {
    return PRICING_TABLE.map((p) => ({
      ...p,
      // 给前端方便显示的 fmt
    }));
  }),

  /** 单个模型定价 */
  pricingFor: protectedProcedure
    .input(z.object({ model: z.string() }))
    .query(({ input }) => getPricing(input.model)),
});