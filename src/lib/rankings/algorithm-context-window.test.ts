/**
 * Batch 9：4 维度算法单测（contextWindow 维度）
 *
 * 验证：
 * 1. contextWindowFactor：null/undefined → 0.5（中性）
 * 2. contextWindowFactor：边界（1K / 2M / 128K / 200K）
 * 3. calculateValueScore：contextWindow 维度生效
 * 4. contextWindow 高的模型评分高（同价格/能力下）
 * 5. 向后兼容：不传 contextWindow 也不崩
 */

import { calculateValueScore, contextWindowFactor } from './algorithm';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}

async function main() {
  // Section 1: contextWindowFactor 单元
  console.log('▶ Section 1: contextWindowFactor');
  assertPass('null → 0.5 (中性)', contextWindowFactor(null) === 0.5);
  assertPass('undefined → 0.5', contextWindowFactor(undefined) === 0.5);
  assertPass('0 → 0.5', contextWindowFactor(0) === 0.5);
  assertPass('-1 → 0.5', contextWindowFactor(-1) === 0.5);

  // 边界值
  const ctx2M = contextWindowFactor(2_000_000);
  assertPass('2M tokens → 1.0（满分）', Math.abs(ctx2M - 1.0) < 0.01);

  const ctx1K = contextWindowFactor(1_000);
  assertPass('1K tokens ≈ 0（最低）', ctx1K >= 0 && ctx1K < 0.5);

  const ctx128K = contextWindowFactor(128_000);
  const ctx200K = contextWindowFactor(200_000);
  assertPass('128K 介于 1K-2M 之间', ctx128K > ctx1K && ctx128K < 1.0);
  assertPass('200K > 128K', ctx200K > ctx128K);

  const ctx1M = contextWindowFactor(1_000_000);
  assertPass('1M 接近 1.0', ctx1M > 0.8);

  // Section 2: 评分维度生效
  console.log('▶ Section 2: 评分维度生效');

  // 基准：deepseek-flash (intel=76, speed=120, ctx=128K, price=0.14)
  const baseline = calculateValueScore({
    priceInput: 0.14, priceOutput: 0.28,
    intelligence: 76, speed: 120,
    contextWindow: 128_000,
  });

  // 同样的能力/速度/价格，但 contextWindow=2M
  const biggerCtx = calculateValueScore({
    priceInput: 0.14, priceOutput: 0.28,
    intelligence: 76, speed: 120,
    contextWindow: 2_000_000,
  });

  assertPass('2M 上下文得分 > 128K 上下文得分', biggerCtx.valueScore > baseline.valueScore);
  assertPass('contextWindowFactor 字段正确', biggerCtx.contextWindowFactor > baseline.contextWindowFactor);

  // Section 3: 向后兼容
  console.log('▶ Section 3: 向后兼容');
  const noCtx = calculateValueScore({
    priceInput: 0.14, priceOutput: 0.28,
    intelligence: 76, speed: 120,
    // 不传 contextWindow
  });
  assertPass('不传 contextWindow 也能算', noCtx.valueScore > 0);
  assertPass('contextWindowFactor 中性 0.5', noCtx.contextWindowFactor === 0.5);

  // Section 4: 排除规则不变
  console.log('▶ Section 4: 排除规则不变');
  const lowAbility = calculateValueScore({
    priceInput: 0.14, priceOutput: 0.28,
    intelligence: 20, speed: 120,  // < 25
    contextWindow: 128_000,
  });
  assertPass('能力<25 仍被排除', lowAbility.isExcluded);
  assertPass('能力<25 原因含"< 25"', Boolean(lowAbility.reason?.includes('< 25')));

  const noPrice = calculateValueScore({
    priceInput: 0, priceOutput: 0,
    intelligence: 76, speed: 120,
    contextWindow: 128_000,
  });
  assertPass('价格=0 仍被排除', noPrice.isExcluded);

  // Section 5: 权重可配置
  console.log('▶ Section 5: 权重可配置');
  const noContextWeight = calculateValueScore({
    priceInput: 0.14, priceOutput: 0.28,
    intelligence: 76, speed: 120,
    contextWindow: 128_000,
    weights: { input: 0.7, output: 0.3, context: 0 },  // 不用 contextWindow
  });
  assertPass('权重 0 时 contextWindowFactor 字段仍正常', noContextWeight.contextWindowFactor > 0);

  // Section 6: 排名场景
  console.log('▶ Section 6: 排名场景');
  // 场景：两个模型能力/速度/价格都相同，但 contextWindow 不同
  const a = calculateValueScore({ priceInput: 0.14, priceOutput: 0.28, intelligence: 76, speed: 120, contextWindow: 128_000 });
  const b = calculateValueScore({ priceInput: 0.14, priceOutput: 0.28, intelligence: 76, speed: 120, contextWindow: 2_000_000 });
  assertPass('2M context 排名高于 128K（分数更高）', b.valueScore > a.valueScore);

  console.log(`\n=== Batch 9 测试结果：${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
