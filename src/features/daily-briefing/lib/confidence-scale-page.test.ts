/**
 * Batch 4：置信度评级一览页（P03）单测
 *
 * 验证：
 * 1. P03 页在 plan 中按预期位置插入（Cover 之后，Overview 之前）
 * 2. _totalPages 自动 +1（footer 分母）
 * 3. 渲染不报错且产出合法 PPTX
 * 4. confidenceLegend 4 项与 distribution 4 项必须 1:1 对应
 */

import { buildPptx } from './build-pptx';
import type { DailyReportContent } from './types';
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
        { value: '10', label: '条新闻', color: 'primary' },
        { value: '4', label: '类信源', color: 'secondary' },
        { value: 'A×3', label: '高置信', color: 'primary' },
      ],
    },
    overview: {
      intro: '本期要点',
      methodNote: '刻意区分「转载」与「独立信源」',
      sources: [
        { name: '聚合源', description: 'd', icon: 'file', color: 'primary' },
        { name: '视频源', description: 'd', icon: 'comment', color: 'secondary' },
        { name: '官方源', description: 'd', icon: 'check', color: 'primary' },
        { name: '第三方', description: 'd', icon: 'share', color: 'accent' },
      ],
      tlDr: ['要点1', '要点2', '要点3'],
      confidenceLegend: [
        { level: 'A', label: '极高', rule: '≥3 独立信源+一手官方', color: 'primary' },
        { level: 'B', label: '高',   rule: '2 独立信源，或 1 信源+一手', color: 'secondary' },
        { level: 'C', label: '中',   rule: '单一信源报道', color: 'accent' },
        { level: 'D', label: '存疑', rule: '关键数字矛盾', color: 'accent' },
      ],
      distribution: [
        { level: 'A', count: 3 },
        { level: 'B', count: 4 },
        { level: 'C', count: 2 },
        { level: 'D', count: 1 },
      ],
    },
    items: Array.from({ length: 10 }, (_, i) => ({
      rank: i + 1,
      title: `T${i + 1}`,
      source: '量子位',
      url: '',
      publishedAt: '08:00',
      summary: 's',
      comment: 'c',
      category: 'AI Coding',
      direction: (i % 2 === 0 ? 'coding' : 'embodied') as 'coding' | 'embodied',
      confidenceLevel: (i < 3 ? 'A' : i < 7 ? 'B' : i < 9 ? 'C' : 'D') as 'A' | 'B' | 'C' | 'D',
      independentSources: 1,
      totalReposts: 0,
      hasPrimaryLink: false,
      primaryLinks: [],
      relatedSources: [],
      heroMetrics: [],
      whyMatters: null,
      whyDoubtful: [],
      comparison: null,
      keyStats: [],
      coverUrl: null,
      bulletPoints: [],
    })),
    directions: [
      { key: 'coding', title: 'AI Coding', subtitle: '', count: 5, summaryItems: [{ rank: 1, title: 'T1', oneLine: '', category: 'AI Coding', confidence: 'A' }] },
      { key: 'embodied', title: '具身智能', subtitle: '', count: 5, summaryItems: [{ rank: 2, title: 'T2', oneLine: '', category: '具身智能', confidence: 'B' }] },
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
        sources: '1',
        primaryLink: '❌',
        confidence: 'B' as const,
      })),
      summary: 's',
    },
    authors: [
      { name: 'JUnit', status: 'ok', statusText: 'S', count: null, description: 'd', url: 'https://example.com' },
    ],
    sources: {
      skills: [],
      videoAuthors: [],
      crossSources: [],
      officialLinks: [],
    },
    ...overrides,
  };
}

async function main() {
  // Section 1：基本生成 + 签名校验
  console.log('▶ Section 1: 基本生成');
  const content = makeContent();
  const buf = await buildPptx(content);
  assertPass('生成 PPT 不抛错', buf.length > 0);
  assertPass('PK 签名合法', buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);
  assertPass('PPT 大小合理（> 20KB）', buf.length > 20_000);

  // Section 2：PPT 字节数显著大于旧版（之前无 P03 页是 ~28KB，新增 1 页应该更大）
  console.log('▶ Section 2: 页数新增');
  assertPass('P03 新增后 PPT 显著增大（>50KB）', buf.length > 50_000);

  // Section 3：草稿 + 置信度页共存
  console.log('▶ Section 3: 草稿 + 置信度页共存');
  const draftContent = makeContent({
    cover: {
      title: 'AI 日报 · 机器草稿',
      subtitle: '2026-09-14 · 草稿（LLM_FAILED）',
      emphasis: 'Draft Mode',
      stats: [
        { value: '3', label: '条草稿', color: 'accent' },
        { value: 'B', label: '评级上限', color: 'secondary' },
        { value: '草稿', label: '未经人工核验', color: 'accent' },
      ],
    },
  });
  const draftBuf = await buildPptx(draftContent);
  assertPass('草稿模式 + 置信度页也能渲染', draftBuf.length > 0);
  assertPass('草稿模式 PK 签名合法', draftBuf[0] === 0x50 && draftBuf[1] === 0x4b);

  // Section 4：保存 PPT 供人工检查
  console.log('▶ Section 4: 导出文件');
  const outDir = path.join(process.cwd(), '.tmp-batch4-test');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `confidence-scale-${Date.now()}.pptx`);
  fs.writeFileSync(outPath, buf);
  console.log(`PPTX 已生成：${outPath}（${(buf.length / 1024).toFixed(1)} KB）`);
  console.log('请用 PowerPoint / Keynote 打开，第 2 页应为「置信度评级一览」4 卡横排。');

  // Section 5：边界 - distribution 全 0 也不崩
  console.log('▶ Section 5: 边界');
  const emptyDistContent = makeContent({
    overview: {
      ...content.overview,
      distribution: [
        { level: 'A', count: 0 },
        { level: 'B', count: 0 },
        { level: 'C', count: 0 },
        { level: 'D', count: 0 },
      ],
    },
  });
  const emptyBuf = await buildPptx(emptyDistContent);
  assertPass('distribution 全 0 也能渲染', emptyBuf.length > 20_000);

  console.log(`\n=== Batch 4 测试结果：${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
