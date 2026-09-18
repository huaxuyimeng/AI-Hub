/**
 * QA 守门员单元测试（C1）
 * 运行：npx tsx src/features/daily-briefing/lib/qa-gate.test.ts
 */

import { runLayoutQA, upgradeDegradedReason } from './qa-gate';
import type { DailyReportContent } from './types';
import type { LintIssue } from '@/lib/slide-engine/contracts/lint';

let failed = 0;
let total = 0;

function pass(msg: string): void {
  total += 1;
  console.log(`PASS: ${msg}`);
}

function fail(msg: string): void {
  total += 1;
  failed += 1;
  console.error(`FAIL: ${msg}`);
}

// =============== 最小可跑 fixture ===============

const MINIMAL: DailyReportContent = {
  version: 4,
  date: '2026-09-13',
  generatedAt: new Date().toISOString(),
  cover: {
    title: 'AI 日报',
    subtitle: '2026-09-13',
    emphasis: '测试',
    stats: [
      { value: '0', label: 'a', color: 'primary' },
      { value: '0', label: 'b', color: 'secondary' },
      { value: '0', label: 'c', color: 'accent' },
    ],
  },
  overview: {
    intro: '测试',
    methodNote: '方法',
    sources: [
      { name: 'a', description: 'a', icon: 'a', color: 'primary' },
      { name: 'b', description: 'b', icon: 'b', color: 'secondary' },
      { name: 'c', description: 'c', icon: 'c', color: 'accent' },
      { name: 'd', description: 'd', icon: 'd', color: 'primary' },
    ],
    tlDr: ['TL;DR 1：这是一段足够长的文本以测试折行。', 'TL;DR 2：第二段 TL;DR 测试。'],
    confidenceLegend: [
      { level: 'A', label: 'A', color: 'primary', rule: 'rule' },
      { level: 'B', label: 'B', color: 'primary', rule: 'rule' },
      { level: 'C', label: 'C', color: 'secondary', rule: 'rule' },
      { level: 'D', label: 'D', color: 'accent', rule: 'rule' },
    ],
    distribution: [
      { level: 'A', count: 0 },
      { level: 'B', count: 1 },
      { level: 'C', count: 0 },
      { level: 'D', count: 0 },
    ],
  },
  directions: [
    {
      key: 'coding',
      title: 'Coding',
      subtitle: 'sub',
      count: 1,
      summaryItems: [{ rank: 1, title: 't', oneLine: 'o', category: 'c', confidence: 'B' }],
    },
  ],
  items: [
    { rank: 1, title: 't', source: 's', url: 'https://example.com', publishedAt: '2026-09-13 10:00', summary: 'summary', comment: 'c', category: null, direction: 'coding', confidenceLevel: 'B', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
    { rank: 2, title: 't2', source: 's2', url: 'https://example.com/2', publishedAt: '2026-09-13 11:00', summary: 's2', comment: 'c', category: null, direction: 'coding', confidenceLevel: 'B', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
    { rank: 3, title: 't3', source: 's3', url: 'https://example.com/3', publishedAt: '2026-09-13 12:00', summary: 's3', comment: 'c', category: null, direction: 'coding', confidenceLevel: 'B', independentSources: 1, totalReposts: 0, hasPrimaryLink: false, primaryLinks: [], relatedSources: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [] },
  ],
  authors: [
    { name: 'a', status: 'ok', statusText: 'ok', count: 1, description: 'd', url: 'https://example.com/a' },
  ],
  verificationTable: {
    rows: [
      { rank: '1', topic: 't', direction: 'C', sources: '1', primaryLink: '✅', confidence: 'B' },
      { rank: '2', topic: 't', direction: 'C', sources: '1', primaryLink: '✅', confidence: 'B' },
      { rank: '3', topic: 't', direction: 'C', sources: '1', primaryLink: '✅', confidence: 'B' },
      { rank: '4', topic: 't', direction: 'C', sources: '1', primaryLink: '✅', confidence: 'B' },
      { rank: '5', topic: 't', direction: 'C', sources: '1', primaryLink: '✅', confidence: 'B' },
    ],
    summary: 'sum',
  },
  trends: [
    { rank: 1, title: 't1', description: 'd1' },
    { rank: 2, title: 't2', description: 'd2' },
    { rank: 3, title: 't3', description: 'd3' },
  ],
  sources: {
    skills: [{ name: 's', url: 'https://example.com' }],
    videoAuthors: [{ name: 'a', url: 'https://example.com/a' }],
    crossSources: [],
    officialLinks: [],
  },
};

// =============== runLayoutQA ===============

console.log('▶ runLayoutQA');
{
  const qa = runLayoutQA(MINIMAL);
  qa.pageCount > 0 ? pass('fixture 至少渲染 1 页') : fail(`pageCount=${qa.pageCount}`);
  Array.isArray(qa.issues) ? pass('issues 是数组') : fail('issues 非数组');
  typeof qa.durationMs === 'number' && qa.durationMs >= 0 ? pass('durationMs 是数字') : fail(`durationMs=${qa.durationMs}`);
  // 不强求 passed——因为 tlDr 长度的细节可能因 plan 不同而不同；只校验结构
  typeof qa.passed === 'boolean' ? pass('passed 是布尔') : fail('passed 非布尔');
}

// =============== upgradeDegradedReason 行为 ===============

console.log('\n▶ upgradeDegradedReason');
{
  // 空 issues
  const empty: LintIssue[] = [];
  upgradeDegradedReason({ passed: true, issues: empty, pageCount: 10, durationMs: 5 }) === null
    ? pass('空 issues → null')
    : fail('空 issues 应该返回 null');

  // 3 个 warn（边界，不升级）
  const threeWarns: LintIssue[] = [
    { rule: 'L6', pageNo: 1, level: 'warn', detail: 'a' },
    { rule: 'L6', pageNo: 2, level: 'warn', detail: 'b' },
    { rule: 'L6', pageNo: 3, level: 'warn', detail: 'c' },
  ];
  upgradeDegradedReason({ passed: true, issues: threeWarns, pageCount: 10, durationMs: 5 }) === null
    ? pass('3 warn → null（边界不升级）')
    : fail('3 warn 应该返回 null');

  // 4 个 warn → 升级 reason（不升级 degraded）
  const fourWarns: LintIssue[] = [
    { rule: 'L6', pageNo: 1, level: 'warn', detail: 'a' },
    { rule: 'L6', pageNo: 2, level: 'warn', detail: 'b' },
    { rule: 'L6', pageNo: 3, level: 'warn', detail: 'c' },
    { rule: 'L6', pageNo: 4, level: 'warn', detail: 'd' },
  ];
  const r4 = upgradeDegradedReason({ passed: true, issues: fourWarns, pageCount: 10, durationMs: 5 });
  r4 && r4.includes('4 条 warn') ? pass('4 warn → 返回 warn reason') : fail(`4 warn reason 错: ${r4}`);

  // 1 个 error → 返回 error reason
  const oneErr: LintIssue[] = [
    { rule: 'L1', pageNo: 1, level: 'error', detail: '越界' },
  ];
  const rE = upgradeDegradedReason({ passed: false, issues: oneErr, pageCount: 10, durationMs: 5 });
  rE && rE.includes('1 条 error') && rE.includes('[L1]P1') ? pass('1 error → 含 rule 与 pageNo') : fail(`1 error reason 错: ${rE}`);

  // 5 个 error → reason 含 … 截断
  const fiveErr: LintIssue[] = [
    { rule: 'L1', pageNo: 1, level: 'error', detail: 'a' },
    { rule: 'L1', pageNo: 2, level: 'error', detail: 'b' },
    { rule: 'L1', pageNo: 3, level: 'error', detail: 'c' },
    { rule: 'L1', pageNo: 4, level: 'error', detail: 'd' },
    { rule: 'L1', pageNo: 5, level: 'error', detail: 'e' },
  ];
  const r5 = upgradeDegradedReason({ passed: false, issues: fiveErr, pageCount: 10, durationMs: 5 });
  r5 && r5.includes('5 条 error') && r5.endsWith('…') ? pass('5 error → reason 末尾含 …') : fail(`5 error reason 错: ${r5}`);
}

// =============== 总结 ===============

console.log(`\n=== ${total - failed}/${total} passed ===`);
if (failed > 0) process.exit(1);
