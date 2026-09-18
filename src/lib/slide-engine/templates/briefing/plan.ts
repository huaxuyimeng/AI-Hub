/**
 * 早报页面编排器
 * 根据内容动态决定每页用哪个页型、装配 SlideIR
 * 旧 build-pptx.ts 中 plan.length 的逻辑全部迁移到这里
 */

import { z } from 'zod';
import type { PlacedSlide } from '../../contracts/geometry';
import type { ThemeTokens } from '../../contracts/theme';
import { getPageType } from '../../registry/registry';
import { measureWidth, measureLines } from '../../layout/measure';
import { DISCLAIMER_SECTIONS } from './slides/disclaimer';
import { areAllSimilar } from '@/features/daily-briefing/lib/text-similarity';

// ============================================================================
// 早报整体内容契约（继承自原 v4 DailyReportContentSchema）
// ============================================================================

export const DailyReportContentSchema = z.object({
  version: z.literal(4),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string(),

  // P01 封面
  cover: z.object({
    title: z.string(),
    subtitle: z.string(),
    emphasis: z.string(),
    stats: z.array(z.object({
      value: z.string(),
      label: z.string(),
    })).length(3),
  }),

  // P02 概览
  overview: z.object({
    intro: z.string(),
    methodNote: z.string(),
    sources: z.array(z.object({
      name: z.string(),
      description: z.string(),
      icon: z.string(),
      color: z.enum(['primary', 'secondary', 'accent']),
    })).length(4),
    tlDr: z.array(z.string()).min(2).max(4),
    confidenceLegend: z.array(z.object({
      level: z.enum(['A', 'B', 'C', 'D']),
      label: z.string(),
      color: z.enum(['primary', 'secondary', 'accent']),
      rule: z.string(),
    })).length(4),
    distribution: z.array(z.object({
      level: z.enum(['A', 'B', 'C', 'D']),
      count: z.number().int().min(0),
    })).length(4),
  }),

  // 方向索引（每个方向一页）
  directions: z.array(z.object({
    key: z.enum(['coding', 'embodied']),
    title: z.string(),
    subtitle: z.string(),
    count: z.number().int().positive(),
    summaryItems: z.array(z.object({
      rank: z.number().int().positive(),
      title: z.string(),
      oneLine: z.string(),
      category: z.string(),
      confidence: z.enum(['A', 'B', 'C', 'D']),
    })).min(1).max(6),
  })).min(1).max(3),

  // 新闻条目
  items: z.array(z.object({
    rank: z.number().int().positive(),
    title: z.string(),
    source: z.string(),
    url: z.string().url(),
    publishedAt: z.string(),
    summary: z.string(),
    comment: z.string(),
    category: z.string().nullable(),
    direction: z.enum(['coding', 'embodied', 'rumor']),
    confidenceLevel: z.enum(['A', 'B', 'C', 'D']),
    independentSources: z.number().int().min(1),
    totalReposts: z.number().int().min(0),
    hasPrimaryLink: z.boolean(),
    primaryLinks: z.array(z.object({ source: z.string(), url: z.string() })).default([]),
    heroMetrics: z.array(z.object({
      value: z.string(),
      label: z.string(),
      sub: z.string().optional(),
    })).default([]),
    whyMatters: z.string().nullable().default(null),
    whyDoubtful: z.array(z.string()).default([]),
    comparison: z.string().nullable().default(null),
    keyStats: z.array(z.object({
      value: z.string(),
      label: z.string(),
      color: z.enum(['primary', 'secondary', 'accent']),
    })).default([]),
    coverUrl: z.string().nullable().default(null),
    bulletPoints: z.array(z.string()).default([]),
  })).min(3).max(15),

  // 作者
  authors: z.array(z.object({
    name: z.string(),
    status: z.enum(['ok', 'warn']),
    statusText: z.string(),
    count: z.number().int().nullable(),
    description: z.string(),
    url: z.string().url(),
  })).min(1).max(4),

  // 验证表
  verificationTable: z.object({
    rows: z.array(z.object({
      rank: z.string(),
      topic: z.string(),
      direction: z.string(),
      sources: z.string(),
      primaryLink: z.string(),
      confidence: z.enum(['A', 'B', 'C', 'D']),
    })).min(5).max(20),
    summary: z.string(),
  }),

  // 趋势
  trends: z.array(z.object({
    rank: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
  })).length(3),

  // 信源清单
  sources: z.object({
    skills: z.array(z.object({ name: z.string(), url: z.string() })),
    videoAuthors: z.array(z.object({ name: z.string(), url: z.string() })),
    crossSources: z.array(z.object({ name: z.string(), url: z.string() })),
    officialLinks: z.array(z.object({ name: z.string(), url: z.string() })),
  }),
});

export type DailyReportContent = z.infer<typeof DailyReportContentSchema>;

// ============================================================================
// 守卫 helper：截断字符串字段，避免下游 page schema（z.string().max(N)）抛错
//
// 之前：LLM 输出 item.summary 可能 200~400 字；plan.ts 直接透传给 page schema
//       → direction-detail/rumor 页面 schema 的 summary.max(200) 抛 ZodError
//       → 整个 lint 崩 → qa-gate 标记 degraded=true
// 现在：截断到 200 字符再透传；下游 schema 不会再抛错
// ============================================================================

/** 截断字符串到 N 字符（按字符数不按字节，避免中文 emoji 多算） */
function clip(s: string | null | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** primaryLink 字段最大长度（与下游 page schema 保持一致） */
const PRIMARY_LINK_MAX = 20;

/**
 * 递归 truncate 任意对象里的 string 字段，避免下游 page schema 的 max(N) 抛错
 * - 只处理 page schema 已知超限的字段（按字段名判断，避免误截断非字符串字段）
 * - max 表里有 'name'=30, 'statusText'=20, 'description'=120, 'title'=40, 'subtitle'=60 等
 *   'topic'=50, 'oneLine'=60, 'category'=20, 'summary'=200, 'comment'=40, 'primaryLink'=30, 'emphasis'=60
 *
 * 取值原则：**全局表取「该字段名在所有页型里的最宽松安全值」**，
 * 各页型更严的上限由该页自己的 entry 显式截断（如 trends[i].title 只有 20）。
 * 反例（已修）：全局表曾把 title 写成 20（照抄 trends 的最严值），
 * 结果 direction-detail 的 hero 标题（schema 允许 40）也被砍到 20 字，
 * 一条新闻最关键的标题被拦腰截断，而 schema 本来容得下。
 */
const STRING_FIELD_MAX: Record<string, number> = {
  name: 30,
  statusText: 20,
  description: 120,
  title: 40,    // 除 trends[i].title(20) 外，各页 title 上限均 ≥40
  subtitle: 60,
  topic: 40,
  oneLine: 60,
  category: 20,
  direction: 16,    // verification page schema
  sources: 10,      // verification page schema
  summary: 200,
  comment: 40,
  primaryLink: 20,
  emphasis: 60,
};

/** 递归遍历对象，对已知字段名的 string 做 clip */
function clipAllStrings(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(clipAllStrings);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && k in STRING_FIELD_MAX) {
        out[k] = clip(v, STRING_FIELD_MAX[k]);
      } else {
        out[k] = clipAllStrings(v);
      }
    }
    return out;
  }
  return value;
}

// ============================================================================
// 动态页数预算
//
// 设计目标：**页数随当天新闻条数变化，而不是固定页数**。
// 参考稿（AI日报_2026-08-29）的做法是「一条新闻一页详情」；
// 旧引擎只给每个方向出 1 个 hero 详情页，其余条目挤进索引页列表，
// 结果页数与当天信息量脱钩（5 条新闻和 12 条新闻都是 11 页）。
//
// 现规则：
//   总页数 = 封面 1 + 概览 1
//          + Σ_方向 ( 索引 1 + 详情 min(条目数, 5) )
//          + 传闻 min(条数, 2)
//          + 作者 1 + 验证表 1 + 趋势 1 + 信源 1 + 免责声明 1
// ============================================================================

/** 每个方向最多展开的详情页数（与 generate.ts 的 summaryItems ≤5 对齐） */
export const MAX_DETAIL_PER_DIRECTION = 5;

/** 传闻详情页上限：传闻是低置信度补充信息，不应占过多版面 */
export const MAX_RUMOR_PAGES = 2;

/** deck 硬上限兜底：内容异常膨胀时也不会生成超长 deck */
export const MAX_DECK_PAGES = 30;

type ContentItem = DailyReportContent['items'][number];
type SummaryItem = DailyReportContent['directions'][number]['summaryItems'][number];

/**
 * 把 summaryItems 回匹配到真实 item。
 *
 * rank 语义：generate.ts 主路径写的是 `it.rank`（方向内部编号，可跨方向重复），
 * 降级路径写的是 `i + 1`。所以先按 rank 找，找不到时退化为「同方向第 idx 条」，
 * 保证任何上游写法都不会导致详情页静默缺失。
 */
function resolveDetailItems(
  dirItems: ContentItem[],
  summaryItems: SummaryItem[],
  cap: number,
): ContentItem[] {
  const picked: ContentItem[] = [];
  summaryItems.slice(0, cap).forEach((si, idx) => {
    const item = dirItems.find((i) => i.rank === si.rank) ?? dirItems[idx];
    if (item && !picked.includes(item)) picked.push(item);
  });
  return picked;
}

// ============================================================================
// 页面编排：根据 content 决定用哪些页型
// ============================================================================

export type SlidePlanEntry = {
  pageType: string;
  content: unknown;
};

/**
 * 把每日报告内容编排成 Slide IR
 * 返回每页的 (pageType, content) 列表，由后续管线渲染
 */
export function planBriefingDeck(content: DailyReportContent): SlidePlanEntry[] {
  const entries: SlidePlanEntry[] = [];

  // P01 封面
  entries.push({
    pageType: 'cover',
    content: {
      title: content.cover.title,
      subtitle: content.cover.subtitle,
      emphasis: content.cover.emphasis,
      date: content.date,
      stats: content.cover.stats,
    },
  });

  // P02 概览
  entries.push({
    pageType: 'overview',
    content: {
      methodNote: content.overview.methodNote,
      sourcesCount: content.overview.sources.length,
      sourceNames: content.overview.sources.map((s) => s.name),
      itemsCount: content.items.length,
      tlDr: content.overview.tlDr,
      confidenceLegend: content.overview.confidenceLegend,
      distribution: content.overview.distribution,
    },
  });

  // ----------------------------------------------------------------------
  // 动态预算：先算「固定页」，剩余额度按方向均分给详情页
  // 默认配置下 perDirCap 恒等于 MAX_DETAIL_PER_DIRECTION（5），
  // 只有内容异常膨胀（方向数/传闻数远超常规）时才会被压下来。
  // ----------------------------------------------------------------------
  const rumorItems = content.items
    .filter((i) => i.direction === 'rumor')
    .slice(0, MAX_RUMOR_PAGES);
  const fixedPages =
    1 + // 封面
    1 + // 概览
    content.directions.length + // 每个方向的索引页
    rumorItems.length + // 传闻页
    1 + // 作者
    1 + // 验证表
    1 + // 趋势
    1 + // 信源
    1; // 免责声明
  const detailBudget = Math.max(0, MAX_DECK_PAGES - fixedPages);
  const perDirCap = content.directions.length > 0
    ? Math.max(1, Math.min(MAX_DETAIL_PER_DIRECTION, Math.floor(detailBudget / content.directions.length)))
    : 0;

  // 方向段：索引页 1 张 + 逐条详情页（页数 = 当天该方向条数，上限 perDirCap）
  for (const dir of content.directions) {
    entries.push({
      pageType: 'direction-index',
      content: {
        title: dir.title,
        subtitle: dir.subtitle,
        count: dir.count,
        direction: dir.key,
        items: dir.summaryItems,
      },
    });

    const dirItems = content.items.filter((i) => i.direction === dir.key);
    const details = resolveDetailItems(dirItems, dir.summaryItems, perDirCap);

    details.forEach((item, idx) => {
      entries.push({
        pageType: 'direction-detail',
        content: {
          direction: dir.key,
          title: dir.title,
          // 同一方向多张详情页时附「第 n/N 条」，让读者知道自己在方向内的位置
          subtitle: clip(`${dir.subtitle} · ${idx + 1}/${details.length}`, 60),
          item: {
            rank: item.rank,
            title: item.title,
            // P1-PPT-1.3：summary 上限从 200 → 145（与实测右栏盒容量对齐）
            summary: clip(item.summary, 145),
            comment: item.comment,
            confidenceLevel: item.confidenceLevel,
            heroMetrics: item.heroMetrics,
            primaryLinks: item.primaryLinks,
            // 以下字段内容里本来就有，此前 plan 没透传 → 详情页拿到的是 schema 默认值，
            // 表现为左栏「0 独立信源 · 0 次转载」、要点/为什么重要整块不上版。
            // 每个字段都按 direction-detail 自身的 schema 上限截断（见 direction-detail.ts）。
            bulletPoints: item.bulletPoints.slice(0, 4).map((b) => clip(b, 60)),
            whyMatters: item.whyMatters ? clip(item.whyMatters, 200) : null,
            source: clip(item.source, 40),
            publishedAt: clip(item.publishedAt, 20),
            independentSources: item.independentSources,
            totalReposts: item.totalReposts,
            hasPrimaryLink: item.hasPrimaryLink,
          },
        },
      });
    });
  }

  // 传闻页：逐条展开（rumorItems 已在预算段算好）
  rumorItems.forEach((rumorItem, idx) => {
    entries.push({
      pageType: 'rumor',
      content: {
        // R-7：rumor header-title 容器 h=28 用 h2 字号，最长装 ~20 中文字符
        // 双保险：clip 20 字符确保 LLM 长标题也能装下
        title: clip(rumorItem.title, 20),
        subtitle:
          rumorItems.length > 1
            ? `需要保持怀疑的传闻 · ${idx + 1}/${rumorItems.length}`
            : '需要保持怀疑的传闻',
        item: {
          rank: rumorItem.rank,
          title: rumorItem.title,
          summary: clip(rumorItem.summary, 200),
          independentSources: rumorItem.independentSources,
          totalReposts: rumorItem.totalReposts,
          confidenceLevel: 'D' as const,
          whyDoubtful: rumorItem.whyDoubtful,
          whyMatters: clip(rumorItem.whyMatters, 200),
          heroMetrics: rumorItem.heroMetrics,
          keyStats: rumorItem.keyStats,
        },
      },
    });
  });

  // 作者页（页型每行最多 2 张卡，第 3/4 位显式截断，避免 capacity 检查与渲染不一致）
  // P1-PPT-1.1：差异化门槛——所有作者描述过于雷同（相似度 > 80%）时整页不渲染
  // 根因：采集链路未接入时，2 个 UP 主都被填成"本期未取到，仅列主页"，模板句
  const shownAuthors = content.authors.slice(0, 2);
  const descriptions = shownAuthors.map((a) => a.description);
  const tooSimilar = areAllSimilar(descriptions, 0.80);
  if (!tooSimilar && shownAuthors.length > 0) {
    entries.push({
      pageType: 'authors',
      content: {
        title: clip('B 站视频作者', 40),
        subtitle: clip(`${shownAuthors.length} 位 AI 早报口播作者 · 信源透明说明`, 60),
        authors: shownAuthors.map((a) => ({
          ...a,
          name: clip(a.name, 30),
          statusText: clip(a.statusText, 20),
          description: clip(a.description, 120),
        })),
      },
    });
  }

  // 验证表
  entries.push({
    pageType: 'verification',
    content: {
      title: '交叉验证汇总 · 置信度',
      subtitle: '每条均标注独立信源数、一手链接与置信度',
      rows: content.verificationTable.rows.map((r) => ({
        ...r,
        // R-7：截断超长 primaryLink（避免 lint 自身抛 ZodError）
        primaryLink: clip(r.primaryLink, PRIMARY_LINK_MAX),
      })),
      summary: clip(content.verificationTable.summary, 120),
    },
  });

  // 趋势
  // trends[i].title 上限只有 20、description 只有 110，是本工程最严的一处。
  // 显式在这里截断（而不是靠全局表压到 20，那会误伤其它页型 40 字的标题）。
  entries.push({
    pageType: 'trends',
    content: {
      title: '三条趋势判断',
      subtitle: '未来一年主线 · AI Coding × 具身智能 × 治理',
      trends: content.trends.map((t) => ({
        ...t,
        title: clip(t.title, 20),
        description: clip(t.description, 110),
      })),
    },
  });

  // 信源清单
  entries.push({
    pageType: 'sources',
    content: {
      title: '信源清单与说明',
      subtitle: '全部新闻均来自以下相互独立的信息源家族',
      skills: content.sources.skills,
      videoAuthors: content.sources.videoAuthors,
      crossSources: content.sources.crossSources,
      officialLinks: content.sources.officialLinks,
    },
  });

  // 免责声明（末页）—— 与 legacy P15 对齐，避免切流后丢失合规说明
  entries.push({
    pageType: 'disclaimer',
    content: {
      title: '免责声明与编辑说明',
      subtitle: '请仔细阅读以下内容，正确理解本份早报',
      generatedAt: content.generatedAt,
      sections: DISCLAIMER_SECTIONS,
    },
  });

  // R-7：递归 clip 所有 string 字段（防止下游 page schema 抛错）
  // 这是 plan.ts 的职责边界：保证自己产出的 plan 能通过 page schema 校验
  return entries.map((e) => ({ pageType: e.pageType, content: clipAllStrings(e.content) }));
}

// ============================================================================
// 渲染管线：plan + 主题 → PlacedSlide[]
// ============================================================================

/**
 * 把 plan + theme 渲染成 PlacedSlide 列表
 * 这一步只产出几何模型，渲染层(pptx/web)再翻译
 */
export function planBriefingToPlacedSlides(
  entries: SlidePlanEntry[],
  theme: ThemeTokens,
): PlacedSlide[] {
  const totalPages = entries.length;
  const slides: PlacedSlide[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const def = getPageType(entry.pageType);
    const pageNo = i + 1;

    // 注入测量上下文（M7 上下文注入）
    const ctx = {
      theme,
      pageNo,
      totalPages,
      measureWidth: (text: string, size: number, opts?: any) => measureWidth(text, size, opts),
      measureLines: (text: string, size: number, boxWidthPt: number, opts?: any) => measureLines(text, size, boxWidthPt, opts),
    };

    // 内容容量校验（M4）
    const capacity = def.capacity(entry.content, theme);

    // 布局规划（M7）
    const placed = def.plan(entry.content, ctx);

    // 附加容量结果（L4 依据）
    slides.push({
      ...placed,
      capacity,
    });
  }

  return slides;
}

/**
 * 一键入口：DailyReportContent → PlacedSlide[]
 */
export function renderBriefingDeck(
  content: DailyReportContent,
  theme: ThemeTokens,
): PlacedSlide[] {
  const entries = planBriefingDeck(content);
  return planBriefingToPlacedSlides(entries, theme);
}
