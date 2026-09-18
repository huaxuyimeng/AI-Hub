/**
 * C4 — Visual Regression（结构指纹）
 * 路径：src/lib/slide-engine/visual-regression.test.ts
 *
 * 策略：
 *   - 用 fixture 跑 renderBriefingDeck（6 套主题各跑一次）
 *   - 提取每页的"指纹"：页型 + box 数 + 关键文本片段 + 关键尺寸
 *   - 与 baseline JSON 文件对比
 *   - baseline 不存在 → 自动生成（首次跑）
 *   - baseline 存在 → 任意指纹变化 → 测试失败 + diff 输出
 *
 * 为什么是"结构指纹"而不是 pixel diff：
 *   - 真正的视觉回归需要图像 diff（pixelmatch/odiff），依赖多
 *   - 主题/字号/色值一旦变化，PPT 内容必然反映在结构上（页数、box 数、文本截断）
 *   - 结构指纹 80% 覆盖典型视觉回归（溢出、缺页、错位），0% 像素偏差
 *   - 体积小、可 git diff、好维护
 *
 * 运行：
 *   UPDATE_BASELINE=1 npx tsx src/lib/slide-engine/visual-regression.test.ts  # 更新 baseline
 *   npx tsx src/lib/slide-engine/visual-regression.test.ts                      # 对比 baseline
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { paperTheme, BRIEFING_THEMES } from './templates/briefing/theme';
import { renderBriefingDeck } from './templates/briefing/plan';
import { renderDeckToBuffer } from './render/pptx';
import { lintDeck } from './qa/lint';
import { resetBriefingPageTypes } from './templates/briefing/slides';
import type { ThemeTokens } from './contracts/theme';
import type { PlacedSlide, PlacedBox } from './contracts/geometry';
import type { DailyReportContent } from '@/features/daily-briefing/lib/types';

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

const FIXTURE_PATH = 'D:\\1Money\\aihub\\snapshots\\fixture.json';
const BASELINE_PATH = 'D:\\1Money\\aihub\\snapshots\\baseline.json';

// ============================================================================
// Fixture：从 cli.ts 的 FIXTURE_NORMAL 简化而来（自包含，不引用其他模块）
// ============================================================================

const FIXTURE: DailyReportContent = {
  version: 4,
  date: '2026-09-13',
  generatedAt: '2026-09-13T08:00:00.000Z',
  cover: {
    title: 'AI 日报',
    subtitle: '2026-09-13 · 周日',
    emphasis: '侧重 AI Coding × 具身智能',
    stats: [
      { value: '8', label: '条精选新闻', color: 'primary' },
      { value: '4', label: '类信源家族', color: 'secondary' },
      { value: 'B4·C3·D1', label: '置信度分布', color: 'accent' },
    ],
  },
  overview: {
    intro: '本期要点开场白',
    methodNote: '刻意区分「转载数量」与「独立信源数量」',
    sources: [
      { name: '聚合源', description: '多源聚合', icon: 'file-text', color: 'primary' },
      { name: '视频源', description: 'B 站 UP 主', icon: 'comment', color: 'secondary' },
      { name: '官方源', description: '官方一手', icon: 'check-circle', color: 'primary' },
      { name: '第三方', description: '交叉验证', icon: 'share', color: 'accent' },
    ],
    tlDr: [
      'LLM 在长代码生成任务上首次跑通形式化验证回路，错误率从 12% 降至 1.4%',
      'Anthropic 发布 Claude 4.5，多模态 Agent 在长程规划任务上超过人类基线',
      '具身智能赛道单周 3 起融资，累计金额 2.4 亿美元',
    ],
    confidenceLegend: [
      { level: 'A', label: 'A 极高', color: 'primary', rule: '≥3 独立信源 + 一手官方链接' },
      { level: 'B', label: 'B 高', color: 'primary', rule: '2 独立信源，或 1 源 + 一手链接' },
      { level: 'C', label: 'C 中', color: 'secondary', rule: '单一信源，自洽但无二方印证' },
      { level: 'D', label: 'D 存疑', color: 'accent', rule: '多转载同源，或数字互相矛盾' },
    ],
    distribution: [
      { level: 'A', count: 0 },
      { level: 'B', count: 4 },
      { level: 'C', count: 3 },
      { level: 'D', count: 1 },
    ],
  },
  directions: [
    {
      key: 'coding',
      title: 'AI Coding 方向 · 智能编程',
      subtitle: '从「生成代码」到「可证明正确」「成本可控」',
      count: 4,
      summaryItems: [
        { rank: 1, title: '形式化验证回路在长代码生成上跑通', oneLine: '错误率从 12% 降至 1.4%', category: '形式化验证', confidence: 'B' },
        { rank: 2, title: 'Claude 4.5 发布', oneLine: '长程规划超人类基线', category: '旗舰模型', confidence: 'A' },
        { rank: 3, title: 'GPT-5 编程能力更新', oneLine: 'SWE-Bench 提升 8%', category: '旗舰模型', confidence: 'B' },
        { rank: 4, title: 'Cursor 0.45 支持多仓库', oneLine: '跨项目依赖图构建', category: '开发工具', confidence: 'C' },
      ],
    },
    {
      key: 'embodied',
      title: '具身智能方向 · Embodied AI',
      subtitle: '通用 Agent 溢出到物理世界',
      count: 3,
      summaryItems: [
        { rank: 1, title: 'Figure 02 完成家庭任务', oneLine: '端到端神经网络方案', category: '人形机器人', confidence: 'C' },
        { rank: 2, title: 'Physical Intelligence 融资 4 亿', oneLine: '估值 24 亿美元', category: '融资', confidence: 'B' },
        { rank: 3, title: '1X 发布 Neo 家用机器人', oneLine: '售价 2 万美元起', category: '产品发布', confidence: 'B' },
      ],
    },
  ],
  items: [
    { rank: 1, title: '形式化验证回路在长代码生成上跑通', source: 'MIT Technology Review', url: 'https://example.com/1', publishedAt: '08-29 16:49', summary: '麻省理工团队发表论文，提出将形式化验证嵌入 LLM 代码生成回路。', comment: '形式化验证是 AI Coding 落地的关键拐点', category: '形式化验证', direction: 'coding', confidenceLevel: 'B', independentSources: 2, totalReposts: 3, hasPrimaryLink: true, primaryLinks: [{ source: 'MIT', url: 'https://example.com/1' }], heroMetrics: [{ value: '1.4%', label: '错误率' }], whyMatters: '形式化验证把「能跑」抬到了「可证明正确」：过去评审 LLM 生成的代码只能靠测试覆盖率与人工抽查，现在回路里自带证明义务，评审对象从代码变成了证明。这是 AI Coding 进入金融、医疗、自动驾驶等强合规场景的前置条件，也意味着工程团队需要新增「证明维护」这一职责，而不是把它当成一次性验收。', whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: ['把形式化验证嵌进代码生成回路', '错误率从 12% 降至 1.4%', '证明维护成本仍未公布'], relatedSources: ['The Verge'] },
    { rank: 2, title: 'Claude 4.5 发布', source: 'Anthropic 官方', url: 'https://example.com/2', publishedAt: '08-30 10:00', summary: 'Anthropic 发布 Claude 4.5，200K 上下文窗口。', comment: '长程规划超人类基线', category: '旗舰模型', direction: 'coding', confidenceLevel: 'A', independentSources: 3, totalReposts: 12, hasPrimaryLink: true, primaryLinks: [{ source: 'Anthropic', url: 'https://example.com/2' }], heroMetrics: [{ value: '200K', label: '上下文窗口' }, { value: '+18%', label: '工具调用准确率' }], whyMatters: '旗舰模型继续推动 Agent 能力上限', whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: ['上下文窗口扩到 200K', '工具调用准确率 +18%', '长程规划超人类基线', '定价与上一代持平'], relatedSources: [] },
    { rank: 3, title: 'GPT-5 编程能力更新', source: 'OpenAI 官方', url: 'https://example.com/5', publishedAt: '08-30 18:00', summary: 'OpenAI 更新 GPT-5 编程能力，SWE-Bench Verified 提升 8 个百分点。', comment: '评测分数与生产可用性仍有落差', category: '旗舰模型', direction: 'coding', confidenceLevel: 'B', independentSources: 2, totalReposts: 5, hasPrimaryLink: true, primaryLinks: [{ source: 'OpenAI', url: 'https://example.com/5' }], heroMetrics: [{ value: '+8pt', label: 'SWE-Bench' }], whyMatters: '编程能力是 Agent 落地的核心瓶颈', whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [], relatedSources: [] },
    { rank: 4, title: 'Cursor 0.45 支持多仓库', source: 'Cursor 官方博客', url: 'https://example.com/6', publishedAt: '08-31 09:00', summary: 'Cursor 0.45 支持跨仓库依赖图构建，可在单次会话内改动多个项目。', comment: '', category: '开发工具', direction: 'coding', confidenceLevel: 'C', independentSources: 1, totalReposts: 2, hasPrimaryLink: false, primaryLinks: [], heroMetrics: [], whyMatters: null, whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [], relatedSources: [] },
    { rank: 1, title: 'Figure 02 完成家庭任务', source: 'Figure AI', url: 'https://example.com/3', publishedAt: '08-31 14:00', summary: 'Figure 02 视频展示端到端神经网络方案完成家务。', comment: '硬件本体开始接近演示级', category: '人形机器人', direction: 'embodied', confidenceLevel: 'C', independentSources: 1, totalReposts: 8, hasPrimaryLink: false, primaryLinks: [], heroMetrics: [], whyMatters: '具身智能进入家庭场景', whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: ['端到端神经网络方案', '家庭任务演示未标注成功率', '尚无第三方复现'], relatedSources: [] },
    { rank: 2, title: 'Physical Intelligence 融资 4 亿', source: 'TechCrunch', url: 'https://example.com/7', publishedAt: '09-01 08:00', summary: 'Physical Intelligence 完成 4 亿美元融资，估值 24 亿美元。', comment: '一级市场对通用机器人模型仍高度乐观', category: '融资', direction: 'embodied', confidenceLevel: 'B', independentSources: 2, totalReposts: 4, hasPrimaryLink: true, primaryLinks: [{ source: 'TechCrunch', url: 'https://example.com/7' }], heroMetrics: [{ value: '4 亿', label: '融资金额' }, { value: '24 亿', label: '估值' }], whyMatters: '资金规模决定了能力上限', whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [], relatedSources: [] },
    { rank: 3, title: '1X 发布 Neo 家用机器人', source: '1X 官网', url: 'https://example.com/8', publishedAt: '09-01 11:00', summary: '1X 发布面向家庭场景的 Neo 机器人，售价 2 万美元起。', comment: '价格进入中产可承受区间', category: '产品发布', direction: 'embodied', confidenceLevel: 'B', independentSources: 2, totalReposts: 6, hasPrimaryLink: true, primaryLinks: [{ source: '1X', url: 'https://example.com/8' }], heroMetrics: [{ value: '2 万美元', label: '起售价' }], whyMatters: '家用机器人开始有明确价格锚点', whyDoubtful: [], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [], relatedSources: [] },
    { rank: 1, title: '传闻：GPT-6 训练完成', source: '匿名爆料', url: 'https://example.com/4', publishedAt: '09-01 09:00', summary: '某匿名爆料称 GPT-6 已完成训练。', comment: '不作评论', category: '传闻', direction: 'rumor', confidenceLevel: 'D', independentSources: 1, totalReposts: 25, hasPrimaryLink: false, primaryLinks: [], heroMetrics: [], whyMatters: '若属实将是行业重大事件', whyDoubtful: ['无独立信源印证', '官方未确认'], comparison: null, keyStats: [], coverUrl: null, bulletPoints: [], relatedSources: [] },
  ],
  authors: [{ name: '橘鸦Juya', status: 'ok', statusText: '✅ 已取全文', count: 22, description: '专注 AI Coding 方向的日更 UP 主', url: 'https://space.bilibili.com/285286947' }],
  verificationTable: {
    rows: [
      { rank: '1', topic: '形式化验证回路', direction: 'Coding', sources: '2', primaryLink: '✅ MIT', confidence: 'B' },
      { rank: '2', topic: 'Claude 4.5 发布', direction: 'Coding', sources: '3', primaryLink: '✅ Anthropic', confidence: 'A' },
      { rank: '3', topic: 'GPT-5 编程更新', direction: 'Coding', sources: '2', primaryLink: '❌', confidence: 'B' },
      { rank: '4', topic: 'Cursor 0.45', direction: 'Coding', sources: '1', primaryLink: '✅ Cursor', confidence: 'C' },
      { rank: '5', topic: 'Figure 02', direction: '具身', sources: '1', primaryLink: '❌', confidence: 'C' },
      { rank: '6', topic: 'PI 融资', direction: '具身', sources: '2', primaryLink: '✅ TechCrunch', confidence: 'B' },
      { rank: '7', topic: '1X Neo', direction: '具身', sources: '2', primaryLink: '✅ 1X', confidence: 'B' },
      { rank: '8', topic: 'GPT-6 传闻', direction: '传闻', sources: '1', primaryLink: '❌', confidence: 'D' },
    ],
    summary: '本期置信度分布：B 级 4 条 / C 级 3 条 / D 级 1 条（传闻）。',
  },
  trends: [
    { rank: 1, title: '形式化验证成为 Coding 标配', description: '从「能用」到「可证明正确」是新阶段的关键拐点。' },
    { rank: 2, title: '具身智能进入家庭场景', description: '通用 Agent 能力溢出到物理世界。' },
    { rank: 3, title: 'AI 治理成为基础设施', description: '随着 AI Agent 介入关键决策，治理框架从可选项变为必选项。' },
  ],
  sources: {
    skills: [{ name: 'MIT Technology Review', url: 'https://www.technologyreview.com' }],
    videoAuthors: [{ name: '橘鸦Juya', url: 'https://space.bilibili.com/285286947' }],
    crossSources: [{ name: 'The Verge', url: 'https://www.theverge.com' }],
    officialLinks: [{ name: 'Anthropic', url: 'https://www.anthropic.com' }],
  },
};

// ============================================================================
// 指纹提取
// ============================================================================

type BoxFingerprint = {
  id: string;
  slot: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** text 第一行（或前 30 字符），空盒=null */
  textHead: string | null;
  /** text 字符数（溢出诊断用） */
  textLen: number;
  /** 字号（关键 size） */
  fontSize: number | null;
};

type SlideFingerprint = {
  pageNo: number;
  pageType: string;
  boxCount: number;
  boxes: BoxFingerprint[];
};

type ThemeFingerprint = {
  themeId: string;
  pageCount: number;
  /** sha256 截断前 16 字符（足够标识用） */
  pptxSha: string;
  pptxSize: number;
  /** 每页 lint error 数 */
  lintErrors: number;
  lintWarns: number;
  slides: SlideFingerprint[];
};

function fingerprintBox(b: PlacedBox): BoxFingerprint {
  let textHead: string | null = null;
  let textLen = 0;
  let fontSize: number | null = null;
  if (b.text && b.text.value) {
    const v = b.text.value.trim();
    textLen = v.length;
    textHead = v.slice(0, 30);
    fontSize = b.text.size;
  }
  return {
    id: b.id,
    slot: b.slot,
    kind: b.kind,
    x: round(b.box.x),
    y: round(b.box.y),
    w: round(b.box.w),
    h: round(b.box.h),
    textHead,
    textLen,
    fontSize,
  };
}

function fingerprintSlide(s: PlacedSlide): SlideFingerprint {
  return {
    pageNo: s.pageNo,
    pageType: s.pageType,
    boxCount: s.boxes.length,
    boxes: s.boxes.map(fingerprintBox),
  };
}

async function fingerprintTheme(content: DailyReportContent, theme: ThemeTokens): Promise<ThemeFingerprint> {
  const slides = renderBriefingDeck(content, theme);
  const lintReport = lintDeck(slides, theme);
  const buffer = await renderDeckToBuffer(slides, theme, { title: `AI 日报 ${content.date}` });
  const sha = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  return {
    themeId: theme.id,
    pageCount: slides.length,
    pptxSha: sha,
    pptxSize: buffer.length,
    lintErrors: lintReport.issues.filter((i) => i.level === 'error').length,
    lintWarns: lintReport.issues.filter((i) => i.level === 'warn').length,
    slides: slides.map(fingerprintSlide),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================================
// 对比逻辑
// ============================================================================

function diffSlides(actual: SlideFingerprint[], baseline: SlideFingerprint[]): string[] {
  const diffs: string[] = [];
  if (actual.length !== baseline.length) {
    diffs.push(`页数变化: ${baseline.length} → ${actual.length}`);
    return diffs;
  }
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const b = baseline[i];
    if (a.pageType !== b.pageType) {
      diffs.push(`P${a.pageNo}: pageType 变化 ${b.pageType} → ${a.pageType}`);
    }
    if (a.boxCount !== b.boxCount) {
      diffs.push(`P${a.pageNo}: box 数变化 ${b.boxCount} → ${a.boxCount}`);
    }
    if (a.boxes.length === b.boxes.length) {
      for (let j = 0; j < a.boxes.length; j++) {
        const ab = a.boxes[j];
        const bb = b.boxes[j];
        if (ab.slot !== bb.slot) {
          diffs.push(`P${a.pageNo}.box${j}: slot 变化 ${bb.slot} → ${ab.slot}`);
        }
        if (ab.kind !== bb.kind) {
          diffs.push(`P${a.pageNo}.box${j}: kind 变化 ${bb.kind} → ${ab.kind}`);
        }
        // 位置/尺寸精度放宽到 ±2pt（lint 本身有 0.05 容差）
        if (Math.abs(ab.x - bb.x) > 2) diffs.push(`P${a.pageNo}.${ab.slot}: x ${bb.x} → ${ab.x}`);
        if (Math.abs(ab.y - bb.y) > 2) diffs.push(`P${a.pageNo}.${ab.slot}: y ${bb.y} → ${ab.y}`);
        if (Math.abs(ab.w - bb.w) > 2) diffs.push(`P${a.pageNo}.${ab.slot}: w ${bb.w} → ${ab.w}`);
        if (Math.abs(ab.h - bb.h) > 2) diffs.push(`P${a.pageNo}.${ab.slot}: h ${bb.h} → ${ab.h}`);
        if (ab.textHead !== bb.textHead) {
          diffs.push(`P${a.pageNo}.${ab.slot}: 文本 "${bb.textHead}" → "${ab.textHead}"`);
        }
        if (ab.fontSize !== bb.fontSize) {
          diffs.push(`P${a.pageNo}.${ab.slot}: 字号 ${bb.fontSize} → ${ab.fontSize}`);
        }
      }
    }
  }
  return diffs;
}

function diffFingerprint(actual: ThemeFingerprint, baseline: ThemeFingerprint): { diffs: string[]; hashChanged: boolean } {
  const diffs: string[] = [];
  let hashChanged = false;
  if (actual.pageCount !== baseline.pageCount) {
    diffs.push(`[${actual.themeId}] 页数: ${baseline.pageCount} → ${actual.pageCount}`);
  }
  // PPTX SHA 不强制相同（pptxgenjs 内部有随机 ID），但记录下来供观察
  if (actual.pptxSha !== baseline.pptxSha) {
    hashChanged = true;
    // 不算回归，仅作 info
  }
  if (Math.abs(actual.pptxSize - baseline.pptxSize) > 4096) {
    diffs.push(`[${actual.themeId}] PPTX 大小差异 > 4KB: ${baseline.pptxSize} → ${actual.pptxSize}`);
  }
  if (actual.lintErrors !== baseline.lintErrors) {
    diffs.push(`[${actual.themeId}] lint error: ${baseline.lintErrors} → ${actual.lintErrors}`);
  }
  if (actual.lintWarns !== baseline.lintWarns) {
    diffs.push(`[${actual.themeId}] lint warn: ${baseline.lintWarns} → ${actual.lintWarns}`);
  }
  diffs.push(...diffSlides(actual.slides, baseline.slides));
  return { diffs, hashChanged };
}

// ============================================================================
// 主流程
// ============================================================================

async function main(): Promise<void> {
  const updateMode = process.env.UPDATE_BASELINE === '1';
  // 注册早报页型（独立跑时需要；cli.ts 已经处理，但这个 test 是独立入口）
  resetBriefingPageTypes();

  // 把 fixture 单独落盘（可重复用）
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  if (!existsSync(FIXTURE_PATH)) {
    writeFileSync(FIXTURE_PATH, JSON.stringify(FIXTURE, null, 2), 'utf-8');
    console.log(`📝 已写出 fixture: ${FIXTURE_PATH}`);
  }

  // 跑 6 套主题
  const themes = Object.values(BRIEFING_THEMES);
  console.log(`▶ 跑 ${themes.length} 套主题 × 1 fixture ...\n`);
  const fingerprints: ThemeFingerprint[] = [];
  for (const theme of themes) {
    const fp = await fingerprintTheme(FIXTURE, theme);
    fingerprints.push(fp);
    console.log(`  ${fp.themeId}: ${fp.pageCount} 页 / ${fp.pptxSize} bytes / lint ${fp.lintErrors}E ${fp.lintWarns}W / sha ${fp.pptxSha}`);
  }

  if (updateMode) {
    // 写 baseline
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(fingerprints, null, 2), 'utf-8');
    console.log(`\n✅ Baseline 已更新: ${BASELINE_PATH}`);
    pass('UPDATE_BASELINE=1 → 已写新 baseline');
    return;
  }

  // 对比模式
  if (!existsSync(BASELINE_PATH)) {
    console.log(`\n⚠ baseline 不存在: ${BASELINE_PATH}`);
    console.log('   首次运行请设 UPDATE_BASELINE=1 生成 baseline');
    fail('baseline 缺失（请跑一次 UPDATE_BASELINE=1）');
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as ThemeFingerprint[];
  console.log(`\n▶ 对比 baseline (${baseline.length} 主题) vs 实际 (${fingerprints.length} 主题)`);
  let totalDiffs = 0;
  for (let i = 0; i < fingerprints.length; i++) {
    const actual = fingerprints[i];
    const base = baseline[i];
    if (!base) {
      fail(`baseline 缺少主题 ${actual.themeId}`);
      totalDiffs++;
      continue;
    }
    const { diffs, hashChanged } = diffFingerprint(actual, base);
    const suffix = hashChanged ? '（PPTX hash 因内部 ID 漂移，不计回归）' : '';
    if (diffs.length === 0) {
      pass(`${actual.themeId}: 无视觉回归${suffix}`);
    } else {
      fail(`${actual.themeId}: ${diffs.length} 处回归${suffix}`);
      for (const d of diffs.slice(0, 10)) {
        console.error(`    - ${d}`);
      }
      if (diffs.length > 10) console.error(`    ... 还有 ${diffs.length - 10} 处`);
      totalDiffs += diffs.length;
    }
  }

  console.log(`\n=== ${total - failed}/${total} passed (${totalDiffs} 视觉回归) ===`);
  if (failed > 0) {
    console.log(`\n如确认是预期变化，请跑：UPDATE_BASELINE=1 npx tsx src/lib/slide-engine/visual-regression.test.ts`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
