/**
 * v1 → v4 格式兼容 adapter
 *
 * 背景：DailyReport.content 字段历史上是 v1 schema（cover/overview/items/insight 简单结构），
 *       升级到 v4 后（types.ts 的 DailyReportContentSchema）字段完全重写（cover.stats、
 *       overview.{sources,tlDr,confidenceLegend,distribution}、directions、authors、
 *       verificationTable、trends、sources 等）。
 *       数据库中已存在的 v1 记录如果不走 adapter，parseContent 会返回 null，
 *       导致前端 SlidePreview 拿不到内容、整张 PPT 渲染失败。
 *
 * 策略：解析失败时若识别为 v1（version === 1），则转换为 v4 结构（标 degraded=true），
 *       让历史数据继续可读。后续再生成时会自然覆盖为 v4 内容。
 */
import { cleanText } from '@/lib/news/parsers/types';
import type { DailyReportContent } from '../types';

interface V1Point {
  headline: string;
  oneLine: string;
}

interface V1Item {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary: string;
  comment: string;
  category: string | null;
}

interface V1Insight {
  sourceCount: number;
  categoryDist: Array<{ name: string; count: number }>;
  companyTop: Array<{ name: string; count: number }>;
  weekSeries: Array<{ date: string; count: number }>;
}

interface V1Content {
  version: 1;
  date: string;
  generatedAt: string;
  cover: { title: string; subtitle: string };
  overview: { intro: string; points: V1Point[] };
  items: V1Item[];
  insight: V1Insight;
}

/** 从 v1 summary 的 HTML <a href="..."> 中提取第一个链接 */
function extractUrl(html: string): string {
  const m = html.match(/href=["']([^"']+)["']/);
  return m ? m[1] : '';
}

/** v1 items 按 category 分组到 coding / embodied 方向 */
function isEmbodied(text: string): boolean {
  return /机器人|具身|robot|embod/i.test(text);
}

const COLOR_CYCLE = ['primary', 'secondary', 'accent'] as const;

export function adaptV1ToV4(v1: V1Content): DailyReportContent {
  const cats = v1.insight.categoryDist.filter(c => c.name !== '未分类').slice(0, 4);
  const totalItems = v1.items.length;
  const totalAll = v1.insight.categoryDist.reduce((s, c) => s + c.count, 0);

  // cover.stats
  const stats = [
    { value: String(totalItems), label: '条精选新闻', color: 'primary' as const },
    { value: String(v1.insight.sourceCount), label: '个新闻源', color: 'secondary' as const },
    { value: String(totalAll), label: '条新闻', color: 'accent' as const },
  ];

  // tlDr：从 overview.points 取前 3 条，清理 HTML
  const tlDr = v1.overview.points
    .slice(0, 3)
    .map(p => cleanText(p.headline || p.oneLine || '').slice(0, 80))
    .filter(Boolean);

  // 把 v1 items 分配到方向：v4 只有 coding / embodied 两个主方向，
  // embodied 命中归 embodied，其余（coding 命中与未命中任何关键词的）全部归 coding。
  // 不丢弃未命中新闻——旧版按关键词过滤会把多数 v1 新闻漏掉，
  // 导致 items / verificationTable 低于 v4 schema 最小值，整份历史报告渲染失败。
  function makeItems(direction: 'coding' | 'embodied') {
    const src = v1.items.filter(i => {
      const text = i.title + (i.category ?? '');
      return direction === 'embodied' ? isEmbodied(text) : !isEmbodied(text);
    });
    const dirKey: 'coding' | 'embodied' = direction === 'embodied' ? 'embodied' : 'coding';
    return src.map((it, i) => ({
      rank: i + 1,
      title: cleanText(it.title),
      source: cleanText(it.source),
      url: extractUrl(it.summary) || it.url,
      publishedAt: it.publishedAt ?? '—',
      summary: cleanText(it.summary || '').slice(0, 220),
      comment: cleanText(it.comment || '').slice(0, 30),
      category: it.category ? cleanText(it.category) : null,
      direction: dirKey,
      confidenceLevel: 'C' as const,
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
      // v5：v1 适配器无 og:image 上下文，给空值
      coverUrl: null,
      bulletPoints: [],
    }));
  }

  const codingItemsOut = makeItems('coding');
  const embodiedItemsOut = makeItems('embodied');

  // directions：只保留 count > 0 的
  const directions = [
    {
      key: 'coding' as const,
      title: 'AI Coding 方向 · 智能编程',
      subtitle: '从「生成代码」到「可证明正确」「成本可控」',
      count: codingItemsOut.length,
      summaryItems: codingItemsOut.slice(0, 6).map(it => ({
        rank: it.rank, title: it.title.slice(0, 28), oneLine: it.summary.slice(0, 40),
        category: it.category ?? '', confidence: it.confidenceLevel,
      })),
    },
    {
      key: 'embodied' as const,
      title: '具身智能方向 · Embodied AI',
      subtitle: '通用 Agent 溢出到物理世界',
      count: embodiedItemsOut.length,
      summaryItems: embodiedItemsOut.slice(0, 6).map(it => ({
        rank: it.rank, title: it.title.slice(0, 28), oneLine: it.summary.slice(0, 40),
        category: it.category ?? '', confidence: it.confidenceLevel,
      })),
    },
  ].filter(d => d.count > 0);

  // 合并 items 并重新编号，v5：coverUrl/bulletPoints 已在 makeItems 内补默认值
  const allItems = [...codingItemsOut, ...embodiedItemsOut].map((it, i) => ({ ...it, rank: i + 1 }));

  return {
    version: 4,
    date: v1.date,
    generatedAt: v1.generatedAt,
    cover: {
      title: cleanText(v1.cover.title),
      subtitle: cleanText(v1.cover.subtitle),
      emphasis: 'AI 新闻每日推送',
      stats,
    },
    overview: {
      intro: cleanText(v1.overview.intro).slice(0, 60),
      methodNote: 'LLM 文案生成降级，展示原文摘要（系统上线前旧数据）',
      sources: cats.map((c, i) => ({
        name: c.name,
        description: `${c.count} 条新闻`,
        icon: 'file-text',
        color: COLOR_CYCLE[i % COLOR_CYCLE.length],
      })),
      tlDr: tlDr.length > 0 ? tlDr : ['以下为今日重要 AI 动态，请查看原始新闻列表'],
      confidenceLegend: [
        { level: 'A', label: 'A 极高', color: 'primary', rule: '≥3 独立信源 + 一手官方链接' },
        { level: 'B', label: 'B 高',   color: 'primary', rule: '2 独立信源，或 1 源 + 一手链接' },
        { level: 'C', label: 'C 中',   color: 'secondary', rule: '单一信源，自洽但无二方印证' },
        { level: 'D', label: 'D 存疑', color: 'accent', rule: '多转载同源，或数字互相矛盾' },
      ],
      distribution: [
        { level: 'A', count: 0 },
        { level: 'B', count: 0 },
        { level: 'C', count: totalItems },
        { level: 'D', count: 0 },
      ],
    },
    directions,
    items: allItems,
    authors: [
      { name: '橘鸦Juya', status: 'warn', statusText: '⚠️ 数据暂不可用', count: null, description: '降级版未取到 B 站数据', url: 'https://space.bilibili.com/285286947' },
    ],
    verificationTable: {
      rows: allItems.slice(0, 10).map(it => ({
        rank: String(it.rank),
        topic: it.title.slice(0, 30),
        direction: it.category ?? '—',
        sources: '1',
        primaryLink: '❌',
        confidence: it.confidenceLevel,
      })),
      summary: `降级版 v1→v4 迁移，共 ${allItems.length} 条。`,
    },
    trends: v1.insight.companyTop.slice(0, 3).map((c, i) => ({
      rank: i + 1,
      title: `${c.name} 热度领先`,
      description: `本期 ${c.name} 相关新闻 ${c.count} 条，排在公司新闻榜首。`,
    })),
    sources: {
      skills: [{ name: '降级版数据', url: 'https://example.com' }],
      videoAuthors: [{ name: '橘鸦Juya', url: 'https://space.bilibili.com/285286947' }],
      crossSources: [],
      officialLinks: [],
    },
  };
}

/** 判断一段 JSON 是否为 v1 schema（version === 1） */
export function isV1Content(raw: unknown): raw is V1Content {
  return (
    typeof raw === 'object' && raw !== null &&
    (raw as { version?: unknown }).version === 1
  );
}
