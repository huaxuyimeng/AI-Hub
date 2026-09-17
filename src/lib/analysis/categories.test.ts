/**
 * AI 分析 8 维度评分算法 — 单元测试
 *
 * 运行：npx tsx src/lib/analysis/categories.test.ts
 *
 * 覆盖：
 *   - computeCategoryScore: 基础扣分 / 上限保护 / 下限
 *   - computeOverallScore: 权重加总 / 归一化
 *   - normalizeAnalysisOutput: AI 输出补齐缺失类别
 *   - severityCount: 统计
 */

import {
  computeCategoryScore,
  computeOverallScore,
  normalizeAnalysisOutput,
  severityCount,
  DEFAULT_CATEGORIES,
  type CategoryKey,
} from './categories';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

console.log('\n== computeCategoryScore ==');

// 1. 无问题 → 100 分
assert(computeCategoryScore([]) === 100, '无问题 → 100 分');

// 2. 1 个 LOW → 99 分
assert(
  computeCategoryScore([{ severity: 'LOW' }]) === 99,
  '1 个 LOW → 99 分',
);

// 3. 1 个 MEDIUM → 95 分（且触发上限保护 ≤90）
assert(
  computeCategoryScore([{ severity: 'MEDIUM' }]) === 90,
  '1 个 MEDIUM → 95 → 上限保护 90',
);

// 4. 1 个 HIGH → 90 → 上限保护 85
assert(
  computeCategoryScore([{ severity: 'HIGH' }]) === 85,
  '1 个 HIGH → 90 → 上限保护 85',
);

// 5. 1 个 CRITICAL → 75 → 上限保护 75
assert(
  computeCategoryScore([{ severity: 'CRITICAL' }]) === 75,
  '1 个 CRITICAL → 75 → 上限保护 75',
);

// 6. 多个严重度混合
assert(
  computeCategoryScore([
    { severity: 'CRITICAL' }, // -25 → 75（触发 75 上限）
    { severity: 'HIGH' },     // -10 → 65
    { severity: 'MEDIUM' },   // -5  → 60
    { severity: 'LOW' },      // -1  → 59
  ]) === 59, // 100-41=59，但有 CRITICAL → 上限 75；59<75 所以取 59
  '1 严 + 1 高 + 1 中 + 1 低 → 59 分（无上限触发）',
);

// 7. 上限保护：HIGH 触发 85 上限（即使扣分更低）
assert(
  computeCategoryScore([
    { severity: 'HIGH' },    // -10 → 90 → 上限 85
    { severity: 'LOW' },     // -1  → 89 → 还是 85
  ]) === 85,
  'HIGH + LOW → 上限保护 85',
);

// 8. 上限保护：CRITICAL 触发 75 上限
assert(
  computeCategoryScore([
    { severity: 'CRITICAL' }, // -25 → 75 → 上限 75
  ]) === 75,
  '1 个 CRITICAL → 触发 75 上限',
);

// 9. 下限 0
assert(
  computeCategoryScore([
    { severity: 'CRITICAL' },
    { severity: 'CRITICAL' },
    { severity: 'CRITICAL' },
    { severity: 'CRITICAL' }, // 4×25 = 100 → 0
  ]) === 0,
  '4 个 CRITICAL → 下限 0',
);

// 10. 大量 LOW（也只触发 90 上限）
assert(
  computeCategoryScore(Array(20).fill({ severity: 'LOW' })) === 80, // 100-20=80
  '20 个 LOW → 80 分（未达 MEDIUM 上限）',
);

// 11. 未知严重度视为不扣分
assert(
  computeCategoryScore([
    { severity: 'UNKNOWN' as any },
    { severity: 'LOW' },
  ]) === 99,
  '未知严重度 → 不扣分',
);

console.log('\n== computeOverallScore ==');

// 12. 全部 100 分 → overall 100
assert(
  computeOverallScore({
    security: 100, crud: 100, concurrency: 100, errorHandling: 100,
    boundary: 100, resource: 100, testing: 100, architecture: 100,
  }) === 100,
  '全 100 → overall 100',
);

// 13. 各维度分数不同时按权重加总
const w = DEFAULT_CATEGORIES.reduce((acc, c) => {
  acc[c.key] = 80; // 全部给 80 分
  return acc;
}, {} as Record<CategoryKey, number>);
const overall = computeOverallScore(w);
assert(overall === 80, `默认权重加总 = 80（实际 ${overall} 分）`);

// 14. 归一化：所有权重放大 10 倍，结果不变
const customWeights = DEFAULT_CATEGORIES.reduce((acc, c) => {
  acc[c.key] = c.weight * 10;
  return acc;
}, {} as Record<CategoryKey, number>);
const baseline = computeOverallScore(w, {});
const scaled = computeOverallScore(w, customWeights);
assert(baseline === scaled, '权重放大 10 倍结果相同（自动归一化）');

// 15. 实际场景：3 个维度不及格
const mixed: Record<CategoryKey, number> = {
  security: 70, crud: 80, concurrency: 90, errorHandling: 60,
  boundary: 95, resource: 100, testing: 50, architecture: 85,
};
const mixedOverall = computeOverallScore(mixed);
assert(mixedOverall >= 60 && mixedOverall <= 90, `混合场景总分合理（${mixedOverall} 分）`);

console.log('\n== severityCount ==');

const counts = severityCount([
  { severity: 'CRITICAL' },
  { severity: 'CRITICAL' },
  { severity: 'HIGH' },
  { severity: 'MEDIUM' },
  { severity: 'MEDIUM' },
  { severity: 'MEDIUM' },
  { severity: 'LOW' },
]);
assert(counts.CRITICAL === 2, 'CRITICAL 计数');
assert(counts.HIGH === 1, 'HIGH 计数');
assert(counts.MEDIUM === 3, 'MEDIUM 计数');
assert(counts.LOW === 1, 'LOW 计数');

console.log('\n== normalizeAnalysisOutput ==');

// 16. AI 漏报 2 个类别 → 补齐
const partial = {
  categories: [
    { key: 'security', score: 50, problems: [{ severity: 'HIGH', message: 'SQL 注入', evidence: '', violation: '', suggestion: '', filePath: '' }] },
    { key: 'crud', score: 80, problems: [] },
  ],
  summary: '部分报告',
  overall: 75,
};
const normalized = normalizeAnalysisOutput(partial);
assert(normalized.categories.length === 8, `8 类齐（实际 ${normalized.categories.length}）`);
assert(
  normalized.categories.find((c) => c.key === 'concurrency')?.score === 100,
  'concurrency 类别补齐（默认 100 分）',
);
assert(normalized.summary === '部分报告', 'summary 保留');

// 17. AI 输出非法 → 兜底空报告
// 修复 2026-09-18：测试期望对齐实际实现
//   normalizeAnalysisOutput 解析失败时返回 overall=-1 作为失败信号
//   后端 src/server/routers/analysis.ts L371 据此判定 parseFailed=true
//   并在 summary 写入 AI 原始输出前 300 字符
//   故意返回 -1 而非 100，避免「解析失败」被前端误判为「满分报告」
const fallback = normalizeAnalysisOutput(null);
assert(fallback.categories.length === 8, '非法输入 → 8 类空报告');
assert(fallback.overall === -1, '非法输入 → overall=-1（解析失败信号，≠100）');
assert(fallback.summary === '', '非法输入 → summary 为空字符串（由调用方补 AI 原文）');

// 18. AI 输出完全乱码 → 兜底
const fallback2 = normalizeAnalysisOutput({ random: 'data' });
assert(fallback2.categories.length === 8, '乱码输入 → 8 类空报告');

// 19. 类别按固定顺序排序
const unordered = {
  categories: [
    { key: 'testing', score: 50, problems: [] },
    { key: 'security', score: 50, problems: [] },
    { key: 'crud', score: 50, problems: [] },
    { key: 'concurrency', score: 50, problems: [] },
    { key: 'errorHandling', score: 50, problems: [] },
    { key: 'boundary', score: 50, problems: [] },
    { key: 'resource', score: 50, problems: [] },
    { key: 'architecture', score: 50, problems: [] },
  ],
};
const sorted = normalizeAnalysisOutput(unordered);
const order = sorted.categories.map((c) => c.key).join(',');
assert(
  order === 'security,crud,concurrency,errorHandling,boundary,resource,testing,architecture',
  `类别按固定顺序排列（${order}）`,
);

console.log(`\n=== 测试结果：${passed} 通过 / ${failed} 失败 ===\n`);
process.exit(failed > 0 ? 1 : 0);
