/**
 * meeting router 集成测试（临时 SQLite 数据库）
 *
 * 覆盖（针对本次修复 + 路由层权限隔离）：
 *
 * A. listExpertRoles
 *    - 返回预置 5 个 expert role（pm / engineer / investor / critic / summarizer）
 *
 * B. create
 *    - 创建带 participants 的会议，maxRounds 仅 multi 模式生效
 *    - participants 少于 2 / 多于 5 被 zod 拒绝
 *
 * C. get / list 权限隔离
 *    - 同 tenant 可读
 *    - 跨 tenant 读不到
 *    - 软删除会议不可读
 *
 * D. delete 权限隔离
 *    - 同 tenant 可软删
 *    - 跨 tenant 软删不到
 *
 * E. reorderParticipants
 *    - 合法重排成功
 *    - 跨 tenant 重排被拦截
 *    - 数量不匹配被拒
 *
 * 注：run / runMultiTurn / conclude 需要真实 LLM 或 mock 框架，本测试不覆盖。
 *
 * 运行：npx tsx src/server/routers/meeting.test.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

const databaseName = `meeting-test-${randomUUID()}.db`;
const databaseUrl = `file:./${databaseName}`;
process.env.DATABASE_URL = databaseUrl;
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.NEXTAUTH_SECRET = 'test-secret-32-chars-long-aaaaaa';
process.env.CRON_SECRET = 'test-cron-secret';
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

function cleanupDb() {
  try {
    if (existsSync(databasePath)) unlinkSync(databasePath);
  } catch {
    // ignore cleanup errors
  }
}

async function main() {
  try {
    cleanupDb();
    await applySchema();
    const { prismaRaw } = await import('../../lib/db');
    const { tenantA, tenantB, userA, userB } = await seedTwoTenants();

    // 创建 mini app router（只挂 meetingRouter，避免触发其他 router 的重依赖）
    const { initTRPC } = await import('@trpc/server');
    const superjson = (await import('superjson')).default;

    const t = initTRPC.create({
      transformer: superjson,
      errorFormatter({ shape }) {
        return shape;
      },
    });

    const { meetingRouter } = await import('./meeting');
    const testAppRouter = t.router({ meeting: meetingRouter });
    type TestCaller = ReturnType<typeof testAppRouter.createCaller>;
    const callerA: TestCaller = testAppRouter.createCaller({
      session: { user: { id: userA, email: 'a@x.com', name: 'A' }, expires: '' },
      tenantId: tenantA,
    } as any);
    const callerB: TestCaller = testAppRouter.createCaller({
      session: { user: { id: userB, email: 'b@x.com', name: 'B' }, expires: '' },
      tenantId: tenantB,
    } as any);

    // ============================================================
    // A. listExpertRoles
    // ============================================================
    console.log('\n=== A. listExpertRoles ===');
    const roles = await callerA.meeting.listExpertRoles();
    const roleKeys = roles.map((r) => r.key).sort();
    assert(
      roleKeys.length >= 5,
      `A.1: 至少 5 个预置 expert role（实际 ${roleKeys.length}）`,
    );
    for (const expectedKey of ['pm', 'engineer', 'investor', 'critic', 'summarizer']) {
      assert(roleKeys.includes(expectedKey), `A.2: 包含预置 role "${expectedKey}"`);
    }

    // 幂等性：再次调用不会重复
    const roles2 = await callerA.meeting.listExpertRoles();
    assert(roles2.length === roles.length, 'A.3: 幂等（重复调用数量不变）');

    // ============================================================
    // B. create
    // ============================================================
    console.log('\n=== B. create ===');
    const created = await callerA.meeting.create({
      topic: '设计一个 MVP 会议平台',
      title: 'MVP 平台设计',
      hostModel: 'gpt-4o',
      mode: 'single',
      participants: [
        { role: '产品经理', model: 'gpt-4o' },
        { role: '工程师', model: 'claude-4' },
      ],
    });
    assert(created.id.length === 36, 'B.1: create 返回 UUID id');
    assert(created.status === 'ACTIVE', 'B.2: 初始 status=ACTIVE');
    assert(created.participants.length === 2, 'B.3: 2 个 participants');
    assert(created.maxRounds === null, 'B.4: SINGLE 模式存 null');

    // multi 模式 + maxRounds
    const createdMulti = await callerA.meeting.create({
      topic: 'AI 模型排行榜的可行性分析',
      hostModel: 'gpt-4o',
      mode: 'multi',
      maxRounds: 3,
      participants: [
        { role: '产品经理', model: 'gpt-4o' },
        { role: '工程师', model: 'claude-4' },
        { role: '怀疑论者', model: 'deepseek-v3' },
      ],
    });
    assert(createdMulti.maxRounds === 3, 'B.5: MULTI 模式 maxRounds=3');

    // participants 太少被 zod 拒绝
    let tooFewRejected = false;
    try {
      await callerA.meeting.create({
        topic: '只有 1 个参与者',
        mode: 'single',
        participants: [{ role: 'PM', model: 'gpt-4o' }],
      });
    } catch {
      tooFewRejected = true;
    }
    assert(tooFewRejected, 'B.6: 1 个 participant 被 zod 拒绝');

    // participants 太多被 zod 拒绝
    let tooManyRejected = false;
    try {
      await callerA.meeting.create({
        topic: '超过 5 个参与者',
        mode: 'single',
        participants: Array.from({ length: 6 }, (_, i) => ({
          role: `角色${i + 1}`,
          model: 'gpt-4o',
        })),
      });
    } catch {
      tooManyRejected = true;
    }
    assert(tooManyRejected, 'B.7: 6 个 participants 被 zod 拒绝');

    // ============================================================
    // C. get / list 权限隔离
    // ============================================================
    console.log('\n=== C. get / list 权限隔离 ===');

    // C.1 同 tenant 可读
    const gotA = await callerA.meeting.get({ id: created.id });
    assert(gotA.id === created.id, 'C.1: 同 tenant 可 get');

    // C.2 跨 tenant get 不到
    let crossTenantGetBlocked = false;
    try {
      await callerB.meeting.get({ id: created.id });
    } catch (e: any) {
      if (e.code === 'NOT_FOUND') crossTenantGetBlocked = true;
    }
    assert(crossTenantGetBlocked, 'C.2: 跨 tenant get 被拦截（NOT_FOUND）');

    // C.3 list 只返回当前 user 的会议
    // 当前阶段已创建：A 有 B.1/B.5 两个会议（其它在 D / E 段）
    // B 暂无（已被 C.3 之前的 _ 测试如果新增了 B 的）
    const listA = await callerA.meeting.list({});
    const listB = await callerB.meeting.list({});
    // 显式增加 1 个 B 的会议，确保 B 不空
    await callerB.meeting.create({
      topic: 'B 的会议',
      mode: 'single',
      participants: [
        { role: 'PM', model: 'gpt-4o' },
        { role: 'Dev', model: 'claude-4' },
      ],
    });
    const listAAfter = await callerA.meeting.list({});
    const listBAfter = await callerB.meeting.list({});
    assert(listA.length === 2, `C.3: A 当前看到 2 个会议（实际 ${listA.length}）`);
    assert(listB.length === 0, `C.3: B 当前看到 0 个会议（实际 ${listB.length}）`);
    assert(listBAfter.length === 1, `C.3: 新建 B 会议后 B 看到 1 个（实际 ${listBAfter.length}）`);
    assert(listAAfter.length === 2, `C.3: A 仍看到 2 个会议（实际 ${listAAfter.length}）`);
    // 总数对齐（list + DB count）
    const totalA = await prismaRaw.meeting.count({ where: { tenantId: tenantA, userId: userA, deletedAt: null } });
    const totalB = await prismaRaw.meeting.count({ where: { tenantId: tenantB, userId: userB, deletedAt: null } });
    assert(listAAfter.length === totalA, `C.3: A list 与 DB count 一致`);
    assert(listBAfter.length === totalB, `C.3: B list 与 DB count 一致`);
    void listA; void listB;

    // ============================================================
    // D. delete 软删除
    // ============================================================
    console.log('\n=== D. delete 软删除 ===');

    // D.1 同 tenant 可软删
    const targetMeeting = await callerA.meeting.create({
      topic: '将被删除的会议',
      mode: 'single',
      participants: [
        { role: 'PM', model: 'gpt-4o' },
        { role: 'Dev', model: 'claude-4' },
      ],
    });
    await callerA.meeting.delete({ id: targetMeeting.id });
    // 再次 get 应该 NOT_FOUND
    let afterDeleteBlocked = false;
    try {
      await callerA.meeting.get({ id: targetMeeting.id });
    } catch (e: any) {
      if (e.code === 'NOT_FOUND') afterDeleteBlocked = true;
    }
    assert(afterDeleteBlocked, 'D.1: 软删除后 get 被拦截');

    // D.2 跨 tenant 删不到
    const otherMeeting = await callerA.meeting.create({
      topic: '跨租户测试',
      mode: 'single',
      participants: [
        { role: 'PM', model: 'gpt-4o' },
        { role: 'Dev', model: 'claude-4' },
      ],
    });
    let crossTenantDeleteBlocked = false;
    try {
      await callerB.meeting.delete({ id: otherMeeting.id });
    } catch (e: any) {
      if (e.code === 'NOT_FOUND') crossTenantDeleteBlocked = true;
    }
    assert(crossTenantDeleteBlocked, 'D.2: 跨 tenant delete 被拦截');
    // A 的会议仍然存在
    const stillExists = await callerA.meeting.get({ id: otherMeeting.id });
    assert(stillExists.id === otherMeeting.id, 'D.2: 跨 tenant delete 不影响 A 的数据');

    // ============================================================
    // E. reorderParticipants
    // ============================================================
    console.log('\n=== E. reorderParticipants ===');

    const reorderTarget = await callerA.meeting.create({
      topic: '重排参与者测试',
      mode: 'single',
      participants: [
        { role: 'A', model: 'gpt-4o' },
        { role: 'B', model: 'claude-4' },
        { role: 'C', model: 'deepseek-v3' },
      ],
    });
    const parts = await prismaRaw.meetingParticipant.findMany({
      where: { meetingId: reorderTarget.id },
      orderBy: { order: 'asc' },
    });
    const reversedIds = [...parts].reverse().map((p) => p.id);

    // E.1 合法重排成功
    await callerA.meeting.reorderParticipants({
      meetingId: reorderTarget.id,
      orderedIds: reversedIds,
    });
    const partsAfter = await prismaRaw.meetingParticipant.findMany({
      where: { meetingId: reorderTarget.id },
      orderBy: { order: 'asc' },
    });
    assert(
      partsAfter.map((p) => p.id).join(',') === reversedIds.join(','),
      'E.1: 重排 order 写回成功',
    );

    // E.2 跨 tenant 重排被拒
    let crossTenantReorderBlocked = false;
    try {
      await callerB.meeting.reorderParticipants({
        meetingId: reorderTarget.id,
        orderedIds: reversedIds,
      });
    } catch (e: any) {
      if (e.code === 'NOT_FOUND' || e.code === 'CONFLICT') {
        crossTenantReorderBlocked = true;
      }
    }
    assert(crossTenantReorderBlocked, 'E.2: 跨 tenant reorder 被拦截');

    // E.3 数量不匹配被拒
    let countMismatchRejected = false;
    try {
      await callerA.meeting.reorderParticipants({
        meetingId: reorderTarget.id,
        orderedIds: [...reversedIds, randomUUID()], // 多了一个
      });
    } catch (e: any) {
      if (e.code === 'CONFLICT' || e.code === 'BAD_REQUEST') {
        countMismatchRejected = true;
      }
    }
    assert(countMismatchRejected, 'E.3: 数量不匹配被拒');

    // ============================================================
    // 结果汇总
    // ============================================================
    console.log(`\n=== meeting router 测试结果: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Unexpected error:', err);
    process.exit(1);
  } finally {
    cleanupDb();
    // 退出前给 SQLite 文件句柄一点时间释放
    setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
  }
}

void main();
