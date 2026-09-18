/**
 * draft-brief 测试（Batch 3）
 *
 * 验证：
 * 1. 触发 draft 模式时输出 Brief 且 draft=true
 * 2. 评级封顶 B（即便满足 A 条件也只能 B）
 * 3. why 字段强制空字符串
 * 4. 标题级聚簇去重生效
 * 5. publishAt / topic 推断正确
 * 6. news 为空时返回空 picks + headline 提示
 */

import { buildDraftBrief, type BuildDraftBriefOptions } from './draft-brief';
import type { CollectedItem } from './collect';

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

// 测试夹具
const FAKE_NOW = new Date('2026-09-14T08:00:00Z');

function makeItem(overrides: Partial<CollectedItem>): CollectedItem {
  return {
    id: 'id-' + Math.random(),
    title: '默认标题',
    summary: '默认摘要内容',
    url: 'https://example.com/news',
    source: '量子位',
    category: 'AI Coding',
    companyTags: [],
    publishedAt: FAKE_NOW,
    coverUrl: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 1：基本生成
// ---------------------------------------------------------------------------

console.log('▶ Section 1: 基本生成');
{
  const opts: BuildDraftBriefOptions = {
    news: [
      makeItem({ title: 'DeepSeek 发布 V4.1 Flash，缓存命中率提升 4 倍', source: '量子位' }),
      makeItem({ title: '某机器人公司人形机器人新进展', source: '极客公园' }),
      makeItem({ title: 'OpenAI Agent 集群本周新增 Ruby 生态攻击', source: '机器之心' }),
    ],
    date: '2026-09-14',
    reason: 'LLM_FAILED',
  };
  const brief = buildDraftBrief(opts);

  assertPass('basic draft 模式', brief.draft === true);
  assertPass('返回 picks 数组', Array.isArray(brief.picks));
  assertPass('date 正确', brief.date === '2026-09-14');
  assertPass('headline 提到机器草稿', brief.headline.includes('机器草稿'));
}

// ---------------------------------------------------------------------------
// Section 2：评级封顶 B
// ---------------------------------------------------------------------------

console.log('▶ Section 2: 评级封顶 B');
{
  const opts: BuildDraftBriefOptions = {
    news: [makeItem({
      title: 'Anthropic 发布 Claude 新模型',
      source: 'Anthropic News',
      url: 'https://anthropic.com/news',
    })],
    date: '2026-09-14',
    reason: 'NO_LLM_KEY',
  };
  const brief = buildDraftBrief(opts);

  // 1 tier 1 源本应给 B（按 computeConfidenceBySources），不应该升 A
  assertPass('tier 1 源在草稿里仍是 B（封顶）', brief.picks[0].lv === 'B');
}

// ---------------------------------------------------------------------------
// Section 3：why 强制空
// ---------------------------------------------------------------------------

console.log('▶ Section 3: why 强制空');
{
  const opts: BuildDraftBriefOptions = {
    news: [makeItem({ title: '测试新闻标题用于机器草稿验证', source: '量子位' })],
    date: '2026-09-14',
    reason: 'VALIDATION_ERROR',
  };
  const brief = buildDraftBrief(opts);
  for (const p of brief.picks) {
    assertPass(`pick ${p.no} 的 why 是空（机器不判断）`, p.why === '');
  }
}

// ---------------------------------------------------------------------------
// Section 4：标题级聚簇去重
// ---------------------------------------------------------------------------

console.log('▶ Section 4: 标题级聚簇去重');
{
  // 两条几乎同标题的新闻应该只保留 1 条
  const opts: BuildDraftBriefOptions = {
    news: [
      makeItem({ title: 'DeepSeek 发布 V4.1 Flash 模型', source: '量子位' }),
      makeItem({ title: 'DeepSeek 发布 V4.1 Flash 模型，性能翻倍', source: '机器之心' }),
      makeItem({ title: '另外不相关的一条新闻', source: 'TechCrunch AI' }),
    ],
    date: '2026-09-14',
    reason: 'LLM_FAILED',
  };
  const brief = buildDraftBrief(opts);

  // 取阈值 0.42：前两条 bigram Jaccard = ?
  // 「DeepSeek发布V4.1Flash」 vs 「DeepSeek发布V4.1Flash模型，性能翻倍」
  // 共享 bigrams 约 12 个，A有约 14，B有约 17 → jaccard ≈ 12/(14+17-12) = 0.63 > 0.42 → 去重
  assertPass('标题聚簇：2 条相似只取 1 条 + 1 条不相关 = 共 2 条', brief.picks.length === 2);
}

// ---------------------------------------------------------------------------
// Section 5：topic 推断
// ---------------------------------------------------------------------------

console.log('▶ Section 5: topic 推断');
{
  const opts: BuildDraftBriefOptions = {
    news: [
      makeItem({ title: 'AI Coding 新进展：Claude Code Agent 优化', source: '量子位' }),
      makeItem({ title: '具身智能：人形机器人新突破，physical interaction 改善', source: '极客公园' }),
      makeItem({ title: '无关词汇不分类', source: '量子位' }),
    ],
    date: '2026-09-14',
    reason: 'LLM_FAILED',
  };
  const brief = buildDraftBrief(opts);

  const coding = brief.picks.find(p => p.title.includes('Claude Code'));
  const embodied = brief.picks.find(p => p.title.includes('人形机器人'));
  const default_ = brief.picks.find(p => p.title.includes('无关'));

  assertPass('含 Claude/Agent → AI Coding', coding?.topic === 'AI Coding');
  assertPass('含机器人/physical → 具身智能', embodied?.topic === '具身智能');
  assertPass('默认 → AI Coding', default_?.topic === 'AI Coding');
}

// ---------------------------------------------------------------------------
// Section 6：news 为空
// ---------------------------------------------------------------------------

console.log('▶ Section 6: news 为空');
{
  const opts: BuildDraftBriefOptions = {
    news: [],
    date: '2026-09-14',
    reason: 'LLM_FAILED',
  };
  const brief = buildDraftBrief(opts);
  assertPass('空 news 返回 0 picks', brief.picks.length === 0);
  assertPass('headline 提示未采集', brief.headline.includes('未采集'));
  assertPass('draft 标志仍为 true', brief.draft === true);
}

// ---------------------------------------------------------------------------
// Section 7：publishedAt 推断
// ---------------------------------------------------------------------------

console.log('▶ Section 7: publishedAt 推断');
{
  const opts: BuildDraftBriefOptions = {
    news: [
      makeItem({
        title: '发布时间测试',
        source: '量子位',
        publishedAt: new Date('2026-09-13T16:00:00Z'),
      }),
    ],
    date: '2026-09-14',
    reason: 'VALIDATION_ERROR',
  };
  const brief = buildDraftBrief(opts);
  assertPass('publishedAt 转为 YYYY-MM-DD', brief.picks[0].publishedAt === '2026-09-13');
}

// ---------------------------------------------------------------------------
// 总结
// ---------------------------------------------------------------------------

console.log(`\n=== Batch 3 测试结果：${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
