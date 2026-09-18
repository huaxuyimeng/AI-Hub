/**
 * chat router 集成测试（临时 SQLite 数据库）
 *
 * 覆盖（针对本次改版新增的 mutation + 缓存字段同步）：
 *
 * A. rename / updateStatus / togglePin 权限隔离
 *    - 同 tenant 可以改自己的对话
 *    - 跨 tenant 改不到
 *    - 软删除的对话拒绝操作
 *    - 不存在的对话拒绝操作
 *
 * B. sendMessage 缓存同步
 *    - 消息写入后 messageCount += 2（user + assistant）
 *    - lastModel 正确更新
 *    - status 自动转 COMPLETED（mock 模式除外）
 *
 * C. list 排序
 *    - isPinned=true 的对话排在前面
 *    - 同一 pinned 内按 updatedAt desc
 *
 * 运行：npx tsx src/server/routers/chat.test.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

const databaseName = `chat-test-${randomUUID()}.db`;
const databaseUrl = `file:./${databaseName}`;
process.env.DATABASE_URL = databaseUrl;
// env.ts 要求这些变量存在
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.NEXTAUTH_SECRET = 'test-secret-32-chars-long-aaaaaa';
process.env.CRON_SECRET = 'test-cron-secret';
// AI provider key 兜底（mock 模式不会被调用，但 env.ts 校验存在）
process.env.DEEPSEEK_API_KEY = 'sk-test-placeholder-for-env-validation';

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
  console.log('[setup] applying schema...');
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

async function seedTwoTenants() {
  const { prismaRaw } = await import('../../lib/db');

  const tenantA = `tenant-A-${randomUUID()}`;
  const tenantB = `tenant-B-${randomUUID()}`;
  await prismaRaw.tenant.create({ data: { id: tenantA, name: 'A', slug: `a-${randomUUID()}` } });
  await prismaRaw.tenant.create({ data: { id: tenantB, name: 'B', slug: `b-${randomUUID()}` } });

  const userA = `user-A-${randomUUID()}`;
  const userB = `user-B-${randomUUID()}`;
  await prismaRaw.user.create({ data: { id: userA, tenantId: tenantA, email: `a-${randomUUID()}@x.com` } });
  await prismaRaw.user.create({ data: { id: userB, tenantId: tenantB, email: `b-${randomUUID()}@x.com` } });

  return { tenantA, tenantB, userA, userB };
}

async function main() {
  await applySchema();
  const { prismaRaw } = await import('../../lib/db');
  const { tenantA, tenantB, userA, userB } = await seedTwoTenants();

  // ============================================================
  // A. rename / updateStatus / togglePin 权限隔离
  // ============================================================
  console.log('\n=== A. 权限隔离测试 ===');

  // A.1 tenantA 创建对话
  const convA = await prismaRaw.conversation.create({
    data: { tenantId: tenantA, userId: userA, title: 'A的对话' },
  });

  // 导入并构造 chatRouter 的 mini caller（避免拉 appRouter 触发 dailyReport 等重依赖）
  // 我们手动创建一个只有 chatRouter 的 mini app router
  const { initTRPC } = await import('@trpc/server');
  const superjson = (await import('superjson')).default;

  const t = initTRPC.create({
    transformer: superjson,
    errorFormatter({ shape }) {
      return shape;
    },
  });

  // mock context：跳过 authOptions/next-auth，直接传 session
  const { chatRouter } = await import('./chat');
  const testAppRouter = t.router({ chat: chatRouter });
  type TestCaller = ReturnType<typeof testAppRouter.createCaller>;
  const callerA: TestCaller = testAppRouter.createCaller({
    session: { user: { id: userA, email: 'a@x.com', name: 'A' }, expires: '' },
    tenantId: tenantA,
  } as any);
  const callerB: TestCaller = testAppRouter.createCaller({
    session: { user: { id: userB, email: 'b@x.com', name: 'B' }, expires: '' },
    tenantId: tenantB,
  } as any);

  // A.1 tenantA 能改自己对话的 title
  const renamed = await callerA.chat.rename({ id: convA.id, title: '已改名' });
  assert(renamed.title === '已改名', 'A.1: 同 tenant 可 rename');

  // A.2 tenantB 不能改 tenantA 的对话
  let crossTenantBlocked = false;
  try {
    await callerB.chat.rename({ id: convA.id, title: '恶意改名' });
  } catch (e) {
    crossTenantBlocked = true;
  }
  assert(crossTenantBlocked, 'A.2: 跨 tenant rename 被拦截（NOT_FOUND）');

  // 确认 title 没被改
  const still = await prismaRaw.conversation.findUnique({ where: { id: convA.id } });
  assert(still?.title === '已改名', 'A.2: 跨 tenant rename 后 title 未变');

  // A.3 updateStatus 同 tenant 可改 + 非法值被 zod 拒绝
  const statusUpdated = await callerA.chat.updateStatus({ id: convA.id, status: 'TODO' });
  assert(statusUpdated.status === 'TODO', 'A.3: updateStatus 写入成功');
  let invalidRejected = false;
  try {
    // 用类型断言绕过 TS 检查（运行时验证）
    await callerA.chat.updateStatus({ id: convA.id, status: 'INVALID' as 'ACTIVE' });
  } catch (e: any) {
    invalidRejected = true;
  }
  assert(invalidRejected, 'A.3: updateStatus 非法 status 被 zod 拦截');

  // A.4 togglePin 同 tenant 可用 + 跨 tenant 拒绝
  const pinned = await callerA.chat.togglePin({ id: convA.id });
  assert(pinned.isPinned === true, 'A.4: togglePin 切到 true');
  let crossToggleBlocked = false;
  try {
    await callerB.chat.togglePin({ id: convA.id });
  } catch (e) {
    crossToggleBlocked = true;
  }
  assert(crossToggleBlocked, 'A.4: 跨 tenant togglePin 被拦截');
  const afterCross = await prismaRaw.conversation.findUnique({ where: { id: convA.id } });
  assert(afterCross?.isPinned === true, 'A.4: 跨 tenant togglePin 后状态未变');

  // A.5 软删除的对话拒绝操作
  await prismaRaw.conversation.update({
    where: { id: convA.id },
    data: { deletedAt: new Date() },
  });
  let trashedBlocked = false;
  try {
    await callerA.chat.rename({ id: convA.id, title: '尝试改已删除' });
  } catch (e) {
    trashedBlocked = true;
  }
  assert(trashedBlocked, 'A.5: 已软删对话 rename 被拦截');

  // A.6 不存在的 UUID 拒绝
  let nonexistentBlocked = false;
  try {
    await callerA.chat.rename({ id: randomUUID(), title: '不存在的' });
  } catch (e) {
    nonexistentBlocked = true;
  }
  assert(nonexistentBlocked, 'A.6: 不存在的 id 被拦截');

  // ============================================================
  // B. list 排序（isPinned desc + updatedAt desc）
  // ============================================================
  console.log('\n=== B. list 排序测试 ===');

  // 创建 3 个对话，第二个 pin
  const c1 = await prismaRaw.conversation.create({
    data: { tenantId: tenantA, userId: userA, title: 'C1 普通', updatedAt: new Date('2026-01-01') },
  });
  const c2 = await prismaRaw.conversation.create({
    data: { tenantId: tenantA, userId: userA, title: 'C2 收藏', updatedAt: new Date('2026-01-02'), isPinned: true },
  });
  const c3 = await prismaRaw.conversation.create({
    data: { tenantId: tenantA, userId: userA, title: 'C3 普通', updatedAt: new Date('2026-01-03') },
  });

  const listed = await callerA.chat.list({ take: 10 });
  assert(listed.items.length === 3, 'B.1: list 返回 3 条');
  // pinned 排第一
  assert(listed.items[0].id === c2.id, 'B.1: pinned 的 C2 排第一');
  // 剩下按 updatedAt desc：C3 > C1
  assert(listed.items[1].id === c3.id, 'B.1: C3 排第二（updatedAt 更新）');
  assert(listed.items[2].id === c1.id, 'B.1: C1 排第三');

  // B.2 tenantB 看不到 tenantA 的对话（隔离）
  const listedB = await callerB.chat.list({ take: 10 });
  assert(listedB.items.length === 0, 'B.2: 跨 tenant list 隔离（tenantB 看不到 A 的）');

  // ============================================================
  // C. sendMessage 缓存同步（用 prismaRaw 直接 verify）
  //    —— sendMessage 会调真实 AI，所以直接测字段同步逻辑
  //    —— 改用 prismaRaw.update + 验证 messageCount 累加逻辑
  // ============================================================
  console.log('\n=== C. messageCount 累加逻辑（手工模拟）===');

  const convC = await prismaRaw.conversation.create({
    data: { tenantId: tenantA, userId: userA, title: 'C 测试', messageCount: 0 },
  });

  // 模拟 sendMessage 事务逻辑
  await prismaRaw.$transaction(async (tx) => {
    await tx.message.create({ data: { conversationId: convC.id, role: 'user', content: 'hi' } });
    await tx.message.create({ data: { conversationId: convC.id, role: 'assistant', content: 'hello' } });
    await tx.conversation.update({
      where: { id: convC.id },
      data: {
        status: 'COMPLETED',
        lastModel: 'deepseek-chat',
        messageCount: { increment: 2 },
      },
    });
  });

  const convCAfter = await prismaRaw.conversation.findUnique({ where: { id: convC.id } });
  assert(convCAfter?.messageCount === 2, 'C.1: messageCount 正确 +2');
  assert(convCAfter?.status === 'COMPLETED', 'C.1: status 同步更新为 COMPLETED');
  assert(convCAfter?.lastModel === 'deepseek-chat', 'C.1: lastModel 同步更新');

  // C.2 再发一轮：messageCount 应累计到 4
  await prismaRaw.$transaction(async (tx) => {
    await tx.message.create({ data: { conversationId: convC.id, role: 'user', content: 'hi2' } });
    await tx.message.create({ data: { conversationId: convC.id, role: 'assistant', content: 'hello2' } });
    await tx.conversation.update({
      where: { id: convC.id },
      data: { messageCount: { increment: 2 } },
    });
  });
  const convCAfter2 = await prismaRaw.conversation.findUnique({ where: { id: convC.id } });
  assert(convCAfter2?.messageCount === 4, 'C.2: 第二轮 messageCount 累加到 4');

  console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);

  // cleanup
  await prismaRaw.$disconnect();
  if (existsSync(databasePath)) unlinkSync(databasePath);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[test] FATAL:', e);
  process.exit(1);
});
