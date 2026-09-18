/**
 * postprocess.ts 单元测试
 * 覆盖 6 个修复规则
 */
import assert from 'node:assert/strict';
import { repairContent } from './postprocess';

let passed = 0, failed = 0;
function it(name: string, fn: () => void) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${(e as Error).message}`); failed++; }
}

// 构造一个 minimal content（postprocess 只读它需要读的字段）
function makeContent(overrides: Record<string, any> = {}) {
  return {
    version: 4,
    date: '2026-09-13',
    generatedAt: '2026-09-13T00:00:00Z',
    cover: { title: 't', subtitle: 's', emphasis: 'e', stats: [{ value: '1', label: 'l', color: 'primary' }] },
    overview: {
      intro: 'i',
      methodNote: 'm',
      sources: [{ name: 'n', description: 'd', icon: 'file-text', color: 'primary' }],
      tlDr: ['a', 'b', 'c'],
      confidenceLegend: [
        { level: 'A', label: 'A 极高', color: 'primary', rule: 'r' },
        { level: 'B', label: 'B 高', color: 'primary', rule: 'r' },
        { level: 'C', label: 'C 中', color: 'secondary', rule: 'r' },
        { level: 'D', label: 'D 存疑', color: 'accent', rule: 'r' },
      ],
      distribution: [
        { level: 'B', count: 4 },
        { level: 'C', count: 5 },
        { level: 'D', count: 2 },
      ],
    },
    directions: [],
    items: [],
    authors: [],
    verificationTable: { rows: [], summary: 's' },
    trends: [{ rank: 1, title: 't', description: 'd' }, { rank: 2, title: 't', description: 'd' }, { rank: 3, title: 't', description: 'd' }],
    sources: { skills: [], videoAuthors: [], crossSources: [], officialLinks: [] },
    ...overrides,
  };
}

// ── 1. distribution 必须 4 个 ─────────────────────────────────────────────
it('规则1：distribution 只有 3 个元素（A 缺）→ 自动补 {level:A, count:0}', () => {
  const c = makeContent();
  const r = repairContent(c);
  assert.equal(r.overview.distribution.length, 4);
  const levels = r.overview.distribution.map((d: any) => d.level);
  assert.deepEqual(levels, ['A', 'B', 'C', 'D']);
  // B 仍是 4
  assert.equal(r.overview.distribution.find((d: any) => d.level === 'B')!.count, 4);
  // A 补 0
  assert.equal(r.overview.distribution.find((d: any) => d.level === 'A')!.count, 0);
});

it('规则1：distribution 缺 B 和 D → 补全并保留 A/C 原值', () => {
  const c = makeContent({
    overview: {
      ...makeContent().overview,
      distribution: [{ level: 'A', count: 2 }, { level: 'C', count: 3 }],
    },
  });
  const r = repairContent(c);
  assert.equal(r.overview.distribution.length, 4);
  assert.equal(r.overview.distribution.find((d: any) => d.level === 'A')!.count, 2);
  assert.equal(r.overview.distribution.find((d: any) => d.level === 'C')!.count, 3);
  assert.equal(r.overview.distribution.find((d: any) => d.level === 'B')!.count, 0);
  assert.equal(r.overview.distribution.find((d: any) => d.level === 'D')!.count, 0);
});

// ── 2. confidenceLegend 必须 4 个 ────────────────────────────────────────
it('规则2：confidenceLegend 只有 3 个 → 补全缺的（D 缺）', () => {
  const c = makeContent();
  // 删掉 D
  c.overview.confidenceLegend = c.overview.confidenceLegend.filter((l: any) => l.level !== 'D');
  const r = repairContent(c);
  assert.equal(r.overview.confidenceLegend.length, 4);
  const d = r.overview.confidenceLegend.find((l: any) => l.level === 'D');
  assert.ok(d);
  assert.equal(d.label, 'D 存疑');
  assert.equal(d.color, 'accent');
});

// ── 3. independentSources ≤0 → 1 ──────────────────────────────────────────
it('规则3：independentSources=0 → 改为 1', () => {
  const c = makeContent({
    items: [{ independentSources: 0, title: 'a' }, { independentSources: 5, title: 'b' }],
  });
  const r = repairContent(c);
  assert.equal(r.items[0].independentSources, 1);
  assert.equal(r.items[1].independentSources, 5);
});

it('规则3：independentSources=undefined/-1/NaN → 1', () => {
  const c = makeContent({
    items: [{ title: 'a' }, { independentSources: -1, title: 'b' }, { independentSources: 'abc', title: 'c' }],
  });
  const r = repairContent(c);
  assert.equal(r.items[0].independentSources, 1);
  assert.equal(r.items[1].independentSources, 1);
  assert.equal(r.items[2].independentSources, 1);
});

// ── 4. primaryLink 超长 → 截断 ───────────────────────────────────────────
it('规则4：primaryLink 超 30 字符 → 截断到 29 + …', () => {
  const c = makeContent({
    verificationTable: {
      rows: [
        { primaryLink: '✅ short' },
        { primaryLink: '✅ https://very-long-url.com/very-long-path/abc' },
      ],
      summary: 's',
    },
  });
  const r = repairContent(c);
  assert.equal(r.verificationTable.rows[0].primaryLink, '✅ short');
  assert.ok(r.verificationTable.rows[1].primaryLink.length <= 30);
  assert.ok(r.verificationTable.rows[1].primaryLink.endsWith('…'));
});

it('规则4：primaryLink=空字符串 / undefined → 保留原值', () => {
  const c = makeContent({
    verificationTable: {
      rows: [{ primaryLink: '' }, {}],
      summary: 's',
    },
  });
  const r = repairContent(c);
  assert.equal(r.verificationTable.rows[0].primaryLink, '');
  // undefined primaryLink 不是 string，原样保留
  assert.equal(r.verificationTable.rows[1].primaryLink, undefined);
});

// ── 5. trends 必须 3 条 ──────────────────────────────────────────────────
it('规则5：trends 只有 2 条 → 复制最后一条补到 3', () => {
  const c = makeContent({
    trends: [{ rank: 1, title: 't1', description: 'd1' }, { rank: 2, title: 't2', description: 'd2' }],
  });
  const r = repairContent(c);
  assert.equal(r.trends.length, 3);
  assert.equal(r.trends[2].title, 't2'); // 复制 last
  assert.equal(r.trends[2].description, 'd2');
});

it('规则5：trends 有 5 条 → 截断到 3', () => {
  const c = makeContent({
    trends: [
      { rank: 1, title: 'a', description: 'a' },
      { rank: 2, title: 'b', description: 'b' },
      { rank: 3, title: 'c', description: 'c' },
      { rank: 4, title: 'd', description: 'd' },
      { rank: 5, title: 'e', description: 'e' },
    ],
  });
  const r = repairContent(c);
  assert.equal(r.trends.length, 3);
  assert.equal(r.trends[2].title, 'c');
});

it('规则5：trends 为空 → 用 fallback 3 条', () => {
  const c = makeContent({ trends: [] });
  const r = repairContent(c);
  assert.equal(r.trends.length, 3);
  assert.equal(r.trends[0].title, '数据暂不可用');
});

// ── 6. tlDr 至少 2 条 ─────────────────────────────────────────────────────
it('规则6：tlDr 只有 1 条 → 补到 2', () => {
  const c = makeContent({ overview: { ...makeContent().overview, tlDr: ['only one'] } });
  const r = repairContent(c);
  assert.equal(r.overview.tlDr.length, 2);
  assert.ok((r.overview as any).tlDr.every((x: any) => typeof x === 'string'));
});

// ── 7. 跨字段一致性：distribution 以 items 为准重算 ───────────────────────
it('规则7：distribution 与 items 不符 → 按 items 重算', () => {
  const c = makeContent({
    // LLM 报了 B4·C5·D2（合计 11），但 items 实际是 C7·D1
    items: [
      ...Array.from({ length: 7 }, (_, i) => ({ title: `c${i}`, confidenceLevel: 'C' })),
      { title: 'd0', confidenceLevel: 'D' },
    ],
    overview: {
      ...makeContent().overview,
      distribution: [
        { level: 'A', count: 0 },
        { level: 'B', count: 4 },
        { level: 'C', count: 5 },
        { level: 'D', count: 2 },
      ],
    },
  });
  const r = repairContent(c);
  const got = Object.fromEntries(r.overview.distribution.map((d: any) => [d.level, d.count]));
  assert.deepEqual(got, { A: 0, B: 0, C: 7, D: 1 });
});

it('规则7：cover 统计卡的条数与置信度分布同步', () => {
  const c = makeContent({
    cover: {
      title: 'AI 日报',
      subtitle: 's',
      emphasis: 'e',
      stats: [
        { value: '11', label: '条精选新闻', color: 'primary' },
        { value: '4', label: '类信源家族', color: 'secondary' },
        { value: 'B4·C5·D2', label: '置信度分布', color: 'accent' },
      ],
    },
    items: [
      { title: 'a', confidenceLevel: 'B' },
      { title: 'b', confidenceLevel: 'B' },
      { title: 'c', confidenceLevel: 'D' },
    ],
  });
  const r = repairContent(c);
  assert.equal(r.cover.stats[0].value, '3');       // 条数按 items.length
  assert.equal(r.cover.stats[1].value, '4');       // 无关卡不动
  assert.equal(r.cover.stats[2].value, 'B2·D1');   // 分布按 items 重算
});

it('规则7：items 完全没有合法 confidenceLevel → 不重算（保留 LLM 原值）', () => {
  const c = makeContent({
    items: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
  });
  const r = repairContent(c);
  // 原 distribution B4/C5/D2 保持，不被清零
  const got = Object.fromEntries(r.overview.distribution.map((d: any) => [d.level, d.count]));
  assert.deepEqual(got, { A: 0, B: 4, C: 5, D: 2 });
});

it('规则7：distribution 已与 items 一致 → 保持（幂等）', () => {
  const c = makeContent({
    items: [
      { title: 'a', confidenceLevel: 'C' },
      { title: 'b', confidenceLevel: 'D' },
    ],
    overview: {
      ...makeContent().overview,
      distribution: [
        { level: 'A', count: 0 },
        { level: 'B', count: 0 },
        { level: 'C', count: 1 },
        { level: 'D', count: 1 },
      ],
    },
  });
  const r = repairContent(c);
  const twice = repairContent(r);
  assert.deepEqual(twice.overview.distribution, r.overview.distribution);
});

// ── 复合场景：e2e 实际错误一次性修复 ─────────────────────────────────────
it('复合：e2e 真实错误的 3 类违反一次性修复', () => {
  const c = makeContent({
    overview: {
      ...makeContent().overview,
      // 违反 #1：distribution 只有 3 个
      distribution: [{ level: 'B', count: 4 }, { level: 'C', count: 5 }, { level: 'D', count: 2 }],
      confidenceLegend: [{ level: 'A', label: 'A', color: 'primary', rule: 'r' }],  // 违反 #2
    },
    // 违反 #3：independentSources=0
    items: [{ independentSources: 0, title: 'x' }, { independentSources: 0, title: 'y' }, { independentSources: 0, title: 'z' }],
    verificationTable: {
      rows: [
        { primaryLink: '✅ short' },
        { primaryLink: '✅ short' },
        { primaryLink: '✅ https://very-long-url.com/very-long-path/abc' },
      ],
      summary: 's',
    },
  });
  const r = repairContent(c);
  // 修复 #1
  assert.equal(r.overview.distribution.length, 4);
  // 修复 #2
  assert.equal(r.overview.confidenceLegend.length, 4);
  // 修复 #3
  assert.ok(r.items.every((it: any) => it.independentSources >= 1));
  // 修复 #4
  assert.ok(r.verificationTable.rows[2].primaryLink.length <= 30);
});

console.log(`\n=== ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) process.exit(1);
