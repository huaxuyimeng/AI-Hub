/**
 * 方向详情页型（Direction Detail）—— 「一条新闻一页」
 *
 * 左 38% 色块：方向标题 + 序号/置信度 chip + 本条标题 + hero 指标 + 信源计数与来源
 * 右 62%：摘要 / 编辑点评 / 要点 / 为什么重要 / 一手来源
 *
 * 为什么把两列都排满：
 *   旧版详情页只用了 summary + 2 个 metric，实测留白超过 50%；
 *   而内容里明明带着 bulletPoints / whyMatters / keyStats / 独立信源数 —— 全都没上版。
 *   参考稿（AI日报_2026-08-29）的密度标准是「留白 ≤35%」，这里把一条新闻的可用素材摊开。
 *
 * 配色约束：左列是深色块，所有左列文字必须是白系（旧版用 ink/inkSubtle，深字压深底）。
 *
 * 右列为什么是一次分配：
 *   摘要(4行) + 点评 + 要点(4条) + 为什么重要(5行) + 一手来源 = 431pt，而右列只有 418pt。
 *   旧写法每块各自 `if (装得下)`，互相不知道对方要多少 → 实测 8 处 L2 溢出。
 *   现在按「要点条数 → 为什么重要行数 → 摘要行数」的顺序回缩到预算内，
 *   再用垂直均摊把富余空间摊到块间距上（块本身不变形），
 *   每块声明的 maxLines 就是分配结果，并用 clipToLines 同步截断文本 —— 声明与内容永远一致。
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';
import { clipToLines } from '../../../layout/measure';
import { FONT } from '../theme';

export const DirectionDetailContentSchema = z.object({
  direction: z.enum(['coding', 'embodied']),
  title: z.string().max(40),
  subtitle: z.string().max(60),
  item: z.object({
    rank: z.number().int().positive(),
    title: z.string().max(40),
    // P1-PPT-1.3：实测右栏 summary 盒装约 145 字（200 → 145），让内容按真实容量写
    summary: z.string().max(145),
    comment: z.string().max(40),
    confidenceLevel: z.enum(['A', 'B', 'C', 'D']),
    heroMetrics: z.array(z.object({
      value: z.string().max(10),
      label: z.string().max(20),
      sub: z.string().optional(),
    })).max(4),
    primaryLinks: z.array(z.object({
      source: z.string(),
      url: z.string().url(),
    })).max(4),
    // ---- 以下字段内容里已有，此前从未上版 ----
    bulletPoints: z.array(z.string().max(60)).max(4).default([]),
    whyMatters: z.string().max(200).nullable().default(null),
    source: z.string().max(40).default(''),
    publishedAt: z.string().max(20).default(''),
    independentSources: z.number().int().min(0).default(0),
    totalReposts: z.number().int().min(0).default(0),
    hasPrimaryLink: z.boolean().default(false),
  }),
});

export type DirectionDetailContent = z.infer<typeof DirectionDetailContentSchema>;

const SLOTS = [
  'left-color-block',
  'header-title', 'header-subtitle', 'header-chip', 'header-chip-confidence',
  'hero-title',
  'metric-1', 'metric-1-value', 'metric-1-label',
  'metric-2', 'metric-2-value', 'metric-2-label',
  'left-meta-counts', 'left-meta-source',
  'right-summary', 'right-comment', 'right-bullet-title',
  'bullet-1', 'bullet-2', 'bullet-3', 'bullet-4',
  'right-why-card', 'right-why-title', 'right-why-body',
  'right-link-title', 'right-link-1', 'right-link-2',
  'page-no',
];

// ============================================================================
// 几何常量（pt，画布 960 × 540）
// ============================================================================

const PAD_X = 36;
const LEFT_RATIO = 0.38;

const RIGHT_TOP = 78;
/** 右列内容下限：再往下会压到页脚页码（y = 540-22） */
const RIGHT_BOTTOM = 496;

const LINE_H_BODY = FONT.body * 1.6;          // 摘要行高 20.8
const LINE_H_CAPTION = FONT.caption * 1.5;    // 说明行高 16.5

const MAX_SUMMARY_LINES = 6;
const MIN_SUMMARY_LINES = 2;                  // 摘要是本条新闻的核心，保底 2 行

const BULLET_TITLE_H = 22;    // 「要点」标题盒 18 + 间距 4
const BULLET_UNIT = 22;       // 单条要点盒 20 + 间距 2
const BULLET_TAIL = 6;        // 块尾留白
const MIN_BULLET_ITEMS = 2;   // 少于 2 条就不值得占一块

const LINK_TITLE_H = 20;      // 「一手来源」标题盒 18 + 间距 2
const LINK_UNIT = 20;         // 单条链接盒 18 + 间距 2
const MAX_LINKS = 2;

const WHY_CARD_PAD = 40;      // 卡内：顶 8 + 标题 18 + 底 10 + 块后间距 4
/** 少于 1 行不值得开卡；不能设成 2 —— 实测会把只写一句话的 whyMatters 整块丢掉 */
const MIN_WHY_LINES = 1;

const GAP_BASE = 10;          // 块间基础间距
const GAP_MAX = 28;           // 均摊上限：超过就宁可留白在底部，也不要拉开一道中缝

// ============================================================================
// 右列块
// ============================================================================

type RightBlock = {
  key: string;
  /** 块自身高度（含块内边距，不含块间间距） */
  h: number;
  render: (y: number) => PlacedBox[];
};

export const directionDetailPageType: PageTypeDefinition = {
  key: 'direction-detail',
  title: '方向详情',
  contentSchema: DirectionDetailContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = DirectionDetailContentSchema.parse(content);
    // 只声明「与内容长度直接挂钩」的硬预算（字数 / 条目数）。
    // 行数预算不在这里写死：它由 plan() 按当页剩余空间动态分配，
    // 写成常量只会得到「永远通过」的假绿（旧版就是写死 lines:3 vs maxLines:3）。
    return checkCapacity(
      [
        { slot: 'right-summary', chars: c.item.summary.length },
        { slot: 'right-comment', chars: c.item.comment.length },
        { slot: 'bullets', items: c.item.bulletPoints.length },
        { slot: 'right-why-body', chars: c.item.whyMatters?.length ?? 0 },
      ],
      [
        { slot: 'right-summary', maxChars: 145 },
        { slot: 'right-comment', maxChars: 40 },
        { slot: 'bullets', maxItems: 4 },
        { slot: 'right-why-body', maxChars: 200 },
      ],
    );
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = DirectionDetailContentSchema.parse(content);
    const { theme, pageNo, totalPages, measureLines } = ctx;
    const boxes: PlacedBox[] = [];
    const W = theme.page.width;
    const H = theme.page.height;

    const isCoding = c.direction === 'coding';
    const primaryCol = isCoding ? theme.colors.primary : theme.colors.secondary;

    const leftContentX = 16;
    const leftContentW = W * LEFT_RATIO - 32;

    // ======================= 左列：色块 + hero =======================
    boxes.push({
      id: 'left-color-block',
      slot: 'left-color-block',
      kind: 'card',
      box: { x: 0, y: 0, w: W * LEFT_RATIO, h: H },
      z: 1,
      fill: primaryCol,
      decorative: true,
    });

    boxes.push({
      id: 'header-title',
      slot: 'header-title',
      kind: 'text',
      box: { x: PAD_X, y: 18, w: W * LEFT_RATIO - PAD_X * 2, h: 32 },
      z: 2,
      text: {
        value: c.title,
        font: 'cn',
        size: FONT.h2,
        weight: theme.type.h2.weight,
        lineHeight: theme.type.h2.lineHeight,
        align: 'left',
        color: '#FFFFFF',
        maxLines: 2,
      },
    });

    boxes.push({
      id: 'header-subtitle',
      slot: 'header-subtitle',
      kind: 'text',
      box: { x: PAD_X, y: 52, w: W * LEFT_RATIO - PAD_X * 2, h: 18 },
      z: 2,
      text: {
        value: c.subtitle,
        font: 'cn',
        size: FONT.caption,
        weight: theme.type.caption.weight,
        lineHeight: theme.type.caption.lineHeight,
        align: 'left',
        color: '#FFFFFFCC',
        maxLines: 1,
      },
    });

    // 序号 chip
    boxes.push({
      id: 'header-chip',
      slot: 'header-chip',
      kind: 'badge',
      box: { x: PAD_X, y: 86, w: 80, h: 28 },
      z: 2,
      fill: '#FFFFFF33',
      radius: 14,
      text: {
        value: `#${c.item.rank}`,
        font: 'num',
        size: FONT.caption,
        weight: 700,
        lineHeight: 1.2,
        align: 'center',
        color: '#FFFFFF',
        maxLines: 1,
      },
    });

    // 置信度 chip —— 详情页原来完全没有置信度标识，读者无法判断这条的可靠度
    boxes.push({
      id: 'header-chip-confidence',
      slot: 'header-chip-confidence',
      kind: 'badge',
      box: { x: PAD_X + 88, y: 86, w: 52, h: 28 },
      z: 2,
      fill: '#FFFFFF',
      radius: 14,
      text: {
        value: `${c.item.confidenceLevel} 级`,
        font: 'cn',
        size: FONT.caption,
        weight: 700,
        lineHeight: 1.2,
        align: 'center',
        color: primaryCol,
        maxLines: 1,
      },
    });

    // hero title
    // 没有 hero 指标时，左列下半部会空出 200pt+，把标题垂直居中到色块中部，
    // 变成一张「章节式」页面，比让标题孤零零贴在顶部好看。
    const metrics = c.item.heroMetrics.slice(0, 2);
    const heroY = metrics.length === 0 ? 232 : 126;
    boxes.push({
      id: 'hero-title',
      slot: 'hero-title',
      kind: 'text',
      box: { x: leftContentX, y: heroY, w: leftContentW, h: 66 },
      z: 2,
      allowUnsafe: true,
      text: {
        value: c.item.title,
        font: 'cn',
        size: FONT.h3,
        weight: 700,
        lineHeight: 1.35,
        align: 'left',
        color: '#FFFFFF',
        maxLines: 3,
      },
    });

    metrics.forEach((m, i) => {
      const my = 204 + i * 92;

      boxes.push({
        id: `metric-${i + 1}`,
        slot: `metric-${i + 1}`,
        kind: 'card',
        box: { x: leftContentX, y: my, w: leftContentW, h: 78 },
        z: 2,
        fill: '#FFFFFF1F',
        radius: 8,
        decorative: true,
      });

      boxes.push({
        id: `metric-${i + 1}-value`,
        slot: `metric-${i + 1}-value`,
        kind: 'text',
        box: { x: leftContentX + 12, y: my + 8, w: leftContentW - 24, h: 36 },
        z: 3,
        allowUnsafe: true,
        text: {
          value: m.value,
          font: 'num',
          size: m.value.length > 5 ? FONT.h1 : FONT.number,
          weight: 700,
          lineHeight: 1,
          align: 'left',
          color: '#FFFFFF',
          maxLines: 1,
        },
      });

      boxes.push({
        id: `metric-${i + 1}-label`,
        slot: `metric-${i + 1}-label`,
        kind: 'text',
        box: { x: leftContentX + 12, y: my + 48, w: leftContentW - 24, h: 22 },
        z: 3,
        allowUnsafe: true,
        text: {
          value: m.sub ? `${m.label} · ${m.sub}` : m.label,
          font: 'cn',
          size: FONT.caption,
          weight: 400,
          lineHeight: 1.3,
          align: 'left',
          color: '#FFFFFFCC',
          maxLines: 1,
        },
      });
    });

    // 左列底部：信源计数 + 来源/日期（此前详情页上完全看不到这些）
    boxes.push({
      id: 'left-meta-counts',
      slot: 'left-meta-counts',
      kind: 'text',
      box: { x: leftContentX, y: 428, w: leftContentW, h: 22 },
      z: 2,
      allowUnsafe: true,
      text: {
        value: `${c.item.independentSources} 独立信源 · ${c.item.totalReposts} 次转载 · ${
          c.item.hasPrimaryLink ? '有一手链接' : '无一手链接'
        }`,
        font: 'cn',
        size: FONT.caption,
        weight: 600,
        lineHeight: 1.3,
        align: 'left',
        color: '#FFFFFF',
        maxLines: 1,
      },
    });

    boxes.push({
      id: 'left-meta-source',
      slot: 'left-meta-source',
      kind: 'text',
      box: { x: leftContentX, y: 452, w: leftContentW, h: 20 },
      z: 2,
      allowUnsafe: true,
      text: {
        value: `${c.item.source}${c.item.publishedAt ? ` · ${c.item.publishedAt}` : ''}`,
        font: 'cn',
        size: FONT.caption,
        weight: 400,
        lineHeight: 1.3,
        align: 'left',
        color: '#FFFFFFB3',
        maxLines: 1,
      },
    });

    // ======================= 右列：一次分配 =======================
    const rightX = W * LEFT_RATIO + 24;
    const rightW = W - rightX - PAD_X;
    const whyW = rightW - 24;
    const budget = RIGHT_BOTTOM - RIGHT_TOP;

    const summaryText = c.item.summary;
    const commentText = c.item.comment ? `💡 ${c.item.comment}` : '';
    const whyText = c.item.whyMatters ?? '';
    const links = c.item.primaryLinks.slice(0, MAX_LINKS);

    // 期望值：按内容实测行数起步
    let summaryLines = Math.min(
      measureLines(summaryText, FONT.body, rightW, { weight: 400, font: 'cn' }),
      MAX_SUMMARY_LINES,
    );
    let whyLines = whyText
      ? measureLines(whyText, FONT.caption, whyW, { weight: 400, font: 'cn' })
      : 0;
    let bulletItems = c.item.bulletPoints.slice(0, 4).length;

    const hSummary = () => summaryLines * LINE_H_BODY;
    const hComment = () => (commentText ? FONT.caption * 1.5 * 2 : 0);
    const hBullets = () =>
      bulletItems > 0 ? BULLET_TITLE_H + bulletItems * BULLET_UNIT + BULLET_TAIL : 0;
    const hWhy = () => (whyLines >= MIN_WHY_LINES ? WHY_CARD_PAD + whyLines * LINE_H_CAPTION : 0);
    const hLinks = () => (links.length > 0 ? LINK_TITLE_H + links.length * LINK_UNIT : 0);

    const blockCount = () =>
      [summaryLines > 0, commentText !== '', bulletItems > 0, whyLines >= MIN_WHY_LINES, links.length > 0]
        .filter(Boolean).length;
    const totalH = () => hSummary() + hComment() + hBullets() + hWhy() + hLinks();
    const totalWithGaps = () => totalH() + Math.max(0, blockCount() - 1) * GAP_BASE;

    // 回缩顺序：先砍要点条数（保留 ≥2 条），再压「为什么重要」（保留 ≥2 行），
    // 然后是彻底放弃这两块，摘要（本条新闻的核心）最后才动，且保底 2 行。
    let guard = 0;
    while (totalWithGaps() > budget && guard++ < 60) {
      if (bulletItems > MIN_BULLET_ITEMS) { bulletItems -= 1; continue; }
      if (whyLines > MIN_WHY_LINES) { whyLines -= 1; continue; }
      if (bulletItems > 0) { bulletItems -= 1; continue; }
      if (whyLines > 0) { whyLines -= 1; continue; }
      if (summaryLines > MIN_SUMMARY_LINES) { summaryLines -= 1; continue; }
      break;
    }

    const blocks: RightBlock[] = [];

    if (summaryLines > 0) {
      const raw = clipToLines(summaryText, FONT.body, rightW, summaryLines, { weight: 400, font: 'cn' });
      blocks.push({
        key: 'right-summary',
        h: hSummary(),
        render: (y) => [{
          id: 'right-summary',
          slot: 'right-summary',
          kind: 'text',
          box: { x: rightX, y, w: rightW, h: hSummary() },
          z: 2,
          text: {
            value: raw,
            font: 'cn',
            size: FONT.body,
            weight: 400,
            lineHeight: 1.6,
            align: 'left',
            color: theme.colors.ink,
            maxLines: summaryLines,
          },
        }],
      });
    }

    if (commentText) {
      const raw = clipToLines(commentText, FONT.caption, rightW, 2, { weight: 400, font: 'cn' });
      blocks.push({
        key: 'right-comment',
        h: hComment(),
        render: (y) => [{
          id: 'right-comment',
          slot: 'right-comment',
          kind: 'text',
          box: { x: rightX, y, w: rightW, h: hComment() },
          z: 2,
          text: {
            value: raw,
            font: 'cn',
            size: FONT.caption,
            weight: 400,
            lineHeight: 1.45,
            align: 'left',
            color: theme.colors.inkMuted,
            maxLines: 2,
          },
        }],
      });
    }

    if (bulletItems > 0) {
      // 每条压到 1 行：要点是要扫的，不是要读的；超长直接省略号
      const items = c.item.bulletPoints
        .slice(0, bulletItems)
        .map((b) => clipToLines(`▸ ${b}`, FONT.body, rightW - 2, 1, { weight: 400, font: 'cn' }));
      blocks.push({
        key: 'right-bullets',
        h: hBullets(),
        render: (y) => {
          const out: PlacedBox[] = [{
            id: 'right-bullet-title',
            slot: 'right-bullet-title',
            kind: 'text',
            box: { x: rightX, y, w: rightW, h: 18 },
            z: 2,
            text: {
              value: '要点',
              font: 'cn',
              size: FONT.caption,
              weight: 700,
              lineHeight: 1.3,
              align: 'left',
              color: theme.colors.inkSubtle,
              maxLines: 1,
            },
          }];
          items.forEach((b, i) => {
            out.push({
              id: `bullet-${i + 1}`,
              slot: `bullet-${i + 1}`,
              kind: 'text',
              box: { x: rightX + 2, y: y + BULLET_TITLE_H + i * BULLET_UNIT, w: rightW - 2, h: 20 },
              z: 2,
              text: {
                value: b,
                font: 'cn',
                size: FONT.body,
                weight: 400,
                lineHeight: 1.45,
                align: 'left',
                color: theme.colors.inkMuted,
                maxLines: 1,
              },
            });
          });
          return out;
        },
      });
    }

    if (whyLines >= MIN_WHY_LINES) {
      const bodyH = whyLines * LINE_H_CAPTION;
      const cardH = 30 + bodyH + 10;
      const raw = clipToLines(whyText, FONT.caption, whyW, whyLines, { weight: 400, font: 'cn' });
      blocks.push({
        key: 'right-why',
        h: hWhy(),
        render: (y) => [
          {
            id: 'right-why-card',
            slot: 'right-why-card',
            kind: 'card',
            box: { x: rightX, y, w: rightW, h: cardH },
            z: 2,
            fill: theme.colors.primarySoft,
            radius: 6,
            borderColor: theme.colors.borderLight,
          },
          {
            id: 'right-why-title',
            slot: 'right-why-title',
            kind: 'text',
            box: { x: rightX + 12, y: y + 8, w: whyW, h: 18 },
            z: 3,
            text: {
              value: '为什么重要',
              font: 'cn',
              size: FONT.caption,
              weight: 700,
              lineHeight: 1.3,
              align: 'left',
              color: theme.colors.primary,
              maxLines: 1,
            },
          },
          {
            id: 'right-why-body',
            slot: 'right-why-body',
            kind: 'text',
            box: { x: rightX + 12, y: y + 28, w: whyW, h: bodyH },
            z: 3,
            text: {
              value: raw,
              font: 'cn',
              size: FONT.caption,
              weight: 400,
              lineHeight: 1.5,
              align: 'left',
              color: theme.colors.inkMuted,
              maxLines: whyLines,
            },
          },
        ],
      });
    }

    if (links.length > 0) {
      blocks.push({
        key: 'right-links',
        h: hLinks(),
        render: (y) => {
          const out: PlacedBox[] = [{
            id: 'right-link-title',
            slot: 'right-link-title',
            kind: 'text',
            box: { x: rightX, y, w: rightW, h: 18 },
            z: 2,
            text: {
              value: '一手来源',
              font: 'cn',
              size: FONT.caption,
              weight: 600,
              lineHeight: 1.4,
              align: 'left',
              color: theme.colors.inkSubtle,
              maxLines: 1,
            },
          }];
          links.forEach((pl, i) => {
            out.push({
              id: `right-link-${i + 1}`,
              slot: `right-link-${i + 1}`,
              kind: 'text',
              box: { x: rightX, y: y + LINK_TITLE_H + i * LINK_UNIT, w: rightW, h: 18 },
              z: 2,
              text: {
                value: `${i + 1}. ${pl.source.slice(0, 36)}`,
                font: 'cn',
                size: FONT.micro,
                weight: 400,
                lineHeight: 1.3,
                align: 'left',
                color: theme.colors.linkBlue,
                maxLines: 1,
              },
            });
          });
          return out;
        },
      });
    }

    // 垂直均摊：块高不变，把富余空间摊进块间距（上下各留一半，避免富余全部堆到底部显得头重脚轻）
    // 上限 GAP_MAX 兜住「内容极薄时被拉成两行三截」；居中量也封顶 60pt，不做整屏居中。
    const slack = budget - totalH();
    const gaps = Math.max(0, blocks.length - 1);
    const extra = Math.max(0, slack - gaps * GAP_BASE);
    const gap = gaps > 0 ? GAP_BASE + Math.min(GAP_MAX - GAP_BASE, extra / gaps) : 0;
    const leftover = Math.max(0, slack - gap * gaps);
    let ry = RIGHT_TOP + (gaps > 0 ? Math.min(60, leftover / 2) : 0);

    blocks.forEach((b) => {
      boxes.push(...b.render(ry));
      ry += b.h + gap;
    });

    // 页脚页码
    boxes.push({
      id: 'page-no',
      slot: 'page-no',
      kind: 'text',
      box: { x: W - 100, y: H - 22, w: 64, h: 16 },
      z: 2,
      allowUnsafe: true,
      text: {
        value: `${String(pageNo).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`,
        font: 'cn',
        size: FONT.micro,
        weight: 400,
        lineHeight: 1.4,
        align: 'right',
        color: theme.colors.inkSubtle,
        maxLines: 1,
      },
    });

    return { pageNo, totalPages, pageType: 'direction-detail', boxes };
  },
};
