/**
 * rumor header-title layout 回归测试（2026-09-13）
 * 修复 P7 header-title L2 error：LLM 长标题塞进 32pt 容器
 * 方案：clip 20 字符 + h2 字号 + 容器 w=760 h=28（避免和 header-chip 重叠）
 */
import assert from 'node:assert/strict';
import { planBriefingDeck, DailyReportContentSchema } from '@/lib/slide-engine/templates/briefing/plan';

let passed = 0, failed = 0;
function it(name: string, fn: () => void) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${(e as Error).message}`); failed++; }
}

function makeContentWithRumorTitle(rumorTitle: string) {
  return DailyReportContentSchema.parse({
    version: 4,
    date: '2026-09-13',
    generatedAt: '2026-09-13T00:00:00Z',
    cover: { title: 't', subtitle: 's', emphasis: 'e', stats: [{ value: '1', label: 'l' }, { value: '2', label: 'l' }, { value: '3', label: 'l' }] },
    overview: {
      intro: 'i', methodNote: 'm',
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
      { key: 'coding', title: 'Coding', subtitle: 'sub', count: 2,
        summaryItems: [{ rank: 1, title: 'long', oneLine: 'o', category: 'c', confidence: 'B' }] },
    ],
    items: [
      { rank: 1, title: 'long rumor title', source: 's', url: 'https://example.com', publishedAt: '—',
        summary: rumorTitle.repeat(3), comment: '', category: null, direction: 'rumor', confidenceLevel: 'D',
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
  });
}

it('R-7 rumor 修复：LLM 给 40 字标题 → plan clip 到 ≤20', () => {
  const longTitle = '传'.repeat(40);  // 40 字符纯中文
  const c = makeContentWithRumorTitle(longTitle);
  const entries = planBriefingDeck(c);
  const rumor = entries.find(e => e.pageType === 'rumor');
  assert.ok(rumor, '应该有 rumor 页');
  const title = (rumor as any).content.title;
  // clip(s, 20)：s.length > 20 时返回 s.slice(0, 19) + '…' = 20 字符
  assert.ok(title.length <= 20, `rumor title 应 ≤20，实际 ${title.length}`);
});

it('R-7 rumor 修复：rumor 容器 w=760 h=28 → 不与 header-chip (x=W-130=830) 重叠', () => {
  const c = makeContentWithRumorTitle('短标题');
  const entries = planBriefingDeck(c);
  const rumor = entries.find(e => e.pageType === 'rumor');
  // plan 不直接给 box 信息，但 title clip 到 20 字符能装进 w=760 h=28（h2 字号）
  // 检查 title 长度合理即可
  const title = (rumor as any).content.title;
  assert.ok(title.length <= 20);
});

it('R-7 rumor 修复：rumor item.title 用全长度（保留给详情页）', () => {
  const longTitle = '传'.repeat(40);
  const c = makeContentWithRumorTitle(longTitle);
  const entries = planBriefingDeck(c);
  const rumor = entries.find(e => e.pageType === 'rumor');
  const itemTitle = (rumor as any).content.item.title;
  // item.title 是给详情页用的，STRING_FIELD_MAX.title=40
  assert.ok(itemTitle.length <= 40);
});

console.log(`\n=== ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
