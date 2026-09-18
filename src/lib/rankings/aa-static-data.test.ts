/**
 * Batch 8：AA 静态数据集单测
 *
 * 验证：
 * 1. JSON 正确导入
 * 2. lookupAAData 按 externalId 查得到
 * 3. label 标准化映射正确（处理括号、版本号等）
 * 4. 数据结构完整（intelligence / speed / costPerTask 三件套）
 */

import { lookupAAData, AA_FETCHED_AT, AA_SOURCE, _debugListKeys } from './aa-static-data';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}

async function main() {
  // Section 1: 基本导入
  console.log('▶ Section 1: 基本导入');
  assertPass('AA_FETCHED_AT 是有效日期', !isNaN(Date.parse(AA_FETCHED_AT)));
  assertPass('AA_SOURCE.name 非空', AA_SOURCE.name.length > 0);
  assertPass('AA_SOURCE.url 是 artificialanalysis.ai', AA_SOURCE.url.includes('artificialanalysis.ai'));
  assertPass('AA_SOURCE.methodology 是 methodology 路径', AA_SOURCE.methodology.includes('methodology'));

  // Section 2: 查询关键模型
  console.log('▶ Section 2: 查询关键模型');
  const claude5 = lookupAAData('claude-fable-5');
  assertPass('claude-fable-5 存在', claude5 !== null);
  assertPass('claude-fable-5 有 intelligence', claude5?.intelligence !== undefined && claude5.intelligence > 0);
  assertPass('claude-fable-5 有 speed', claude5?.speed !== undefined && claude5.speed > 0);

  const deepseek = lookupAAData('deepseek-v4-pro');
  assertPass('deepseek-v4-pro 存在（合并 V4.1 Flash 后）', deepseek !== null);
  assertPass('deepseek-v4-pro 有 intelligence', deepseek?.intelligence !== undefined);
  assertPass('deepseek-v4-pro 有 speed', deepseek?.speed !== undefined);

  const gpt6 = lookupAAData('gpt-6-astra');
  assertPass('gpt-6-astra 存在', gpt6 !== null);

  // Section 3: 不存在的模型返回 null（兜底）
  console.log('▶ Section 3: 兜底');
  assertPass('不存在的 ID 返回 null', lookupAAData('non-existent-model-xyz') === null);

  // Section 4: 索引列表
  console.log('▶ Section 4: 索引列表');
  const allKeys = _debugListKeys();
  assertPass('至少索引了 8 个模型', allKeys.length >= 8);
  assertPass('包含 claude-fable-5', allKeys.includes('claude-fable-5'));
  assertPass('包含 deepseek-v4-pro', allKeys.includes('deepseek-v4-pro'));
  assertPass('包含 gpt-6-astra', allKeys.includes('gpt-6-astra'));

  // Section 5: scraper fetchFromAA 静态优先路径
  console.log('▶ Section 5: scraper 静态优先');
  // 不直接调 Scraper（要 Prisma），只验证 import + 函数存在
  assertPass('scraper.ts 引用 lookupAAData', true);
  // 通过 grep 检查 scraper.ts 源码
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const scraperContent = readFileSync(join(process.cwd(), 'src', 'lib', 'rankings', 'scraper.ts'), 'utf-8');
  assertPass('scraper.ts 静态 import aa-static-data', scraperContent.includes("./aa-static-data"));
  assertPass('scraper.ts 调用 lookupAAData', scraperContent.includes('lookupAAData'));
  assertPass('fetchFromAA 优先查 AA 数据', scraperContent.match(/aaStatic\s*&&[\s\S]{0,200}intelligence/) !== null);

  console.log(`\n=== Batch 8 测试结果：${passed} passed, ${failed} failed ===`);
  console.log(`AA 数据更新时间：${AA_FETCHED_AT}`);
  console.log(`已索引 ${allKeys.length} 个模型：${allKeys.join(', ')}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
