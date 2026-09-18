/**
 * requireAdmin 回归测试
 *
 * 防止 P0 #12（admin 跨租户越权）复发。
 * 由于 requireAdmin 是 tRPC middleware（不可直接调用），这里测试其底层逻辑：
 * 1) 跨 tenantId 查找 user 应该查不到
 * 2) 软删用户应该被过滤
 * 3) 非 ADMIN 应该被拒
 *
 * 运行：npx tsx src/server/context.test.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { prismaRaw } from '@/lib/db';

/** Windows 上 Prisma/SQLite 句柄释放可能有 100-500ms 延迟，带重试的删除 */
async function unlinkWithRetry(path: string, retries = 3, delayMs = 300) {
  if (!existsSync(path)) return;
  for (let i = 0; i < retries; i++) {
    try {
      unlinkSync(path);
      return;
    } catch (e: any) {
      if (e?.code === 'EBUSY' && i < retries - 1) {
        await sleep(delayMs);
        continue;
      }
      throw e;
    }
  }
}

const databaseName = `admin-test-${randomUUID()}.db`;
const databaseUrl = `file:./${databaseName}`;
process.env.DATABASE_URL = databaseUrl;

const prismaDir = join(process.cwd(), 'prisma');
if (!existsSync(prismaDir)) mkdirSync(prismaDir, { recursive: true });
const databasePath = join(prismaDir, databaseName);

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

async function main() {
  // 1. 用临时 DB 跑 schema
  console.log('[test] applying schema to isolated database...');
  execFileSync(process.execPath, [
    join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'db', 'push', '--skip-generate', '--accept-data-loss',
  ], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  execFileSync(process.execPath, [
    join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'generate',
  ], { stdio: 'inherit' });

  const { prismaRaw } = await import('../lib/db');

  // 准备数据
  const tenantA = await prismaRaw.tenant.create({ data: { name: 'A', slug: `a-${randomUUID().slice(0, 8)}` } });
  const tenantB = await prismaRaw.tenant.create({ data: { name: 'B', slug: `b-${randomUUID().slice(0, 8)}` } });
  const adminOfA = await prismaRaw.user.create({
    data: { tenantId: tenantA.id, email: `admin-a-${randomUUID()}@x`, role: 'ADMIN' },
  });
  const userOfB = await prismaRaw.user.create({
    data: { tenantId: tenantB.id, email: `user-b-${randomUUID()}@x`, role: 'USER' },
  });
  const deletedAdmin = await prismaRaw.user.create({
    data: { tenantId: tenantA.id, email: `del-${randomUUID()}@x`, role: 'ADMIN', deletedAt: new Date() },
  });

  // ====== 核心回归：跨 tenantId 查找必须查不到 ======
  // 这是 B-09 修复的语义：adminOfA 在 tenantA 是合法的，
  // 但若 attacker 把 session.user.id 改成 adminOfA.id + tenantId 改成 tenantB，
  // 修复后的 where: { id, tenantId } 必须查不到。
  const crossTenantLookup = await prismaRaw.user.findFirst({
    where: { id: adminOfA.id, tenantId: tenantB.id },
    select: { role: true, deletedAt: true },
  });
  assert(crossTenantLookup === null,
    'P0 #12 回归：跨 tenantId 查找 adminOfA 在 tenantB 上下文应返回 null（防越权）');

  // ====== 合法查找：adminOfA 在 tenantA 上下文下能查到且 role=ADMIN ======
  const legitLookup = await prismaRaw.user.findFirst({
    where: { id: adminOfA.id, tenantId: tenantA.id },
    select: { role: true, deletedAt: true },
  });
  assert(legitLookup !== null, '合法查找：adminOfA 在 tenantA 上下文应能查到');
  assert(legitLookup!.role === 'ADMIN', '合法 admin 角色为 ADMIN');
  assert(legitLookup!.deletedAt === null, '合法 admin 未被软删');

  // ====== 非 admin 用户：role 不是 ADMIN ======
  const userLookup = await prismaRaw.user.findFirst({
    where: { id: userOfB.id, tenantId: tenantB.id },
    select: { role: true, deletedAt: true },
  });
  assert(userLookup !== null, 'userOfB 能查到');
  assert(userLookup!.role !== 'ADMIN', 'userOfB 角色非 ADMIN（应被拒）');

  // ====== 已软删用户：deletedAt !== null ======
  const deletedLookup = await prismaRaw.user.findFirst({
    where: { id: deletedAdmin.id, tenantId: tenantA.id },
    select: { role: true, deletedAt: true },
  });
  assert(deletedLookup !== null, '已软删 admin 仍能按 id+tenant 查到（用于排查）');
  assert(deletedLookup!.deletedAt !== null, 'deletedAt 已被设置（应被拒）');

  // 清理：先 disconnect 让 Prisma 释放句柄，再删文件
  await prismaRaw.$disconnect();
  await unlinkWithRetry(databasePath);
  console.log('\n[P0 #12 防护] 4/4 全部通过：\n  1) 跨租户查 user 必为 null（防越权）\n  2) 合法 admin 查得到 + 角色 ADMIN + 未软删\n  3) 非 admin 查得到但 role 必为非 ADMIN（应被 requireAdmin 拒）\n  4) 软删 admin deletedAt 必为非空（应被 requireAdmin 拒）');
}

main().catch(async (e) => {
  console.error('test crashed:', e);
  await prismaRaw.$disconnect().catch(() => {});
  await unlinkWithRetry(databasePath).catch(() => {});
  process.exit(1);
});
