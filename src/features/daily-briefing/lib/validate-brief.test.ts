/**
 * 信源白名单 + validate-brief 测试（Batch 2）
 *
 * 验证：
 * 1. SOURCE_TIERS 包含 6+ 核心源
 * 2. computeIndependentSources 正确合并 tier 3 / 同 group
 * 3. computeConfidenceBySources 按独立信源数判定 A/B/C/D
 * 4. validate-brief 8 类规则全部触发
 * 5. R-08 防评级放宽警告
 */

import {
  SOURCE_TIERS,
  findSourceEntry,
  computeIndependentSources,
  computeConfidenceBySources,
  hasPrimaryOfficial,
} from './source-tiers';
import { validateBrief } from './validate-brief';
import { DEFAULT_CONFIDENCE_SCALE, type Brief } from './brief-schema';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Section 1: SOURCE_TIERS 完整性
// ---------------------------------------------------------------------------

console.log('▶ Section 1: SOURCE_TIERS 完整性');
{
  assertPass('至少包含 6 个核心源', SOURCE_TIERS.length >= 6);

  const tier1 = SOURCE_TIERS.filter(s => s.tier === 1);
  const tier2 = SOURCE_TIERS.filter(s => s.tier === 2);
  const tier3 = SOURCE_TIERS.filter(s => s.tier === 3);

  assertPass('tier 1 至少 3 个一手官方源', tier1.length >= 3);
  assertPass('tier 2 至少 3 个独立报道源', tier2.length >= 3);
  assertPass('tier 3 至少 2 个聚合转载源', tier3.length >= 3);

  // name 必须唯一
  const names = SOURCE_TIERS.map(s => s.name);
  assertPass('name 唯一', new Set(names).size === names.length);
}

// ---------------------------------------------------------------------------
// Section 2: findSourceEntry
// ---------------------------------------------------------------------------

console.log('▶ Section 2: findSourceEntry');
{
  const e1 = findSourceEntry('Anthropic News');
  assertPass('精确匹配 Anthropic News', e1?.tier === 1);

  const e2 = findSourceEntry('anthropic news'); // 大小写不敏感
  assertPass('大小写不敏感', e2?.tier === 1);

  const e3 = findSourceEntry('不存在的源');
  assertPass('未知源返回 null', e3 === null);
}

// ---------------------------------------------------------------------------
// Section 3: computeIndependentSources 合并逻辑
// ---------------------------------------------------------------------------

console.log('▶ Section 3: computeIndependentSources');
{
  // 全 tier 3 → 0（聚合转载不算）
  const r1 = computeIndependentSources(['AITNT 全球 AI 新闻', 'AIBot', 'Hacker News']);
  assertPass('全 tier 3 → 0 独立', r1 === 0);

  // 1 个 tier 2 + 2 个 tier 3 → 1
  const r2 = computeIndependentSources(['TechCrunch AI', 'AITNT 全球 AI 新闻', 'AIBot']);
  assertPass('1 tier2 + 2 tier3 → 1 独立', r2 === 1);

  // 2 个不同 tier 2 → 2
  const r3 = computeIndependentSources(['量子位', '机器之心']);
  assertPass('2 个不同 tier 2 → 2 独立', r3 === 2);

  // 1 tier 1 + 1 tier 2 → 2
  const r4 = computeIndependentSources(['Anthropic News', '量子位']);
  assertPass('1 tier1 + 1 tier2 → 2 独立', r4 === 2);

  // 3 个独立 → 3
  const r5 = computeIndependentSources(['Anthropic News', '量子位', 'TechCrunch AI']);
  assertPass('3 个独立 → 3', r5 === 3);

  // 同 group 不重复算
  // 假设同一集团有 '量子位' 和 '量子位早知道'（白名单只有前者，所以后者算未知 = tier 3）
  const r6 = computeIndependentSources(['量子位', '量子位早知道']);
  assertPass('同集团不同栏目 → 1 独立（早知道算未知）', r6 === 1);
}

// ---------------------------------------------------------------------------
// Section 4: computeConfidenceBySources
// ---------------------------------------------------------------------------

console.log('▶ Section 4: computeConfidenceBySources');
{
  // 0 独立 + 无一手 → D
  assertPass('全 tier 3 → D', computeConfidenceBySources(['AITNT 全球 AI 新闻']) === 'D');

  // 1 tier 2 → C
  assertPass('1 tier 2 → C', computeConfidenceBySources(['量子位']) === 'C');

  // 1 tier 1（官方） → B（一手 + 单源）
  assertPass('1 tier 1 → B', computeConfidenceBySources(['Anthropic News']) === 'B');

  // 2 tier 2 → B
  assertPass('2 tier 2 → B', computeConfidenceBySources(['量子位', '机器之心']) === 'B');

  // 3 tier 2 → A
  assertPass('3 tier 2 → A',
    computeConfidenceBySources(['量子位', '机器之心', 'TechCrunch AI']) === 'A');

  // 1 tier 1 + 1 tier 2 → B
  assertPass('1 tier1 + 1 tier2 → B',
    computeConfidenceBySources(['Anthropic News', '量子位']) === 'B');

  // 1 tier 1 + 2 tier 2 → A（≥3 独立）
  assertPass('1 tier1 + 2 tier2 → A',
    computeConfidenceBySources(['Anthropic News', '量子位', 'TechCrunch AI']) === 'A');
}

// ---------------------------------------------------------------------------
// Section 5: hasPrimaryOfficial
// ---------------------------------------------------------------------------

console.log('▶ Section 5: hasPrimaryOfficial');
{
  assertPass('含 Anthropic → true', hasPrimaryOfficial(['Anthropic News', '量子位']));
  assertPass('仅量子位 → false', !hasPrimaryOfficial(['量子位', 'TechCrunch AI']));
  assertPass('空数组 → false', !hasPrimaryOfficial([]));
}

// ---------------------------------------------------------------------------
// Section 6: validate-brief 8 类规则
// ---------------------------------------------------------------------------

console.log('▶ Section 6: validate-brief 业务规则');

const basePick = {
  no: 1,
  topic: 'AI Coding' as const,
  title: '测试标题：足够长的描述以满足校验',
  lv: 'A' as const,
  publishedAt: '2026-09-14',
  event: '这是一个测试事件描述，足够长以满足校验要求，至少 40 字符以上才算合规。',
  keyFacts: ['关键事实 1', '关键事实 2', '关键事实 3'],
  why: '这是一个 why 字段的测试，必须至少 40 字符才算合规。删掉它读者会损失什么信息？',
  sources: [{ name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true }],
  conflicts: '无实质冲突',
};

const baseBrief: Brief = {
  date: '2026-09-14',
  headline: '这是一个 headline 字段，必须至少 20 字符以满足校验。',
  focus: ['AI Coding'],
  confidenceScale: DEFAULT_CONFIDENCE_SCALE,
  picks: [basePick],
  alsoWorthAScan: [],
};

// R-01: 标 A 但独立信源 <3
{
  const b: Brief = {
    ...baseBrief,
    picks: [{ ...basePick, lv: 'A', sources: [{ name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true }] }],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-01');
  assertPass('R-01 触发（标 A 但仅 1 个独立源）', !!e && e.severity === 'error');
  assertPass('R-01 失败时 ok = false', !r.ok);
}

// R-02: 标 A 但无一手
{
  const b: Brief = {
    ...baseBrief,
    picks: [{ ...basePick, lv: 'A', sources: [
      { name: '量子位', url: 'https://qbitai.com/x', isPrimary: false },
      { name: '机器之心', url: 'https://jiqizhixin.com/x', isPrimary: false },
      { name: 'TechCrunch AI', url: 'https://tc.com/x', isPrimary: false },
    ]}],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-02');
  assertPass('R-02 触发（标 A 但无 tier 1）', !!e && e.severity === 'error');
}

// R-03: 标 B 但全 tier 3
{
  const b: Brief = {
    ...baseBrief,
    picks: [{ ...basePick, lv: 'B', sources: [{ name: 'AITNT 全球 AI 新闻', url: 'https://aitnt.com/x', isPrimary: false }] }],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-03');
  assertPass('R-03 触发（标 B 但全 tier 3）', !!e && e.severity === 'error');
}

// R-04: publishedAt 晚于日报日期
{
  const b: Brief = {
    ...baseBrief,
    picks: [{ ...basePick, publishedAt: '2026-09-20' }],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-04');
  assertPass('R-04 触发（publishedAt 晚于日报日期）', !!e && e.severity === 'error');
}

// R-05: why <40 字
{
  const b: Brief = {
    ...baseBrief,
    picks: [{ ...basePick, why: '太短' }],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-05');
  assertPass('R-05 触发（why <40 字）', !!e && e.severity === 'warning');
}

// R-06: 一手来源未排第一
{
  const b: Brief = {
    ...baseBrief,
    picks: [{ ...basePick, sources: [
      { name: '量子位', url: 'https://qbitai.com/x', isPrimary: false },
      { name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true },
    ]}],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-06');
  assertPass('R-06 触发（一手未排第一）', !!e && e.severity === 'warning');
}

// R-07: B 级 + conflicts 缺失 → 警告（B 级至少 2 个源，应该说明差异）
{
  // 用 parseBriefLoose 跳过 default 替换
  const rawPick = {
    ...basePick,
    lv: 'B' as const,
    conflicts: '',
    sources: [
      { name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true },
      { name: '量子位', url: 'https://qbitai.com/x', isPrimary: false },
    ],
  };
  const b: Brief = {
    ...baseBrief,
    picks: [rawPick as any],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-07');
  assertPass('R-07 触发（B 级 conflicts 为空字符串）', !!e && e.severity === 'warning');
}

// R-08: 无 C/D 级条目
{
  const b: Brief = {
    ...baseBrief,
    picks: [
      { ...basePick, no: 1, lv: 'A', sources: [
        { name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true },
        { name: '量子位', url: 'https://qbitai.com/x', isPrimary: false },
        { name: 'TechCrunch AI', url: 'https://tc.com/x', isPrimary: false },
      ]},
      { ...basePick, no: 2, lv: 'B', sources: [
        { name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true },
        { name: '量子位', url: 'https://qbitai.com/x', isPrimary: false },
      ]},
      { ...basePick, no: 3, lv: 'A', sources: [
        { name: 'OpenAI Blog', url: 'https://openai.com/x', isPrimary: true },
        { name: '机器之心', url: 'https://jiqizhixin.com/x', isPrimary: false },
        { name: 'MIT Technology Review AI', url: 'https://mit.com/x', isPrimary: false },
      ]},
    ],
  };
  const r = validateBrief(b);
  const e = r.issues.find(i => i.rule === 'R-08');
  assertPass('R-08 触发（无 C/D 级条目）', !!e && e.severity === 'warning');
}

// 综合：合法 brief 应通过
{
  const b: Brief = {
    ...baseBrief,
    picks: [
      { ...basePick, no: 1, lv: 'A', sources: [
        { name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true },
        { name: '量子位', url: 'https://qbitai.com/x', isPrimary: false },
        { name: 'TechCrunch AI', url: 'https://tc.com/x', isPrimary: false },
      ]},
      { ...basePick, no: 2, lv: 'C', sources: [{ name: '机器之心', url: 'https://jiqizhixin.com/x', isPrimary: false }] },
      { ...basePick, no: 3, lv: 'B', sources: [
        { name: 'Anthropic News', url: 'https://anthropic.com/x', isPrimary: true },
        { name: '量子位', url: 'https://qbitai.com/x', isPrimary: false },
      ]},
    ],
  };
  const r = validateBrief(b);
  assertPass('合法 brief 通过（无 error）', r.ok);
}

// ---------------------------------------------------------------------------
// 总结
// ---------------------------------------------------------------------------

console.log(`\n=== Batch 2 测试结果：${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
