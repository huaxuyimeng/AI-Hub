/**
 * Batch 6：ContextWindow 维度单测
 *
 * 验证：
 * 1. fetchFromAA 返回 contextWindow
 * 2. ScrapedModelData 类型有 contextWindow 字段
 * 3. formatContextWindow 格式化正确（K / M）
 * 4. Model schema 字段名正确（contextWindow Int?）
 */

import { formatContextWindow } from '../../components/rankings/format-context-window';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}

async function main() {
  // Section 1: formatContextWindow
  console.log('▶ Section 1: formatContextWindow');
  assertPass('128000 → 128K', formatContextWindow(128_000) === '128K');
  assertPass('200000 → 200K', formatContextWindow(200_000) === '200K');
  assertPass('1000000 → 1M',  formatContextWindow(1_000_000) === '1M');
  assertPass('2000000 → 2M',  formatContextWindow(2_000_000) === '2M');
  assertPass('131072 → 131K', formatContextWindow(131_072) === '131K');
  assertPass('500 → 500 (低于 1K 走默认)', formatContextWindow(500) === '500');
  assertPass('1024 → 1K', formatContextWindow(1_024) === '1K');

  // Section 2: schema.prisma 包含 contextWindow
  console.log('▶ Section 2: schema.prisma');
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  const schemaContent = readFileSync(schemaPath, 'utf-8');
  const modelSection = schemaContent.split('model Model {')[1]?.split('}')[0] ?? '';
  assertPass('Model 表有 contextWindow 字段', modelSection.includes('contextWindow'));
  assertPass('contextWindow 是 Int?（nullable）', /contextWindow\s+Int\?/.test(modelSection));
  assertPass('contextWindow 紧跟 speed 字段', modelSection.indexOf('contextWindow') > modelSection.indexOf('speed'));

  // Section 3: scraper.ts AA_DATA 含 contextWindow
  console.log('▶ Section 3: scraper.ts AA_DATA');
  const scraperPath = path.join(process.cwd(), 'src', 'lib', 'rankings', 'scraper.ts');
  const scraperContent = readFileSync(scraperPath, 'utf-8');
  assertPass('ScrapedModelData 有 contextWindow 字段', scraperContent.includes('contextWindow?: number | null'));
  assertPass('AA_DATA 多个模型标注 contextWindow', (scraperContent.match(/contextWindow:\s*\d/g) ?? []).length >= 10);
  assertPass('gpt-4o 是 128000', scraperContent.includes("'gpt-4o':") && scraperContent.match(/'gpt-4o':\s*\{[^}]*128_000/s) !== null);
  assertPass('gemini-2.5-pro 是 2000000', scraperContent.includes("'gemini-2.5-pro':") && scraperContent.match(/'gemini-2.5-pro':\s*\{[^}]*2_000_000/s) !== null);

  // Section 4: rankings router 返回 contextWindow
  console.log('▶ Section 4: rankings router');
  const routerPath = path.join(process.cwd(), 'src', 'server', 'routers', 'rankings.ts');
  const routerContent = readFileSync(routerPath, 'utf-8');
  assertPass('rankings.ts list 返回 contextWindow', routerContent.includes('contextWindow: m.contextWindow'));

  // Section 5: RankingsTable 含 contextWindow 列
  console.log('▶ Section 5: RankingsTable');
  const tablePath = path.join(process.cwd(), 'src', 'components', 'rankings', 'RankingsTable.tsx');
  const tableContent = readFileSync(tablePath, 'utf-8');
  assertPass('表格有"上下文"列头', tableContent.includes('上下文'));
  assertPass('表格调用 formatContextWindow', tableContent.includes('formatContextWindow(m.contextWindow)'));

  // Section 6: 详情页含 contextWindow 徽章
  console.log('▶ Section 6: 详情页');
  const detailPath = path.join(process.cwd(), 'src', 'app', '(app)', 'rankings', '[id]', 'page.tsx');
  const detailContent = readFileSync(detailPath, 'utf-8');
  assertPass('详情页有"上下文："徽章', detailContent.includes('上下文：'));
  assertPass('详情页调 formatCtx', detailContent.includes('formatCtx(model.contextWindow)'));

  console.log(`\n=== Batch 6 测试结果：${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
