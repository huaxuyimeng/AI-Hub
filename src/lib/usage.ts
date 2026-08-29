// 来源：d:\1Money\design\AI集成.md §10.1 recordUsage
// 批次 B1 后：UsageStat 的 @@unique([tenantId, date]) 已被替换为 partial unique index，
// upsert 不再适用。改为 事务 + create + retry-on-P2002 兜底。
// 批次 C19：在 update / create 分支都补 messageCount increment。
// 批次 C20：包在 $transaction 里 + retry-on-P2002 兜底并发竞态。
// Q2 修复：加 kind 参数，区分 chat 和 analysis，分别更新对应计数

import { Prisma } from '@prisma/client';
import { prismaRaw } from './db';

interface UsageParams {
  tenantId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  /** Q2 修复：区分调用来源，analysisCount / messageCount 各自分开计数 */
  kind?: 'chat' | 'analysis';
}

const MAX_RETRIES = 3;

export async function recordUsage(params: UsageParams): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const costIncrement = Math.round(params.cost * 100);
  const isAnalysis = params.kind === 'analysis';
  const isChat = params.kind === 'chat';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await prismaRaw.$transaction(async (tx) => {
        const existing = await tx.usageStat.findFirst({
          where: {
            tenantId: params.tenantId,
            date: today,
          },
        });

        if (existing) {
          // Q2 修复：按 kind 增量对应计数器，不再全部记 messageCount
          await tx.usageStat.update({
            where: { id: existing.id },
            data: {
              messageCount: isChat ? { increment: 1 } : undefined,
              analysisCount: isAnalysis ? { increment: 1 } : undefined,
              inputTokens: { increment: params.inputTokens },
              outputTokens: { increment: params.outputTokens },
              costCents: { increment: costIncrement },
            },
          });
        } else {
          // Q2 修复：create 时初始化对应计数器
          await tx.usageStat.create({
            data: {
              tenantId: params.tenantId,
              date: today,
              messageCount: isChat ? 1 : 0,
              analysisCount: isAnalysis ? 1 : 0,
              inputTokens: params.inputTokens,
              outputTokens: params.outputTokens,
              costCents: costIncrement,
            },
          });
        }
      });
      return;
    } catch (e) {
      // C20：并发竞态兜底 - 另一个并发请求抢先 create 了同 (tenantId, date) 行
      // 重试时 findFirst 会命中，分支走 update
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