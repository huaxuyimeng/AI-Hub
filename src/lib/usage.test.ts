/**
 * recordUsage 集成测试（临时 SQLite 数据库）
 *
 * 运行：npx tsx src/lib/usage.test.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

const databaseName = `usage-test-${randomUUID()}.db`;
const databasePath = join(process.cwd(), 'prisma', databaseName);
const databaseUrl = `file:./${databaseName}`;
process.env.DATABASE_URL = databaseUrl;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

function utcToday() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

async function main() {
  execFileSync(process.execPath, [
    join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'db',
    'push',
    '--schema=prisma/schema.prisma',
    '--skip-generate',
  ], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const { prismaRaw } = await import('./db');
  const { recordUsage, UNKNOWN_MODEL_ID } = await import('./usage');
  const tenantId = `tenant-${randomUUID()}`;
  await prismaRaw.tenant.create({
    data: { id: tenantId, name: 'Usage Test', slug: `usage-test-${randomUUID()}` },
  });

  console.log('--- 生产 recordUsage：同模型累加 ---');
  await recordUsage({ tenantId, modelId: 'deepseek-chat', inputTokens: 100, outputTokens: 50, cost: 0.01, kind: 'chat' });
  await recordUsage({ tenantId, modelId: 'deepseek-chat', inputTokens: 200, outputTokens: 100, cost: 0.02, kind: 'chat' });
  const deepseek = await prismaRaw.usageStat.findUnique({
    where: { tenantId_date_modelId: { tenantId, date: utcToday(), modelId: 'deepseek-chat' } },
  });
  assert(deepseek?.messageCount === 2, '同一模型的消息数正确累加');
  assert(Number(deepseek?.inputTokens) === 300, '同一模型的输入 token 正确累加');
  assert(deepseek?.costCents === 3, '同一模型的成本正确累加');
  assert(Number(deepseek?.outputTokens) === 150, '同一模型的输出 token 正确累加（H-36 边界验证）');

  console.log('--- 不同模型与未知模型隔离 ---');
  await recordUsage({ tenantId, modelId: 'moonshot-v1-8k', inputTokens: 500, outputTokens: 200, cost: 0.05, kind: 'analysis' });
  await recordUsage({ tenantId, inputTokens: 50, outputTokens: 25, cost: 0.005 });
  await recordUsage({ tenantId, modelId: null, inputTokens: 150, outputTokens: 75, cost: 0.015 });
  const rows = await prismaRaw.usageStat.findMany({ where: { tenantId }, orderBy: { modelId: 'asc' } });
  assert(rows.length === 3, '不同模型和未知模型分别占用一条日汇总记录');
  const unknown = rows.find((row) => row.modelId === UNKNOWN_MODEL_ID);
  assert(Number(unknown?.inputTokens) === 200, '未知模型通过保留标识正确合并');
  assert(Number(unknown?.outputTokens) === 100, '未知模型输出 token 正确合并（H-36）');
  // 逐次舍入语义：每次调用独立 round 到 cents（0.005→1、0.015→2），合计 3
  assert(unknown?.costCents === 3, '未知模型成本正确合并（H-36）');
  const kimi = rows.find((row) => row.modelId === 'moonshot-v1-8k');
  assert(kimi?.analysisCount === 1 && kimi.messageCount === 0, '分析调用只增加分析计数');
  assert(Number(kimi?.inputTokens) === 500, 'kimi 输入 token 记录正确（H-36）');
  assert(Number(kimi?.outputTokens) === 200, 'kimi 输出 token 记录正确（H-36）');
  assert(kimi?.costCents === 5, 'kimi 成本记录正确（H-36）');

  console.log('--- 并发写入 ---');
  const concurrentTenantId = `tenant-${randomUUID()}`;
  await prismaRaw.tenant.create({
    data: { id: concurrentTenantId, name: 'Concurrent Usage Test', slug: `usage-race-${randomUUID()}` },
  });
  const results = await Promise.allSettled([
    recordUsage({ tenantId: concurrentTenantId, modelId: 'deepseek-reasoner', inputTokens: 100, outputTokens: 50, cost: 0.01 }),
    recordUsage({ tenantId: concurrentTenantId, modelId: 'deepseek-reasoner', inputTokens: 200, outputTokens: 100, cost: 0.02 }),
  ]);
  assert(results.every((result) => result.status === 'fulfilled'), '并发写入全部成功');
  const concurrent = await prismaRaw.usageStat.findUnique({
    where: { tenantId_date_modelId: { tenantId: concurrentTenantId, date: utcToday(), modelId: 'deepseek-reasoner' } },
  });
  assert(Number(concurrent?.inputTokens) === 300, '并发写入聚合为单行');
  assert(Number(concurrent?.outputTokens) === 150, '并发写入输出 token 正确累加（H-35）');
  assert(concurrent?.costCents === 3, '并发写入成本正确累加（H-35）');

  await prismaRaw.$disconnect();
}

main()
  .then(() => console.log('--- 所有 recordUsage 测试通过 ---'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Windows 下 Prisma 句柄可能延迟释放，清理失败不视为测试失败
    if (existsSync(databasePath)) {
      try {
        unlinkSync(databasePath);
      } catch {
        console.warn(`临时测试库清理被占用，忽略：${databasePath}`);
      }
    }
  });
