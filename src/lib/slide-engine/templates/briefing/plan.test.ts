/**
 * plan.ts clip helper 测试
 * 验证截断逻辑不会让下游 page schema 抛 ZodError
 */
import assert from 'node:assert/strict';

let passed = 0, failed = 0;
function it(name: string, fn: () => void) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${(e as Error).message}`); failed++; }
}

// 直接用 DailyReportContentSchema + planBriefingDeck 验证
import { planBriefingDeck, DailyReportContentSchema } from '@/lib/slide-engine/templates/briefing/plan';

function makeContent(overrides: Record<string, any> = {}) {
  return DailyReportContentSchema.parse({
    version: 4,
    date: '2026-09-13',
    generatedAt: '2026-09-13T00:00:00Z',
    cover: { title: 't', subtitle: 's', emphasis: 'e', stats: [{ value: '1', label: 'l' }, { value: '2', label: 'l' }, { value: '3', label: 'l' }] },
    overview: {
      intro: 'i',
      methodNote: 'm',
      sources: [
        { name: 'n1', description: 'd', icon: 'file-text', color: 'primary' },
        { name: 'n2', description: 'd', icon: 'comment', color: 'secondary' },
        { name: 'n3', description: 'd', icon: 'check-circle', color: 'primary' },
        { name: 'n4', description: 'd', icon: 'share', color: 'accent' },
      ],
      tlDr: ['a', 'b', 'c'],
      confidenceLegend: [
        { level: 'A', label: 'A', color: 'primary', rule: 'r' },
        { level: 'B', label: 'B', color: 'primary', rule: 'r' },
        { level: 'C', label: 'C', color: 'secondary', rule: 'r' },
        { level: 'D', label: 'D', color: 'accent', rule: 'r' },
      ],
      distribution: [
        { level: 'A', count: 0 }, { level: 'B', count: 5 }, { level: 'C', count: 0 }, { level: 'D', count: 0 },
      ],
    },
    directions: [
      { key: 'coding', title: 'Coding', subtitle: 'sub', count: 3,
        summaryItems: [{ rank: 1, title: 'long', oneLine: 'o', category: 'c', confidence: 'B' }] },
    ],
    items: [
      { rank: 1, title: 'long', source: 's', url: 'https://example.com', publishedAt: '—',
        summary: '中'.repeat(350), comment: '', category: null, direction: 'coding', confidenceLevel: 'B',
        independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [],
        heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [],
        coverUrl: null, bulletPoints: [] },
      { rank: 2, title: 't2', source: 's', url: 'https://example.com', publishedAt: '—', summary: 's2', comment: '', category: null, direction: 'coding', confidenceLevel: 'C', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 3, title: 't3', source: 's', url: 'https://example.com', publishedAt: '—', summary: 's3', comment: '', category: null, direction: 'coding', confidenceLevel: 'C', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
    ],
    authors: [{ name: 'a', status: 'ok', statusText: 's', count: null, description: 'd', url: 'https://example.com' }],
    verificationTable: {
      rows: [
        { rank: '1', topic: 't', direction: 'Coding', sources: '1', primaryLink: '✅ a', confidence: 'B' },
        { rank: '2', topic: 't', direction: 'Coding', sources: '1', primaryLink: '✅ a', confidence: 'B' },
        { rank: '3', topic: 't', direction: 'Coding', sources: '1', primaryLink: '✅ a', confidence: 'B' },
        { rank: '4', topic: 't', direction: 'Coding', sources: '1', primaryLink: '✅ a', confidence: 'B' },
        { rank: '5', topic: 't', direction: 'Coding', sources: '1', primaryLink: '✅ a', confidence: 'B' },
      ],
      summary: '正常 summary',
    },
    trends: [{ rank: 1, title: 't', description: 'd' }, { rank: 2, title: 't', description: 'd' }, { rank: 3, title: 't', description: 'd' }],
    sources: { skills: [], videoAuthors: [], crossSources: [], officialLinks: [] },
    ...overrides,
  });
}

it('clip 修复：summary 350 字符 → plan 不抛错且截断到 ≤200', () => {
  const c = makeContent();
  const entries = planBriefingDeck(c);
  const detail = entries.find(e => e.pageType === 'direction-detail');
  assert.ok(detail, '应该有 direction-detail 页');
  const itemSummary = (detail as any).content.item.summary;
  assert.ok(itemSummary.length <= 200, `summary 应 ≤200，实际 ${itemSummary.length}`);
  assert.ok(itemSummary.endsWith('…'), '长字符串应被 … 截断');
});

it('clip 修复：summary 50 字符（短） → 原样保留', () => {
  const c = makeContent({
    items: [
      { rank: 1, title: 'short', source: 's', url: 'https://example.com', publishedAt: '—',
        summary: '短的 summary'.repeat(3), comment: '', category: null, direction: 'coding', confidenceLevel: 'B',
        independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [],
        heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [],
        coverUrl: null, bulletPoints: [] },
      { rank: 2, title: 't2', source: 's', url: 'https://example.com', publishedAt: '—', summary: 's2', comment: '', category: null, direction: 'coding', confidenceLevel: 'C', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
      { rank: 3, title: 't3', source: 's', url: 'https://example.com', publishedAt: '—', summary: 's3', comment: '', category: null, direction: 'coding', confidenceLevel: 'C', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
    ],
  });
  const entries = planBriefingDeck(c);
  const detail = entries.find(e => e.pageType === 'direction-detail');
  const itemSummary = (detail as any).content.item.summary;
  assert.ok(itemSummary.length < 200);
  assert.ok(!itemSummary.endsWith('…'), '短字符串不应被截断');
});

it('clip 修复：verificationTable.summary 150 字符 → 截断到 ≤120', () => {
  const c = makeContent({ verificationTable: { rows: makeContent().verificationTable.rows, summary: 'z'.repeat(150) } });
  const entries = planBriefingDeck(c);
  const verification = entries.find(e => e.pageType === 'verification');
  assert.ok(verification);
  assert.ok((verification as any).content.summary.length <= 120);
});

it('clip 修复：verificationTable.rows[].primaryLink 超 20 字符 → 截断', () => {
  const rows5 = Array.from({ length: 5 }, (_, i) => ({
    rank: String(i + 1), topic: 't', direction: 'Coding', sources: '1', primaryLink: '✅ https://very-long-url.com/' + i, confidence: 'B' as const,
  }));
  rows5[0].primaryLink = '✅ short';
  for (let i = 1; i < 5; i++) {
    rows5[i].primaryLink = '✅ https://very-long-url-' + i + '.com/very/long/path/abc/def/ghi';
  }
  const c = makeContent({ verificationTable: { rows: rows5, summary: '正常' } });
  const entries = planBriefingDeck(c);
  const verification = entries.find(e => e.pageType === 'verification');
  const rows = (verification as any).content.rows;
  assert.equal(rows[0].primaryLink, '✅ short');
  for (let i = 1; i < 5; i++) {
    assert.ok(rows[i].primaryLink.length <= 20, `row[${i}].primaryLink 长度 ${rows[i].primaryLink.length} > 20`);
    assert.ok(rows[i].primaryLink.endsWith('…'), `row[${i}] 应被 … 截断`);
  }
});

it('R-7 全字段 STRING_FIELD_MAX：trends[i].title 超 20 字符 → clip 到 ≤20', () => {
  const c = makeContent({
    trends: [
      { rank: 1, title: '短', description: 'd' },
      { rank: 2, title: 'a'.repeat(50), description: 'd' },  // 50 字符
      { rank: 3, title: '短的', description: 'd' },
    ],
  });
  const entries = planBriefingDeck(c);
  const trends = entries.find(e => e.pageType === 'trends');
  assert.ok(trends);
  const titles = (trends as any).content.trends.map((t: any) => t.title);
  assert.ok(titles[1].length <= 20, `trends[1].title 应 ≤20，实际 ${titles[1].length}`);
  // 短的保持原样
  assert.equal(titles[0], '短');
  assert.equal(titles[2], '短的');
});

it('R-7 全字段 STRING_FIELD_MAX：verification row topic 超 40 字符 → clip', () => {
  const rows5 = Array.from({ length: 5 }, (_, i) => ({
    rank: String(i + 1),
    topic: i === 2 ? 'z'.repeat(60) : '正常',
    direction: 'Coding',
    sources: '1',
    primaryLink: '✅ a',
    confidence: 'B' as const,
  }));
  const c = makeContent({ verificationTable: { rows: rows5, summary: '正常' } });
  const entries = planBriefingDeck(c);
  const verification = entries.find(e => e.pageType === 'verification');
  const rows = (verification as any).content.rows;
  assert.ok(rows[2].topic.length <= 40, `topic 应 ≤40，实际 ${rows[2].topic.length}`);
});

console.log(`\n=== ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
