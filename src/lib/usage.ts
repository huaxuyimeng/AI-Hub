// 来源：d:\1Money\design\AI集成.md §10.1 recordUsage
// 批次 B1 后：UsageStat 的 @@unique([tenantId, date, modelId]) 用 transaction + upsert。
// 批次 C19：在 update / create 分支都补 messageCount increment。
// 批次 C20：包在 $transaction 里 + retry-on-P2002 兜底并发竞态。
// Q2 修复：加 kind 参数，区分 chat 和 analysis，分别更新对应计数
//
// 设计取舍（2026-08-30 升级）：
//   - 唯一键升级为 (tenantId, date, modelId)，modelId 可为 null（历史/未识别模型）
//   - SQLite 允许多 NULL 共存同一 (tenantId, date)，迁移安全
//   - null modelId 会落到独立行（被 byModel 查询过滤掉），但仍计入"全租户当日总量"
//
// 未来演进：
//   - 若要做月结账/历史重算，建议引入 UsageEvent（不可变事件）+ UsageSnapshot（月快照）
//     UsageStat 仅做"今日实时聚合"用。这样能保留完整历史、避免聚合表的歧义。

import { Prisma } from '@prisma/client';
import { prismaRaw } from './db';

// 新写入以固定值代表未知模型，避免 SQLite 在复合唯一键中把 NULL 视为彼此不同。
// modelId 字段保留可空以兼容迁移前的历史行。
export const UNKNOWN_MODEL_ID = '__unknown_model__';

interface UsageParams {
  tenantId: string;
  /** 模型 externalId（如 'gpt-4o'）。null = 未知/历史数据，落到独立行 */
  modelId?: string | null;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  /** Q2 修复：区分调用来源，analysisCount / messageCount 各自分开计数 */
  kind?: 'chat' | 'analysis';
}

const MAX_RETRIES = 3;

export async function recordUsage(
  params: UsageParams,
  client: typeof prismaRaw = prismaRaw,
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const costIncrement = Math.round(params.cost * 100);
  const isAnalysis = params.kind === 'analysis';
  const isChat = params.kind === 'chat';
  const modelId = params.modelId ?? UNKNOWN_MODEL_ID;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // H-2 修复：去掉冗余 $transaction 包装——upsert 本身是原子的，
      //        单条 upsert 不需要 transaction。重试逻辑保留以兜底并发竞态。
      await client.usageStat.upsert({
        where: {
          tenantId_date_modelId: {
            tenantId: params.tenantId,
            date: today,
            modelId,
          },
        },
        update: {
          messageCount: isChat ? { increment: 1 } : undefined,
          analysisCount: isAnalysis ? { increment: 1 } : undefined,
          inputTokens: { increment: params.inputTokens },
          outputTokens: { increment: params.outputTokens },
          costCents: { increment: costIncrement },
        },
        create: {
          tenantId: params.tenantId,
          modelId,
          date: today,
          messageCount: isChat ? 1 : 0,
          analysisCount: isAnalysis ? 1 : 0,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          costCents: costIncrement,
        },
      });
      return;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        attempt < MAX_RETRIES - 1
      ) {
        continue;
      }
      throw e;
    }
  }
}