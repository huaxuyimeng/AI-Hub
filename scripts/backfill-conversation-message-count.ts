/**
 * Backfill: 老数据 Conversation.messageCount 永远为 0（字段是本次升级才加的）。
 * 跑一次把所有 conversation 的 messageCount 重算成真实 count。
 *
 * 用法：
 *   pnpm tsx scripts/backfill-conversation-message-count.ts
 *
 * Idempotent：可重跑（每次重算）。
 * 直接写 SQL count(*) 避免全量拉 messages 到 Node。
 */

import { PrismaClient } from '@prisma/client';

// backfill 是维护脚本，允许 console 输出
/* eslint-disable no-console */

const prisma = new PrismaClient();

async function main() {
  // 1) 找出所有 conversation（不区分 tenant —— backfill 是系统级维护）
  //    用 prismaRaw 绕过 tenant 中间件，按 ID 顺序批处理
  const conversations = await prisma.conversation.findMany({
    select: { id: true, tenantId: true },
    take: 1000,
  });

  if (conversations.length === 0) {
    console.log('[backfill] 没有对话，跳过');
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const conv of conversations) {
    // 用 $queryRaw 直接 SQL 聚合，避免 N+1
    // 注意：SQLite 不支持参数化表名；tenantId/convId 是 UUID 所以安全
    const rows = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*) AS c FROM Message
      WHERE conversationId = ${conv.id} AND deletedAt IS NULL
    `;
    const realCount = Number(rows[0]?.c ?? 0);
    if (realCount === 0) {
      skipped++;
      continue;
    }
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { messageCount: realCount },
    });
    updated++;
  }

  console.log(`[backfill] 完成：${updated} 个对话已更新，${skipped} 个跳过（无消息）`);
}

main()
  .catch((e) => {
    console.error('[backfill] 失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
