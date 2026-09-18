/**
 * 验证 buildPptx 在传入 draft v4 content 时能生成合法的 .pptx
 *
 * 目的：Batch 3 验证 draft 模式的"封面角标 + 每页页脚"渲染逻辑不出错
 *
 * 跑法：npx tsx src/features/daily-briefing/lib/build-pptx-draft.test.ts
 */

import { buildPptx } from './build-pptx';
import * as fs from 'node:fs';
import * as path from 'node:path';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

async function main() {
  // 构造一个最小合法的 v4 content（draft 模式）
  const draftContent = {
    version: 4 as const,
    date: '2026-09-14',
    generatedAt: new Date().toISOString(),
    cover: {
      title: 'AI 日报 · 机器草稿',
      subtitle: '2026-09-14 · LLM 不可用，降级为机器草稿（LLM_FAILED）', // ★ 含"草稿" → 触发角标
      emphasis: 'Draft Mode',
      stats: [
        { value: '3', label: '条草稿', color: 'accent' as const },
        { value: 'B', label: '评级上限', color: 'secondary' as const },
        { value: '草稿', label: '未经人工核验', color: 'accent' as const },
      ],
    },
    overview: {
      intro: '今日收录 3 条',
      methodNote: '机器草稿',
      sources: [
        { name: 'A', description: '', icon: 'file', color: 'primary' as const },
        { name: 'B', description: '', icon: 'cog', color: 'secondary' as const },
        { name: 'C', description: '', icon: 'user', color: 'accent' as const },
        { name: 'D', description: '', icon: 'info', color: 'accent' as const },
      ],
      tlDr: ['draft1', 'draft2', 'draft3'],
      confidenceLegend: [
        { level: 'A' as const, label: '极高', rule: 'r1', color: 'primary' as const },
        { level: 'B' as const, label: '高',   rule: 'r2', color: 'secondary' as const },
        { level: 'C' as const, label: '中',   rule: 'r3', color: 'accent' as const },
        { level: 'D' as const, label: '存疑', rule: 'r4', color: 'accent' as const },
      ],
      distribution: [
        { level: 'A' as const, count: 0 },
        { level: 'B' as const, count: 2 },
        { level: 'C' as const, count: 1 },
        { level: 'D' as const, count: 0 },
      ],
    },
    items: [
      { rank: 1, title: 't1', source: 's1', url: '', publishedAt: '—', summary: 's', comment: 'c', category: 'AI Coding', direction: 'coding' as const, confidenceLevel: 'B' as const, independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 2, title: 't2', source: 's2', url: '', publishedAt: '—', summary: 's', comment: 'c', category: 'AI Coding', direction: 'coding' as const, confidenceLevel: 'B' as const, independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 3, title: 't3', source: 's3', url: '', publishedAt: '—', summary: 's', comment: 'c', category: 'AI Coding', direction: 'coding' as const, confidenceLevel: 'C' as const, independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
    ],
    directions: [
      { key: 'coding' as const, title: 'AI Coding', subtitle: '', count: 3, summaryItems: [{ rank: 1, title: 't1', oneLine: 's', category: 'AI Coding', confidence: 'B' as const }] },
    ],
    trends: [
      { rank: 1, title: '待补充', description: 'a' },
      { rank: 2, title: '待补充', description: 'b' },
      { rank: 3, title: '待补充', description: 'c' },
    ],
    verificationTable: {
      rows: Array.from({ length: 5 }, (_, i) => ({ rank: String(i + 1), topic: 'topic' + i, direction: 'coding' as const, sources: '1', primaryLink: '❌', confidence: 'B' as const })),
      summary: '机器草稿',
    },
    authors: [
      { name: 'Juya', status: 'warn' as const, statusText: '草稿模式', count: null, description: 'd', url: 'https://example.com' },
    ],
    sources: {
      skills: [],
      videoAuthors: [],
      crossSources: [],
      officialLinks: [],
    },
  };

  // 跑 buildPptx
  const buf = await buildPptx(draftContent as any);
  assertPass('draft 内容能生成 PPT', buf.length > 1024);
  assertPass('是合法 ZIP/PPTX (PK\\x03\\x04)', buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);

  // 保存到临时目录，便于人工检查
  const outDir = path.join(process.cwd(), '.tmp-draft-test');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `draft-${Date.now()}.pptx`);
  fs.writeFileSync(outPath, buf);
  console.log(`\nPPTX 已生成：${outPath}（${(buf.length / 1024).toFixed(1)} KB）`);
  console.log('请用 PowerPoint / Keynote 打开验证封面角标 + 每页页脚。');

  console.log(`\n=== Build PPTX Draft 测试结果：${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
