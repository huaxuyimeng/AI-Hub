/**
 * O5 闭环：parseQaError 单元测试
 * 验证它能把 server error 字段还原成结构化数组
 */

import assert from 'node:assert/strict';
import { parseQaError } from '@/features/daily-briefing/components/BriefingPanel';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${(e as Error).message}`); failed++; }
}

it('解析 lint-errors 字符串——完整字段', () => {
  const r = parseQaError('布局 lint 3 条 error：[L1]P2:封面页 caption 溢出 5px；[L2]P3:box 重叠 12px；[L1]P5:hero-title 截断');
  assert.equal(r.kind, 'lint-errors');
  assert.equal(r.count, 3);
  assert.equal(r.issues.length, 3);
  assert.equal(r.issues[0]?.rule, 'L1');
  assert.equal(r.issues[0]?.pageNo, 2);
  assert.equal(r.issues[0]?.detail, '封面页 caption 溢出 5px');
  assert.equal(r.issues[1]?.rule, 'L2');
  assert.equal(r.issues[2]?.rule, 'L1');
});

it('解析 lint-errors 截断（>3 条省略号）—— 输出 <details> 列表只看到前 3 条', () => {
  const r = parseQaError('布局 lint 4 条 error：[L1]P2:a；[L1]P3:b；[L2]P5:c；[L3]P7:d…');
  assert.equal(r.kind, 'lint-errors');
  assert.equal(r.count, 4);
  // parseQaError 不丢任何段（即使末尾是 …）；只解析出 4 条
  assert.equal(r.issues.length, 4);
  assert.equal(r.issues[3]?.rule, 'L3');
  // 注意：原始字符串里第 4 条 detail 以 … 结尾是 server 拼接时的截断标记
  // parseQaError 保留原文（不主动删 …，让 UI 自己识别）
  assert.ok(r.issues[3]?.detail === 'd…', `末尾应保留原文 d…，实际: "${r.issues[3]?.detail}"`);
});

it('解析 lint-warns 字符串——无 issues，仅 count', () => {
  const r = parseQaError('布局 lint 7 条 warn（密度/同型连续等）');
  assert.equal(r.kind, 'lint-warns');
  assert.equal(r.count, 7);
  assert.equal(r.issues.length, 0);
});

it('未知格式——归类为 other，原样保留', () => {
  const r = parseQaError('Network request failed: 502 Bad Gateway');
  assert.equal(r.kind, 'other');
  assert.equal(r.count, 0);
  assert.equal(r.raw, 'Network request failed: 502 Bad Gateway');
});

it('空字符串——安全归类为 other', () => {
  const r = parseQaError('');
  assert.equal(r.kind, 'other');
  assert.equal(r.count, 0);
});

console.log(`\n=== ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
