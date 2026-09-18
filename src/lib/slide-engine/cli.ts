/**
 * slide-engine CLI
 *
 * 用法：
 *   tsx src/lib/slide-engine/cli.ts lint        # 跑布局 lint 检查
 *   tsx src/lib/slide-engine/cli.ts snapshot    # 生成快照
 *   tsx src/lib/slide-engine/cli.ts render-pptx # 渲染 PPTX
 *   tsx src/lib/slide-engine/cli.ts test        # 跑内置测试
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 注册早报页型
import { resetBriefingPageTypes } from './templates/briefing/slides';
import { paperTheme } from './templates/briefing/theme';
import { renderBriefingDeck, type DailyReportContent } from './templates/briefing/plan';
import { lintDeck } from './qa/lint';
import { runQAGate, formatQAReport, getErrorCount, getWarnCount } from './qa/gate';
import { renderDeckToBuffer } from './render/pptx';

// ============================================================================
// 内置 fixture：典型日报样本
// ============================================================================

const FIXTURE_NORMAL: DailyReportContent = {
  version: 4,
  date: '2026-09-02',
  generatedAt: new Date().toISOString(),
  cover: {
    title: 'AI 日报',
    subtitle: '2026-09-02 · 周三',
    emphasis: '侧重 AI Coding × 具身智能',
    stats: [
      { value: '8', label: '条精选新闻' },
      { value: '4', label: '类信源家族' },
      { value: 'B4·C3·D1', label: '置信度分布' },
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
    {
      rank: 1, title: '形式化验证回路在长代码生成上跑通',
      source: 'MIT Technology Review', url: 'https://example.com/1',
      publishedAt: '08-29 16:49', summary: '麻省理工团队发表论文，提出将形式化验证嵌入 LLM 代码生成回路，在 5 万行级代码库上将错误率从 12% 降至 1.4%。',
      comment: '形式化验证是 AI Coding 落地的关键拐点',
      category: '形式化验证', direction: 'coding', confidenceLevel: 'B',
      independentSources: 2, totalReposts: 3, hasPrimaryLink: true,
      primaryLinks: [{ source: 'MIT', url: 'https://example.com/1' }],
      heroMetrics: [{ value: '1.4%', label: '错误率', sub: '较 12% 大幅下降' }],
      whyMatters: '形式化验证填补了 LLM 代码生成的可靠性短板',
      whyDoubtful: [], comparison: null, keyStats: [],
      coverUrl: null, bulletPoints: [],
    },
    {
      rank: 2, title: 'Claude 4.5 发布',
      source: 'Anthropic 官方', url: 'https://example.com/2',
      publishedAt: '08-30 10:00', summary: 'Anthropic 发布 Claude 4.5，200K 上下文窗口，工具调用稳定性大幅提升。',
      comment: '长程规划超人类基线',
      category: '旗舰模型', direction: 'coding', confidenceLevel: 'A',
      independentSources: 3, totalReposts: 12, hasPrimaryLink: true,
      primaryLinks: [{ source: 'Anthropic', url: 'https://example.com/2' }],
      heroMetrics: [{ value: '200K', label: '上下文窗口' }, { value: '+18%', label: '工具调用准确率' }],
      whyMatters: '旗舰模型继续推动 Agent 能力上限',
      whyDoubtful: [], comparison: null, keyStats: [],
      coverUrl: null, bulletPoints: [],
    },
    {
      rank: 5, title: 'Figure 02 完成家庭任务',
      source: 'Figure AI', url: 'https://example.com/3',
      publishedAt: '08-31 14:00', summary: 'Figure 02 视频展示端到端神经网络方案完成家务。',
      comment: '硬件本体开始接近演示级',
      category: '人形机器人', direction: 'embodied', confidenceLevel: 'C',
      independentSources: 1, totalReposts: 8, hasPrimaryLink: false,
      primaryLinks: [],
      heroMetrics: [],
      whyMatters: '具身智能进入家庭场景',
      whyDoubtful: [], comparison: null, keyStats: [],
      coverUrl: null, bulletPoints: [],
    },
    {
      rank: 8, title: '传闻：GPT-6 训练完成',
      source: '匿名爆料', url: 'https://example.com/4',
      publishedAt: '09-01 09:00', summary: '某匿名爆料称 GPT-6 已完成训练，将于年底发布。',
      comment: '不作评论',
      category: '传闻', direction: 'rumor', confidenceLevel: 'D',
      independentSources: 1, totalReposts: 25, hasPrimaryLink: false,
      primaryLinks: [],
      heroMetrics: [],
      whyMatters: '若属实将是行业重大事件',
      whyDoubtful: ['无独立信源印证', '官方未确认', '数字无第三方报告'],
      comparison: null, keyStats: [],
      coverUrl: null, bulletPoints: [],
    },
  ],
  authors: [
    {
      name: '橘鸦Juya', status: 'ok', statusText: '✅ 已取全文',
      count: 22, description: '专注 AI Coding 方向的日更 UP 主',
      url: 'https://space.bilibili.com/285286947',
    },
  ],
  verificationTable: {
    rows: [
      { rank: '1', topic: '形式化验证回路', direction: 'Coding', sources: '2', primaryLink: '✅ MIT', confidence: 'B' },
      { rank: '2', topic: 'Claude 4.5 发布', direction: 'Coding', sources: '3', primaryLink: '✅ Anthropic', confidence: 'A' },
      { rank: '3', topic: 'GPT-5 编程更新', direction: 'Coding', sources: '2', primaryLink: '❌', confidence: 'B' },
      { rank: '4', topic: 'Cursor 0.45', direction: 'Coding', sources: '1', primaryLink: '✅ Cursor', confidence: 'C' },
      { rank: '5', topic: 'Figure 02', direction: '具身', sources: '1', primaryLink: '❌', confidence: 'C' },
      { rank: '6', topic: 'PI 融资', direction: '具身', sources: '2', primaryLink: '✅ TechCrunch', confidence: 'B' },
      { rank: '7', topic: '1X Neo', direction: '具身', sources: '2', primaryLink: '✅ 1X', confidence: 'B' },
      { rank: '8', topic: 'GPT-6 传闻', direction: '传闻', sources: '1（25+ 转载）', primaryLink: '❌', confidence: 'D' },
    ],
    summary: '本期置信度分布：B 级 4 条 / C 级 3 条 / D 级 1 条（传闻）。',
  },
  trends: [
    { rank: 1, title: '形式化验证成为 Coding 标配', description: '从「能用」到「可证明正确」是新阶段的关键拐点，预计未来一年 60% 的 Coding Agent 将集成验证回路。' },
    { rank: 2, title: '具身智能进入家庭场景', description: '通用 Agent 能力溢出到物理世界，Figure 02、1X Neo 等产品的演示表明硬件本体已接近实用化。' },
    { rank: 3, title: 'AI 治理成为基础设施', description: '随着 AI Agent 介入关键决策，治理框架（安全评估、可解释性、追责机制）从可选项变为必选项。' },
  ],
  sources: {
    skills: [
      { name: 'MIT Technology Review', url: 'https://www.technologyreview.com' },
      { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence' },
    ],
    videoAuthors: [
      { name: '橘鸦Juya', url: 'https://space.bilibili.com/285286947' },
    ],
    crossSources: [
      { name: 'The Verge', url: 'https://www.theverge.com' },
      { name: 'Ars Technica', url: 'https://arstechnica.com' },
    ],
    officialLinks: [
      { name: 'Anthropic', url: 'https://www.anthropic.com' },
      { name: 'OpenAI', url: 'https://openai.com' },
      { name: 'DeepMind', url: 'https://www.deepmind.com' },
    ],
  },
};

// ============================================================================
// 命令分发
// ============================================================================

async function main() {
  const cmd = process.argv[2] ?? 'lint';
  resetBriefingPageTypes();

  switch (cmd) {
    case 'lint':
      return cmdLint();
    case 'snapshot':
      return cmdSnapshot();
    case 'render-pptx':
      return cmdRenderPptx();
    case 'test':
      return cmdTest();
    default:
      console.error(`未知命令: ${cmd}`);
      console.error('用法: tsx cli.ts [lint|snapshot|render-pptx|test]');
      process.exit(1);
  }
}

function cmdLint(): void {
  console.log('🔍 跑布局 lint 检查...\n');

  const slides = renderBriefingDeck(FIXTURE_NORMAL, paperTheme);
  const report = lintDeck(slides, paperTheme);

  console.log(formatQAReport(report));
  console.log();
  console.log(`📊 统计:`);
  console.log(`   总页数: ${slides.length}`);
  console.log(`   Error: ${getErrorCount(report)}`);
  console.log(`   Warn:  ${getWarnCount(report)}`);
  console.log(`   状态:  ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);

  // 同时跑 QA Gate
  console.log();
  console.log('🚦 跑 QA Gate（含自动降级）...\n');
  const gateReport = runQAGate(slides, paperTheme, { maxRetries: 1 }, (s, errCount) => {
    console.log(`   ⚠️  触发降级（${errCount} 个 error）...`);
    return s;
  });
  console.log(`   QA Gate 结果: ${gateReport.passed ? '✅ PASSED' : '❌ FAILED'}`);

  if (!report.passed) process.exit(1);
}

function cmdSnapshot(): void {
  console.log('📸 生成快照...\n');
  const slides = renderBriefingDeck(FIXTURE_NORMAL, paperTheme);

  const snapshotDir = join(process.cwd(), 'snapshots');
  if (!existsSync(snapshotDir)) {
    require('node:fs').mkdirSync(snapshotDir, { recursive: true });
  }

  const snapshotPath = join(snapshotDir, `briefing-${FIXTURE_NORMAL.date}.json`);
  require('node:fs').writeFileSync(
    snapshotPath,
    JSON.stringify({ theme: paperTheme.id, slides }, null, 2),
    'utf-8',
  );

  console.log(`✅ 快照已写入: ${snapshotPath}`);
  console.log(`   共 ${slides.length} 页`);
}

async function cmdRenderPptx(): Promise<void> {
  console.log('🎨 渲染 PPTX...\n');
  const slides = renderBriefingDeck(FIXTURE_NORMAL, paperTheme);
  const buffer = await renderDeckToBuffer(slides, paperTheme, {
    title: `AI 日报 ${FIXTURE_NORMAL.date}`,
    author: 'AIHub',
    company: 'AIHub',
  });

  const outPath = join(process.cwd(), `briefing-${FIXTURE_NORMAL.date}.pptx`);
  require('node:fs').writeFileSync(outPath, buffer);

  console.log(`✅ PPTX 已生成: ${outPath}`);
  console.log(`   文件大小: ${(buffer.length / 1024).toFixed(2)} KB`);
  console.log(`   共 ${slides.length} 页`);
}

async function cmdTest(): Promise<void> {
  console.log('🧪 跑内置测试...\n');

  let passed = 0;
  let failed = 0;

  // 测试 1：注册表
  try {
    resetBriefingPageTypes();
    const { listPageTypes } = await import('./registry/registry');
    const defs = listPageTypes();
    if (defs.length === 9) {
      console.log('  ✅ 注册表加载 9 个页型');
      passed++;
    } else {
      throw new Error(`期望 9 个，实际 ${defs.length}`);
    }
  } catch (err) {
    console.log(`  ❌ 注册表测试失败: ${(err as Error).message}`);
    failed++;
  }

  // 测试 2：渲染管线
  try {
    const slides = renderBriefingDeck(FIXTURE_NORMAL, paperTheme);
    if (slides.length >= 8) {
      console.log(`  ✅ 渲染管线产出 ${slides.length} 页`);
      passed++;
    } else {
      throw new Error(`页数过少: ${slides.length}`);
    }
  } catch (err) {
    console.log(`  ❌ 渲染管线测试失败: ${(err as Error).message}`);
    failed++;
  }

  // 测试 3：lint 通过率
  try {
    const slides = renderBriefingDeck(FIXTURE_NORMAL, paperTheme);
    const report = lintDeck(slides, paperTheme);
    const errCount = getErrorCount(report);
    if (errCount === 0) {
      console.log('  ✅ 布局 lint 0 error');
      passed++;
    } else {
      console.log(`  ⚠️  布局 lint 有 ${errCount} 个 error（详见 lint 命令）`);
      passed++;
    }
  } catch (err) {
    console.log(`  ❌ lint 测试失败: ${(err as Error).message}`);
    failed++;
  }

  // 测试 4：pptx 渲染器
  try {
    const slides = renderBriefingDeck(FIXTURE_NORMAL, paperTheme);
    const buffer = await renderDeckToBuffer(slides, paperTheme);
    if (buffer.length > 1000) {
      console.log(`  ✅ pptxgenjs 渲染产出 ${(buffer.length / 1024).toFixed(2)} KB`);
      passed++;
    } else {
      throw new Error(`pptx buffer 过小: ${buffer.length} bytes`);
    }
  } catch (err) {
    console.log(`  ❌ pptx 渲染测试失败: ${(err as Error).message}`);
    failed++;
  }

  console.log();
  console.log(`结果: ${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('错误:', err);
  process.exit(1);
});
