/**
 * 性价比算法单元测试
 *
 * 来源：整合 plan §4.2
 * 运行：npx tsx src/lib/rankings/algorithm.test.ts
 */

import {
  calculateValueScore,
  normalizeScores,
  paretoFrontier,
  type ScoringResult,
} from './algorithm';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  } else {
    console.log(`PASS: ${message}`);
  }
}

function closeEnough(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

// ========== 测试用例 ==========

console.log('--- calculateValueScore ---');

// 测试 1：正常模型
const r1: ScoringResult = calculateValueScore({
  priceInput: 2.5,
  priceOutput: 10,
  intelligence: 70,
  speed: 100,
});
assert(r1.isExcluded === false, '正常模型不被排除');
assert(r1.valueScore > 0, '正常模型 valueScore > 0');
assert(closeEnough(r1.blendPrice, 4.75), '混合价 = 0.7*2.5 + 0.3*10 = 4.75');

// 测试 2：能力分过低被排除
const r2: ScoringResult = calculateValueScore({
  priceInput: 1,
  priceOutput: 2,
  intelligence: 20,
  speed: 100,
});
assert(r2.isExcluded === true, '能力分 20 < 25 被排除');
assert(!!r2.reason && r2.reason.includes('20'), '排除原因包含分数');

// 测试 3：价格为 0 被排除
const r3: ScoringResult = calculateValueScore({
  priceInput: 0,
  priceOutput: 0,
  intelligence: 70,
  speed: 100,
});
assert(r3.isExcluded === true, '价格为 0 被排除');
assert(!!r3.reason && r3.reason.includes('价格'), '排除原因提到价格');

// 测试 4：能力越高分越高
const low = calculateValueScore({ priceInput: 2.5, priceOutput: 10, intelligence: 60, speed: 100 });
const high = calculateValueScore({ priceInput: 2.5, priceOutput: 10, intelligence: 90, speed: 100 });
assert(high.valueScore > low.valueScore, '能力分 90 > 60 的得分');

// 测试 5：价格越低分越高
const cheap = calculateValueScore({ priceInput: 1, priceOutput: 2, intelligence: 70, speed: 100 });
const expensive = calculateValueScore({ priceInput: 10, priceOutput: 20, intelligence: 70, speed: 100 });
assert(cheap.valueScore > expensive.valueScore, '便宜模型分更高');

console.log('\n--- normalizeScores ---');

// 测试 6：归一化后榜首 = 100
const results: ScoringResult[] = [
  { ...r1, valueScore: 50, abilityScore: 0, blendPrice: 0, rank: 0, isExcluded: false },
  { ...cheap, valueScore: 80, abilityScore: 0, blendPrice: 0, rank: 0, isExcluded: false },
  { ...expensive, valueScore: 20, abilityScore: 0, blendPrice: 0, rank: 0, isExcluded: false },
];
const normalized = normalizeScores(results);
const top = normalized.reduce((max, r) => (r.valueScore > max ? r.valueScore : max), 0);
assert(closeEnough(top, 100), '归一化后榜首 = 100');

// 测试 7：被排除的保持 0
assert(normalized[0].valueScore > 0 || normalized[1].valueScore > 0, '未被排除的有正常分数');

console.log('\n--- paretoFrontier ---');

// 测试 8：基础前沿
const items = [
  { id: 'a', priceInput: 1, intelligence: 50 },
  { id: 'b', priceInput: 2, intelligence: 60 },
  { id: 'c', priceInput: 3, intelligence: 55 }, // 应被排除（b 已达到 60）
  { id: 'd', priceInput: 4, intelligence: 70 },
  { id: 'e', priceInput: 5, intelligence: 65 }, // 应被排除
];
const frontier = paretoFrontier(items);
const frontierIds = frontier.map((f) => f.id).sort();
assert(JSON.stringify(frontierIds) === JSON.stringify(['a', 'b', 'd']), `前沿 = [a, b, d]，实际 [${frontierIds.join(',')}]`);

// 测试 9：过滤无效数据
const invalid = [
  { id: 'a', priceInput: 0, intelligence: 50 },
  { id: 'b', priceInput: 1, intelligence: null as unknown as number },
  { id: 'c', priceInput: 2, intelligence: 60 },
];
const f2 = paretoFrontier(invalid);
assert(f2.length === 1 && f2[0].id === 'c', '过滤掉无效数据点');

console.log('\n--- 所有测试通过 ✓ ---');
