/**
 * Batch 7：PriceChart 30 天滚动 + 4 指标 + 波动预警 测试
 *
 * 由于 PriceChart 是 React 组件（SVG），这里只做静态结构检查
 * + 日期过滤逻辑测试（通过正则匹配源码中关键代码片段）
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}

async function main() {
  const priceChartPath = path.join(process.cwd(), 'src', 'components', 'rankings', 'PriceChart.tsx');
  const content = readFileSync(priceChartPath, 'utf-8');

  // Section 1: 30 天滚动窗口
  console.log('▶ Section 1: 30 天滚动窗口');
  assertPass('源码有 THIRTY_DAYS_MS 常量', content.includes('THIRTY_DAYS_MS'));
  assertPass('源码有 cutoff 过滤', content.includes('cutoff') && content.includes('cutoff = Date.now()'));
  assertPass('30 天窗口的 cutoff 计算正确',
    content.includes('30 * 24 * 60 * 60 * 1000'));

  // Section 2: 4 个指标
  console.log('▶ Section 2: 4 个指标');
  assertPass('输入价折线（primary）', content.includes('hsl(var(--primary))') && content.includes('inputPath'));
  assertPass('输出价折线（secondary）', content.includes('hsl(var(--secondary))') && content.includes('outputPath'));
  assertPass('能力分折线（accent）', content.includes('hsl(var(--accent))') && content.includes('intelPath'));
  assertPass('速度折线（D97706 橙）', content.includes('#D97706') && content.includes('speedPath'));

  // Section 3: 波动预警
  console.log('▶ Section 3: 价格波动预警');
  assertPass('有 PRICE_CHANGE_ALERT_THRESHOLD', content.includes('PRICE_CHANGE_ALERT_THRESHOLD'));
  assertPass('阈值是 0.1（10%）', content.includes('= 0.1'));
  assertPass('检测逻辑含 Math.abs', content.includes('Math.abs((s.priceInput'));
  assertPass('红点描边（#DC2626）', content.includes('#DC2626'));
  assertPass('Tooltip 含 "⚠️ 价格大幅波动"', content.includes('⚠️ 价格大幅波动'));

  // Section 4: 空状态 + 30 天窗口标签
  console.log('▶ Section 4: 空状态');
  assertPass('空状态提示', content.includes('暂无近 30 天价格历史'));
  assertPass('等待 cron 文案', content.includes('等待 cron 追加新快照'));

  // Section 5: 数字 Y 轴独立
  console.log('▶ Section 5: 能力/速度独立 Y 比例');
  assertPass('yScaleIntel', content.includes('yScaleIntel'));
  assertPass('yScaleSpeed', content.includes('yScaleSpeed'));
  assertPass('intels 数组过滤', content.includes('intels.length > 0'));
  assertPass('speeds 数组过滤', content.includes('speeds.length > 0'));

  // Section 6: 警告条幅
  console.log('▶ Section 6: 警告条幅');
  assertPass('警告条幅 UI', content.includes('检测到') && content.includes('次价格大幅波动'));
  assertPass('红底色', content.includes('bg-red-50'));
  assertPass('边框样式', content.includes('border-red-200'));

  console.log(`\n=== Batch 7 测试结果：${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
