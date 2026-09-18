/**
 * 测试聚合运行器
 * 路径：scripts/run-tests.cjs
 *
 * 为什么需要它：本机 bash 完全不可用（tail / head / mkdir / dirname 全部 "command not found"），
 * PowerShell 又会把子进程写往 stderr 的内容当作错误中断。所以统一用 Node 起子进程、
 * 各自收集 stdout/stderr，最后写一份报告文件。
 *
 * 用法：node scripts/run-tests.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = 'D:/1Money/aihub';
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const NODE = process.execPath;

const SUITES = [
  'src/lib/slide-engine/slide-engine.test.ts',
  'src/lib/slide-engine/templates/briefing/plan.test.ts',
  'src/lib/slide-engine/templates/briefing/rumor.test.ts',
  'src/lib/slide-engine/pptx-inset.test.ts',
  'src/lib/slide-engine/visual-regression.test.ts',
  // daily-briefing 侧：2026-09-16 深扫发现这些套件此前不在门禁内，
  // 改坏 postprocess / build-pptx 也不会有测试拦住，故纳入
  'src/features/daily-briefing/lib/postprocess.test.ts',
  'src/features/daily-briefing/lib/qa-gate.test.ts',
  'src/features/daily-briefing/lib/badges-disclaimer.test.ts',
  'src/features/daily-briefing/lib/confidence-scale-page.test.ts',
];

const report = [];
let failedSuites = 0;

// ============================================================================
// 第 0 道门：类型检查
//
// 为什么必须放在最前面：这些测试是 `tsx` 直接跑的，**不做类型检查**。
// 于是"运行时 11/11 通过、但 tsc 报错"完全可能发生
// （真实踩过：测试里手写的 table cells 少了 maxLines 字段）。
// 类型错误不会被测试拦住，只能靠这一步。
// ============================================================================
function runTypecheck() {
  report.push('='.repeat(78));
  report.push('GATE   tsc --noEmit');
  report.push('='.repeat(78));

  const t0 = Date.now();
  const res = spawnSync(NODE, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600000,
    env: { ...process.env, NO_COLOR: '1' },
  });

  const ms = Date.now() - t0;
  const out = (res.stdout || '').trimEnd();
  const err = (res.stderr || '').trimEnd();
  if (out) report.push(out);
  if (err) report.push(err);

  const ok = res.status === 0;
  if (!ok) failedSuites++;
  report.push('');
  report.push(`>>> exit=${res.status}  耗时=${ms}ms  ${ok ? 'PASS' : 'FAIL'}`);
  report.push('');
}

runTypecheck();

for (const suite of SUITES) {
  const abs = path.join(ROOT, suite);
  report.push('='.repeat(78));
  report.push(`SUITE  ${suite}`);
  report.push('='.repeat(78));

  if (!fs.existsSync(abs)) {
    report.push('  !! 文件不存在，跳过');
    report.push('');
    continue;
  }

  const t0 = Date.now();
  const res = spawnSync(NODE, [TSX, abs], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });

  const ms = Date.now() - t0;
  const out = (res.stdout || '').trimEnd();
  const err = (res.stderr || '').trimEnd();

  if (out) report.push(out);
  if (err) {
    report.push('--- stderr ---');
    report.push(err);
  }

  const code = res.status;
  const ok = code === 0;
  if (!ok) failedSuites++;
  report.push('');
  report.push(`>>> exit=${code}  耗时=${ms}ms  ${ok ? 'PASS' : 'FAIL'}`);
  report.push('');
}

report.push('='.repeat(78));
report.push(
  failedSuites === 0
    ? `全部 ${SUITES.length + 1} 道门通过（1 类型检查 + ${SUITES.length} 测试套件）`
    : `${failedSuites}/${SUITES.length + 1} 道门失败`,
);
report.push('='.repeat(78));

const text = report.join('\n');
fs.writeFileSync(path.join(ROOT, '.tests-report.txt'), text, 'utf8');
console.log(text);

process.exit(failedSuites === 0 ? 0 : 1);
