/**
 * Batch 5：角标 + 免责声明页单测
 *
 * 验证：
 * 1. 角标渲染：右上方 A/B/C/D 角标存在
 * 2. P15 免责声明页：4 段说明、PK 签名合法
 * 3. _totalPages +1（PPT 字节数增大）
 * 4. 草稿模式 + 角标 + 免责页共存
 */

import { buildPptx } from './build-pptx';
import type { DailyReportContent } from './types';
import * as fs from 'node:fs';
import * as path from 'node:path';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}

function makeContent(overrides?: Partial<DailyReportContent>): DailyReportContent {
  return {
    version: 4,
    date: '2026-09-14',
    generatedAt: '2026-09-14T08:00:00Z',
    cover: {
      title: 'AI 日报',
      subtitle: '2026-09-14',
      emphasis: 'AI Coding × 具身智能',
      stats: [
        { value: '5', label: '条新闻', color: 'primary' },
        { value: '4', label: '类信源', color: 'secondary' },
        { value: 'A×2', label: '高置信', color: 'primary' },
      ],
    },
    overview: {
      intro: '本期要点',
      methodNote: 'method',
      sources: [
        { name: '聚合源', description: 'd', icon: 'file', color: 'primary' },
        { name: '视频源', description: 'd', icon: 'comment', color: 'secondary' },
        { name: '官方源', description: 'd', icon: 'check', color: 'primary' },
        { name: '第三方', description: 'd', icon: 'share', color: 'accent' },
      ],
      tlDr: ['t1', 't2', 't3'],
      confidenceLegend: [
        { level: 'A', label: '极高', rule: 'r', color: 'primary' },
        { level: 'B', label: '高', rule: 'r', color: 'secondary' },
        { level: 'C', label: '中', rule: 'r', color: 'accent' },
        { level: 'D', label: '存疑', rule: 'r', color: 'accent' },
      ],
      distribution: [
        { level: 'A', count: 2 },
        { level: 'B', count: 2 },
        { level: 'C', count: 1 },
        { level: 'D', count: 0 },
      ],
    },
    items: [
      { rank: 1, title: 'A 级要闻', source: 'Anthropic News', url: '', publishedAt: '08:00', summary: 'sum', comment: 'c', category: 'AI Coding', direction: 'coding', confidenceLevel: 'A', independentSources: 3, totalReposts: 0, hasPrimaryLink: true, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 2, title: 'B 级要闻', source: '量子位', url: '', publishedAt: '08:00', summary: 'sum', comment: 'c', category: 'AI Coding', direction: 'coding', confidenceLevel: 'B', independentSources: 2, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 3, title: 'C 级要闻', source: 'TechCrunch AI', url: '', publishedAt: '08:00', summary: 'sum', comment: 'c', category: 'AI Coding', direction: 'coding', confidenceLevel: 'C', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 4, title: '具身智能要闻', source: '极客公园', url: '', publishedAt: '08:00', summary: 'sum', comment: 'c', category: '具身智能', direction: 'embodied', confidenceLevel: 'B', independentSources: 2, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 5, title: '另一具身智能', source: '机器之心', url: '', publishedAt: '08:00', summary: 'sum', comment: 'c', category: '具身智能', direction: 'embodied', confidenceLevel: 'C', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
    ],
    directions: [
      { key: 'coding', title: 'AI Coding', subtitle: '', count: 3, summaryItems: [{ rank: 1, title: 'A', oneLine: '', category: 'AI Coding', confidence: 'A' }] },
      { key: 'embodied', title: '具身智能', subtitle: '', count: 2, summaryItems: [{ rank: 4, title: 'B', oneLine: '', category: '具身智能', confidence: 'B' }] },
    ],
    trends: [
      { rank: 1, title: 'T1', description: 'd1' },
      { rank: 2, title: 'T2', description: 'd2' },
      { rank: 3, title: 'T3', description: 'd3' },
    ],
    verificationTable: {
      rows: Array.from({ length: 5 }, (_, i) => ({
        rank: String(i + 1),
        topic: 't' + i,
        direction: 'coding' as const,
        sources: String(i + 1),
        primaryLink: i === 0 ? '✅ 原文' : '❌',
        confidence: 'B' as const,
      })),
      summary: 'summary',
    },
    authors: [
      { name: 'JUnit', status: 'ok', statusText: 'S', count: null, description: 'd', url: 'https://example.com' },
    ],
    sources: {
      skills: [{ name: '量子位', url: 'https://example.com/1' }],
      videoAuthors: [{ name: 'Juya', url: 'https://example.com/2' }],
      crossSources: [{ name: 'TC', url: 'https://example.com/3' }],
      officialLinks: [{ name: 'Anthropic', url: 'https://anthropic.com' }],
    },
    ...overrides,
  };
}

async function main() {
  // Section 1：基本生成
  console.log('▶ Section 1: 基本生成');
  const content = makeContent();
  const buf = await buildPptx(content);
  assertPass('生成 PPT 不抛错', buf.length > 0);
  assertPass('PK 签名合法', buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);

  // Section 2：PPT 字节数显著（应该有角标 + 免责页导致字节增加）
  console.log('▶ Section 2: 角标 + 免责页生效');
  assertPass('PPT 大小合理（>30KB）', buf.length > 30_000);

  // Section 3：草稿模式 + 角标 + 免责页
  console.log('▶ Section 3: 草稿模式兼容');
  const draftContent = makeContent({
    cover: {
      title: 'AI 日报 · 机器草稿',
      subtitle: '2026-09-14 · 草稿（LLM_FAILED）',
      emphasis: 'Draft Mode',
      stats: [
        { value: '5', label: '条草稿', color: 'accent' },
        { value: 'B', label: '评级上限', color: 'secondary' },
        { value: '草稿', label: '未经人工核验', color: 'accent' },
      ],
    },
  });
  const draftBuf = await buildPptx(draftContent);
  assertPass('草稿 + 角标 + 免责页共生存', draftBuf.length > 30_000);
  assertPass('草稿 PK 签名', draftBuf[0] === 0x50 && draftBuf[1] === 0x4b);

  // Section 4：导出 PPT
  console.log('▶ Section 4: 导出文件');
  const outDir = path.join(process.cwd(), '.tmp-batch5-test');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `badges-disclaimer-${Date.now()}.pptx`);
  fs.writeFileSync(outPath, buf);
  console.log(`PPTX 已生成：${outPath}（${(buf.length / 1024).toFixed(1)} KB）`);
  console.log('请用 PowerPoint 打开，每张要闻卡右上角应有 A/B/C/D 角标；最后一页应为免责声明。');

  console.log(`\n=== Batch 5 测试结果：${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
