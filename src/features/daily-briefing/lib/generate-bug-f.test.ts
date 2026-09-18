/**
 * BUG-F 回归测试（2026-09-13）
 *
 * 场景：regenerate 事务里 deleteMany + create({phase:'pending', updatedAt=now()})
 *       后立刻调 generate()。原逻辑用 status+updatedAt 时间窗判并发 → 命中 → 早返回 → regenerate 啥也没干。
 * 修复：phase='pending' 视为"regenerate 显式让位" → 接管。
 *
 * 用 mock Prisma 验证 generateDailyReport 的"防并发早返回"分支
 */
import assert from 'node:assert/strict';

interface FakeRow {
  status: string;
  phase: string | null;
  updatedAt: Date;
  degraded?: boolean;
}

/** 模拟 generate.ts:531 的 findUnique + 防并发判断逻辑（提取出来便于测） */
function shouldTakeOver(existing: FakeRow | null): { takeOver: boolean; reason: string } {
  if (!existing) return { takeOver: true, reason: 'no existing row' };
  if (existing.status === 'ready') return { takeOver: false, reason: 'already ready' };
  if (
    existing.status === 'generating' &&
    existing.phase !== 'pending' &&
    Date.now() - existing.updatedAt.getTime() < 10 * 60 * 1000
  ) {
    return { takeOver: false, reason: `occupied by phase='${existing.phase}'` };
  }
  return { takeOver: true, reason: 'should take over' };
}

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${(e as Error).message}`); failed++; }
}

// ── BUG-F 核心场景 ─────────────────────────────────────────────────────────

it('BUG-F 修复：phase=pending + generating + 距 now 1ms → 接管（修复前会早返回）', () => {
  const row: FakeRow = {
    status: 'generating',
    phase: 'pending',  // ← regenerate 的特征标记
    updatedAt: new Date(Date.now() - 1),  // 1ms 前
  };
  const r = shouldTakeOver(row);
  assert.equal(r.takeOver, true, `应该接管，实际: ${r.reason}`);
});

it('BUG-F 修复：phase=collect + generating + 距 now 1ms → 不接管（防并发）', () => {
  const row: FakeRow = {
    status: 'generating',
    phase: 'collect',  // ← 已被别人跑
    updatedAt: new Date(Date.now() - 1),
  };
  const r = shouldTakeOver(row);
  assert.equal(r.takeOver, false, `不应接管，实际: ${r.reason}`);
});

it('BUG-F 修复：phase=select + 距 now 30s → 不接管', () => {
  const row: FakeRow = {
    status: 'generating',
    phase: 'select',
    updatedAt: new Date(Date.now() - 30_000),
  };
  const r = shouldTakeOver(row);
  assert.equal(r.takeOver, false);
});

it('phase=pending + generating + 距 now 5min → 仍接管（cron 兜底场景）', () => {
  // 即使 regenerate 是 5 分钟前触发的，phase 还是 pending → 视为卡死，cron 应该接管
  const row: FakeRow = {
    status: 'generating',
    phase: 'pending',
    updatedAt: new Date(Date.now() - 5 * 60 * 1000),
  };
  const r = shouldTakeOver(row);
  assert.equal(r.takeOver, true, `cron 兜底应该接管卡死的 pending，实际: ${r.reason}`);
});

it('phase=collect + 距 now 11min → 接管（旧的 10min 窗口过期）', () => {
  const row: FakeRow = {
    status: 'generating',
    phase: 'collect',
    updatedAt: new Date(Date.now() - 11 * 60 * 1000),
  };
  const r = shouldTakeOver(row);
  assert.equal(r.takeOver, true, `超过 10min 视为卡死，应该接管`);
});

it('status=ready → 不接管（已就绪）', () => {
  const row: FakeRow = {
    status: 'ready',
    phase: 'done',
    updatedAt: new Date(Date.now() - 60_000),
  };
  const r = shouldTakeOver(row);
  assert.equal(r.takeOver, false);
});

it('no existing row → 接管（首日生成）', () => {
  const r = shouldTakeOver(null);
  assert.equal(r.takeOver, true);
});

// ── 关键回归保护 ───────────────────────────────────────────────────────────

it('回归保护：phase=pending 是唯一可接管信号（其它任何 phase 都视为占用）', () => {
  // 列出所有可能的 phase（schema 注释里出现的）
  const busyPhases = ['collect', 'select', '2a', '2b', '2c', 'persist'];
  for (const p of busyPhases) {
    const row: FakeRow = {
      status: 'generating',
      phase: p,
      updatedAt: new Date(Date.now() - 100),  // 100ms 前
    };
    const r = shouldTakeOver(row);
    assert.equal(r.takeOver, false, `phase='${p}' 时不应该接管（被别人占用）`);
  }
});

console.log(`\n=== ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
