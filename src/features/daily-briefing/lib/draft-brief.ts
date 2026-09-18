/**
 * AI 早报 — 机器草稿生成器（Drafts 模式）
 *
 * 来源：参考 ai-news-kit `docs/09-手动触发生成服务.md` § 四「两种选稿模式」
 *
 * 触发场景（按优先级）：
 * 1. LLM 输出 parseBriefLoose 失败（无法解析为合法 Brief）
 * 2. validateBrief 有 error 级违反（标 A 但只 1 源等硬错误）
 * 3. 用户显式选择 draft mode
 *
 * 草稿边界（写死，不许放宽）：
 * - **评级上限 B**：A 需要核验一手官方材料，机器做不到
 * - **不写 why/conflicts**：草稿不判断，仅陈述可核对的边界事实
 * - **不改原文**：title 来自原新闻，summary 截断；what/why 留空
 * - **产物显式标注**：`draft: true`，并由 build-pptx 在封面/每页/文件名三处标记
 * - **不查重**：机器没有历史 brief.json 比对能力（Batch 5 才做）
 *
 * 设计：输入采集结果（已抓到的新闻），输出 Brief。**不调 LLM**。
 */

import { computeConfidenceBySources, findSourceEntry } from './source-tiers';
import type { Brief, BriefPick } from './brief-schema';
import type { CollectedItem } from './collect';

/** 草稿模式触发原因 */
export type DraftReason =
  | 'LLM_FAILED'        // LLM 调用失败/超时/parse 错
  | 'VALIDATION_ERROR'  // LLM 输出违反业务规则
  | 'NO_LLM_KEY'        // 用户没配 ApiKey
  | 'USER_FORCED';      // 用户显式选 draft

/** 草稿生成器选项 */
export interface BuildDraftBriefOptions {
  /** 采集到的当日新闻 */
  news: CollectedItem[];
  /** 日报日期（YYYY-MM-DD） */
  date: string;
  /** 触发原因 */
  reason: DraftReason;
  /** 用户偏好侧重方向（默认 ['AI Coding', '具身智能']） */
  focus?: string[];
}

/**
 * 判定单条新闻的 topic
 *
 * 规则（简单关键词匹配）：
 * - 「AI Coding」：含 coding/编程/agent/code/codex/harness/copilot 等关键词
 * - 「具身智能」：含机器人/具身/embodied/robot/humanoid 等
 * - 默认：AI Coding
 */
function classifyTopic(title: string, _summary: string): 'AI Coding' | '具身智能' {
  const lower = (title + ' ' + _summary).toLowerCase();
  const embodiedKeywords = ['robot', 'embodied', '具身', 'humanoid', '机器人', 'physical'];
  const codingKeywords = ['code', 'coding', '编程', 'agent', 'copilot', 'harness', 'codex', 'claude code', 'devin'];

  for (const kw of embodiedKeywords) {
    if (lower.includes(kw)) return '具身智能';
  }
  for (const kw of codingKeywords) {
    if (lower.includes(kw)) return 'AI Coding';
  }
  return 'AI Coding'; // 默认
}

/**
 * 估算 pick 的置信度（草稿版，不写 A，降级逻辑）
 *
 * 规则：
 * - ≥3 个独立信源 → B（不允许 A）
 * - 2 个独立信源 → B
 * - 1 个独立信源 → C
 * - 全 tier 3 → D
 */
function draftConfidenceLevel(sources: string[]): 'A' | 'B' | 'C' | 'D' {
  // 用白名单算法算独立数，然后**封顶 B**
  const raw = computeConfidenceBySources(sources);
  if (raw === 'A') return 'B'; // A → B（草稿上限）
  return raw;
}

/**
 * 标题级聚簇（防同事件被选多次）
 *
 * 来源：ai-news-kit `docs/09-手动触发生成服务.md` § 四 阈值 0.42
 * 实测：Verge vs TechCrunch 报道同一事件 = 0.768 / 0.560；不同事件 = 0.158 / 0.188 / 0.000
 *
 * 这里用字符 bigram Jaccard 简化版（不做分词）
 */
function jaccardBigrams(a: string, b: string): number {
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const t = s.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < t.length - 1; i++) {
      set.add(t.slice(i, i + 2));
    }
    return set;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 候选打分（简单多因素加权） */
function scoreNews(n: CollectedItem, now: Date): number {
  let score = 0;
  // 时效：6 小时内 +3，每超 1 小时减 0.5
  const ageHours = n.publishedAt
    ? (now.getTime() - n.publishedAt.getTime()) / 3600000
    : 999;
  score += Math.max(0, 6 - ageHours * 0.5);
  // 标题长度（>15 字符通常是正经新闻）
  if (n.title.length > 15 && n.title.length < 80) score += 1;
  // 有封面图 +1
  if (n.coverUrl) score += 1;
  return score;
}

/**
 * 机器草稿生成器主入口
 *
 * 输入：已采集的当日新闻
 * 输出：Brief，draft=true
 *
 * 调用方：generate.ts 在 LLM 失败 / validate 错误 / 用户显式选 draft 时
 */
export function buildDraftBrief(opts: BuildDraftBriefOptions): Brief {
  const { news, date } = opts;
  const now = new Date();

  // 1. 评分排序
  const ranked = [...news]
    .map(n => ({ n, score: scoreNews(n, now) }))
    .sort((a, b) => b.score - a.score);

  // 2. 标题级聚簇去重（取阈值 0.42，按 ai-news-kit 实测）
  const selected: CollectedItem[] = [];
  for (const { n } of ranked) {
    if (selected.length >= 5) break;
    const duplicate = selected.find(s => jaccardBigrams(s.title, n.title) >= 0.42);
    if (duplicate) continue;
    selected.push(n);
  }

  // 3. 转 picks（评级强制上限 B + 不写 why/conflicts）
  const picks: BriefPick[] = selected.slice(0, 5).map((n, idx) => {
    const topic = classifyTopic(n.title, n.summary);
    // 草稿 sources：仅主源（crossSources 字段 collect.ts 没暴露）
    const sourceNames = [n.source];
    const lv = draftConfidenceLevel(sourceNames);
    return {
      no: idx + 1,
      topic,
      title: n.title.slice(0, 100),
      lv,
      publishedAt: n.publishedAt
        ? n.publishedAt.toISOString().slice(0, 10)
        : date,
      event: n.summary.slice(0, 300), // 不改写
      keyFacts: [
        `来源：${n.source}`,
        `分类：${n.category ?? '未分类'}`,
        n.publishedAt ? `发布时间：${n.publishedAt.toISOString().slice(0, 16).replace('T', ' ')}` : '发布时间未知',
      ],
      why: '', // ★ 不写 why（机器不判断）
      sources: [{
        name: n.source,
        url: n.url,
        isPrimary: findSourceEntry(n.source)?.tier === 1,
      }],
      conflicts: '未比对各源差异（机器草稿）',
    };
  });

  // 4. 评级分布统计
  const dist = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of picks) {
    dist[p.lv] += 1;
  }

  // 5. 头条摘要
  const headline = picks.length > 0
    ? `今日收录 ${news.length} 条，机器草稿 ${picks.length} 条（评级上限 B，未经人工核验）`
    : `今日 ${date} 未采集到有效新闻`;

  return {
    date,
    headline,
    focus: opts.focus ?? ['AI Coding', '具身智能'],
    windowNote: `机器草稿（${opts.reason}）：LLM 输出或业务规则不通过时的降级产物，仅陈述事实边界。`,
    rawStats: {
      sourcesAlive: 0, // 草稿不统计
      sourcesTotal: 0,
      rawItems: news.length,
      dedupedItems: news.length,
      multiSourceItems: 0,
      byCategory: {},
      crossSourceThreshold: 3,
      note: '机器草稿：不统计信源健康度',
    },
    confidenceScale: [
      { lv: 'A', name: '极高', rule: '≥3 个相互独立的信源，且可追溯到一手官方材料' },
      { lv: 'B', name: '高',   rule: '2 个独立信源，或 1 个信源 + 一手官方材料' },
      { lv: 'C', name: '中',   rule: '单一信源报道；含「多家转载同一家独家」' },
      { lv: 'D', name: '存疑', rule: '关键数字互相矛盾，或全部溯源到同一信源且无官方确认' },
    ],
    picks,
    alsoWorthAScan: [],
    dedupeNote: `草稿未执行查重（机器无法比对历史 brief.json）`,
    draft: true,
  };
}
