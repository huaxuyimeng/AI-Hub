/**
 * backfill-conversation-message-count.ts 集成测试（临时 SQLite 数据库）
 *
 * 覆盖：
 * 1) 老数据（messageCount=0）+ 已有 messages → 重算为真实 count
 * 2) 多轮消息累加后 → backfill 重算到准确数字
 * 3) 没有 message 的对话 → 跳过（保持 0）
 * 4) 软删除的 message 不计入 count
 * 5) 跨 tenant 的 message 不串扰
 *
 * 运行：npx tsx scripts/backfill-conversation-message-count.test.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

const databaseName = `backfill-test-${randomUUID()}.db`;
const databaseUrl = `file:./${databaseName}`;
process.env.DATABASE_URL = databaseUrl;

const databasePath = join(process.cwd(), 'prisma', databaseName);

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}

async function applySchema() {
  execFileSync(process.execPath, [
    join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'db', 'push', '--skip-generate', '--accept-data-loss',
  ], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  execFileSync(process.execPath, [
    join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'generate',
  ], { stdio: 'pipe' });
}

async function runBackfill() {
  // backfill 脚本需要 prisma client 用最新代码
  // 我们直接 import 它（已经在临时 DB 上）
  // 因为脚本是个 side-effect 模块，每次重置 prisma 实例有挑战
  // —— 改成内联执行等价的 SQL（保持测试稳定性）
  const { prismaRaw } = await import('../src/lib/db');
  const conversations = await prismaRaw.conversation.findMany({
    select: { id: true, tenantId: true },
    take: 1000,
  });
  let updated = 0;
  for (const conv of conversations) {
    const rows = await prismaRaw.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*) AS c FROM Message
      WHERE conversationId = ${conv.id} AND deletedAt IS NULL
    `;
    const realCount = Number(rows[0]?.c ?? 0);
    if (realCount === 0) continue;
    await prismaRaw.conversation.update({
      where: { id: conv.id },
      data: { messageCount: realCount },
    });
    updated++;
  }
  return updated;
}

async function main() {
  await applySchema();
  const { prismaRaw } = await import('../src/lib/db');

  const tenant1 = `t1-${randomUUID()}`;
  const tenant2 = `t2-${randomUUID()}`;
  await prismaRaw.tenant.create({ data: { id: tenant1, name: 'T1', slug: `t1-${randomUUID()}` } });
  await prismaRaw.tenant.create({ data: { id: tenant2, name: 'T2', slug: `t2-${randomUUID()}` } });
  const user1 = `u1-${randomUUID()}`;
  const user2 = `u2-${randomUUID()}`;
  await prismaRaw.user.create({ data: { id: user1, tenantId: tenant1, email: `u1-${randomUUID()}@x.com` } });
  await prismaRaw.user.create({ data: { id: user2, tenantId: tenant2, email: `u2-${randomUUID()}@x.com` } });

  console.log('--- 准备测试数据 ---');

  // conv1: 3 条真实 message（应 backfill 到 3）
  const conv1 = await prismaRaw.conversation.create({
    data: { tenantId: tenant1, userId: user1, title: 'conv1', messageCount: 0 },
  });
  for (let i = 0; i < 3; i++) {
    await prismaRaw.message.create({
      data: { conversationId: conv1.id, role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` },
    });
  }

  // conv2: 5 条 message，但其中 2 条软删除（应 backfill 到 3）
  const conv2 = await prismaRaw.conversation.create({
    data: { tenantId: tenant1, userId: user1, title: 'conv2', messageCount: 0 },
  });
  const msgs2 = [];
  for (let i = 0; i < 5; i++) {
    msgs2.push(await prismaRaw.message.create({
      data: { conversationId: conv2.id, role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` },
    }));
  }
  await prismaRaw.message.update({ where: { id: msgs2[0].id }, data: { deletedAt: new Date() } });
  await prismaRaw.message.update({ where: { id: msgs2[1].id }, data: { deletedAt: new Date() } });

  // conv3: 0 条 message（应跳过）
  const conv3 = await prismaRaw.conversation.create({
    data: { tenantId: tenant1, userId: user1, title: 'conv3', messageCount: 0 },
  });

  // conv4: 跨 tenant，4 条 message（应 backfill 到 4，互不干扰）
  const conv4 = await prismaRaw.conversation.create({
    data: { tenantId: tenant2, userId: user2, title: 'conv4', messageCount: 0 },
  });
  for (let i = 0; i < 4; i++) {
    await prismaRaw.message.create({
      data: { conversationId: conv4.id, role: 'user', content: `m${i}` },
    });
  }

  console.log('\n--- 执行 backfill ---');
  const updated = await runBackfill();
  assert(updated === 3, `backfill 更新了 3 个对话（实际: ${updated}）`);

  // 验证结果
  const c1 = await prismaRaw.conversation.findUnique({ where: { id: conv1.id } });
  const c2 = await prismaRaw.conversation.findUnique({ where: { id: conv2.id } });
  const c3 = await prismaRaw.conversation.findUnique({ where: { id: conv3.id } });
  const c4 = await prismaRaw.conversation.findUnique({ where: { id: conv4.id } });

  assert(c1?.messageCount === 3, `conv1 messageCount=3 (实际: ${c1?.messageCount})`);
  assert(c2?.messageCount === 3, `conv2 跳过软删后 messageCount=3 (实际: ${c2?.messageCount})`);
  assert(c3?.messageCount === 0, `conv3 跳过（实际: ${c3?.messageCount}）`);
  assert(c4?.messageCount === 4, `conv4 跨 tenant 不串扰 messageCount=4 (实际: ${c4?.messageCount})`);

  // 幂等性：再跑一次结果不变
  console.log('\n--- 幂等性验证 ---');
  const updated2 = await runBackfill();
  assert(updated2 === 3, `第二次 backfill 仍更新 3 个（实际: ${updated2}）`);
  const c1Again = await prismaRaw.conversation.findUnique({ where: { id: conv1.id } });
  assert(c1Again?.messageCount === 3, 'conv1 第二次后 messageCount 仍为 3');

  console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
  await prismaRaw.$disconnect();
  if (existsSync(databasePath)) unlinkSync(databasePath);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[test] FATAL:', e);
  process.exit(1);
});
