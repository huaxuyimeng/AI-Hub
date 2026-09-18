/**
 * AI Models tRPC Router
 *
 * 从 Model 表动态读取模型列表（由 ModelDiscoveryService 维护）。
 * 前端从此处获取实时模型，而非静态 models.ts。
 *
 * 数据流：
 *   discover-models cron → Model 表 → models router → 前端下拉
 */

import { z } from 'zod';
import { protectedProcedure, router } from '../context';
import { prismaRaw } from '../../lib/db';
import { listProviders } from '../../lib/ai/providers';
import { discoverAllProviders } from '../../lib/ai/model-discovery';
import { logger } from '../../lib/observability/logger';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ModelRecord {
  id: string;
  externalId: string;
  name: string;
  provider: string;
  description: string | null;
  priceInput: number;
  priceOutput: number;
  intelligence: number | null;
  speed: number | null;
  isActive: boolean;
  isPending: boolean;
  updatedAt: Date;
}

// ─── Router ────────────────────────────────────────────────────────────────

export const modelsRouter = router({
  /**
   * 列出所有模型（支持按 provider 筛选）。
   * 用于前端模型选择下拉。
   *
   * 策略：
   *   - Model 表有数据 → 返回 DB 中的模型（discover 来的）
   *   - Model 表为空 → 返回 providers.ts 的静态 models 作为 fallback
   */
  list: protectedProcedure
    .input(z.object({
      provider: z.string().optional(),
      /** 默认只返回活跃模型；传 false 可查看所有（含停用/待验证） */
      activeOnly: z.boolean().optional().default(true),
    }).optional())
    .query(async ({ input }) => {
      const { provider, activeOnly = true } = input ?? {};

      // 从 DB 查
      const dbModels = await prismaRaw.model.findMany({
        where: {
          ...(provider ? { provider } : {}),
          ...(activeOnly ? { isActive: true } : {}),
        },
        orderBy: [{ provider: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          externalId: true,
          name: true,
          provider: true,
          description: true,
          priceInput: true,
          priceOutput: true,
          intelligence: true,
          speed: true,
          isActive: true,
          isPending: true,
          updatedAt: true,
        },
      });

      // Model 表为空时（首次使用），fallback 到 providers.ts 静态表
      if (dbModels.length === 0) {
        const providers = listProviders();
        const fallback: ModelRecord[] = [];

        for (const adapter of providers) {
          if (adapter.protocol === 'openai' || adapter.protocol === 'anthropic' || adapter.protocol === 'gemini') {
            for (const modelId of adapter.models) {
              fallback.push({
                id: modelId,
                externalId: modelId,
                name: modelId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                provider: adapter.id,
                description: null,
                priceInput: 0,
                priceOutput: 0,
                intelligence: null,
                speed: null,
                isActive: true,
                isPending: true,
                updatedAt: new Date(),
              });
            }
          }
        }

        return {
          source: 'fallback' as const,
          models: fallback,
          total: fallback.length,
        };
      }

      return {
        source: 'database' as const,
        models: dbModels,
        total: dbModels.length,
      };
    }),

  /**
   * 按 provider 分组的模型列表（用于设置页展示各 provider 下的模型）
   */
  listByProvider: protectedProcedure
    .input(z.object({
      activeOnly: z.boolean().optional().default(true),
    }).optional())
    .query(async ({ input }) => {
      const { activeOnly = true } = input ?? {};

      const dbModels = await prismaRaw.model.findMany({
        where: activeOnly ? { isActive: true } : {},
        orderBy: { name: 'asc' },
        select: {
          id: true,
          externalId: true,
          name: true,
          provider: true,
          description: true,
          priceInput: true,
          priceOutput: true,
          intelligence: true,
          speed: true,
          isActive: true,
          isPending: true,
          updatedAt: true,
        },
      });

      // 按 provider 分组
      const byProvider = new Map<string, ModelRecord[]>();
      for (const m of dbModels) {
        if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
        byProvider.get(m.provider)!.push(m);
      }

      // 补充没数据的 provider（静态表 fallback）
      if (dbModels.length === 0) {
        const providers = listProviders();
        for (const adapter of providers) {
          if (!byProvider.has(adapter.id)) {
            byProvider.set(adapter.id, adapter.models.map((modelId) => ({
              id: modelId,
              externalId: modelId,
              name: modelId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
              provider: adapter.id,
              description: null,
              priceInput: 0,
              priceOutput: 0,
              intelligence: null,
              speed: null,
              isActive: true,
              isPending: true,
              updatedAt: new Date(),
            })));
          }
        }
      }

      return Object.fromEntries(byProvider);
    }),

  /**
   * 手动触发模型发现（管理员操作）。
   * 实际调用 ModelDiscoveryService 从各 Provider 官方 API 拉取最新模型列表。
   */
  discover: protectedProcedure
    .mutation(async () => {
      logger.info('models.discover triggered via tRPC');

      const results = await discoverAllProviders();

      const succeeded = results.filter((r) => r.succeeded).length;
      const failed = results.filter((r) => !r.succeeded).length;
      const totalModels = results.reduce((sum, r) => sum + r.models.length, 0);

      return {
        ok: true,
        providers: { total: results.length, succeeded, failed },
        models: totalModels,
        timestamp: new Date().toISOString(),
      };
    }),

  /**
   * 统计概览（用于排行榜页）
   */
  stats: protectedProcedure.query(async () => {
    const [total, active, pending, byProvider] = await Promise.all([
      prismaRaw.model.count(),
      prismaRaw.model.count({ where: { isActive: true } }),
      prismaRaw.model.count({ where: { isPending: true } }),
      prismaRaw.model.groupBy({
        by: ['provider'],
        _count: { id: true },
        where: { isActive: true },
      }),
    ]);

    return { total, active, pending, byProvider };
  }),
});
