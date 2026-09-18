/**
 * 传言页型（Rumor / D 存疑）
 * 顶部横幅（独立信源数 → 转载数）+ 三栏（事件本身 / 为何存疑 / 为何仍值得关注）
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { FONT } from '../theme';

export const RumorContentSchema = z.object({
  title: z.string().max(40),
  subtitle: z.string().max(60),
  item: z.object({
    rank: z.number().int().positive(),
    title: z.string().max(40),
    summary: z.string().max(200),
    independentSources: z.number().int().positive(),
    totalReposts: z.number().int().min(0),
    confidenceLevel: z.enum(['D']),  // 必须是 D
    whyDoubtful: z.array(z.string().max(60)).max(4),
    whyMatters: z.string().max(200).nullable(),
    heroMetrics: z.array(z.object({
      value: z.string(),
      label: z.string(),
    })).max(2),
    keyStats: z.array(z.object({
      value: z.string(),
      label: z.string(),
      color: z.enum(['primary', 'secondary', 'accent']),
    })).max(3),
  }),
});

export type RumorContent = z.infer<typeof RumorContentSchema>;

const SLOTS = ['header-title', 'header-subtitle', 'header-chip', 'top-banner', 'top-banner-stats', 'top-banner-summary', 'col-1-title', 'col-1-body', 'col-2-title', 'col-2-body', 'col-3-title', 'col-3-body', 'page-no'];

export const rumorPageType: PageTypeDefinition = {
  key: 'rumor',
  title: '传闻',
  contentSchema: RumorContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = RumorContentSchema.parse(content);
    return {
      ok: true,
      overflows: [],
    };
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = RumorContentSchema.parse(content);
    const { theme, pageNo, totalPages, measureLines } = ctx;
    const boxes: PlacedBox[] = [];
    const W = theme.page.width;
    const H = theme.page.height;
    const PAD_X = 36;

    // Header
    // R-7 修复（2026-09-13）：rumor.title 是 LLM 动态生成的"传闻"标题，可能很长。
    // 之前用 h1（26pt）+ 容器 32pt + LLM 40 字 → 文本高度 65pt → lint L2 error
    // 修复：改用 h2 字号（20pt）× 1.3 lineHeight = 26pt 单行；600pt 宽能装约 30 字英文 / 18 字中文
    // 同时 plan.ts 已 clip title 到 20 字符（双保险）
    // 注意：header-chip 在 x=W-130=830，所以 header-title 宽度必须 < 800（避免重叠）
    boxes.push({
      id: 'header-title',
      slot: 'header-title',
      kind: 'text',
      box: { x: PAD_X, y: 18, w: 760, h: 28 },  // h2 单行 26pt → 容器 28pt；宽度 760 < 830 给 chip 留位
      z: 2,
      text: {
        value: c.title,
        font: 'cn',
        size: theme.type.h2.size,
        weight: theme.type.h2.weight,
        lineHeight: theme.type.h2.lineHeight,
        align: 'left',
        color: theme.colors.ink,
        maxLines: 1,
      },
    });

    boxes.push({
      id: 'header-subtitle',
      slot: 'header-subtitle',
      kind: 'text',
      box: { x: PAD_X, y: 52, w: 600, h: 18 },
      z: 2,
      text: {
        value: c.subtitle,
        font: 'cn',
        size: theme.type.caption.size,
        weight: theme.type.caption.weight,
        lineHeight: theme.type.caption.lineHeight,
        align: 'left',
        color: theme.colors.inkSubtle,
        maxLines: 1,
      },
    });

    boxes.push({
      id: 'header-chip',
      slot: 'header-chip',
      kind: 'badge',
      box: { x: W - 130, y: 22, w: 80, h: 30 },
      z: 2,
      fill: theme.colors.accent,
      radius: 15,
      text: {
        value: '⚠ D 存疑',
        font: 'cn',
        size: FONT.caption,
        weight: 700,
        lineHeight: 1.2,
        align: 'center',
        color: '#FFFFFF',
        maxLines: 1,
      },
    });

    // 顶部横幅
    const bannerY = 90;
    const bannerH = 100;
    boxes.push({
      id: 'top-banner',
      slot: 'top-banner',
      kind: 'card',
      box: { x: PAD_X, y: bannerY, w: W - PAD_X * 2, h: bannerH },
      z: 2,
      fill: theme.colors.accentSoft,
      radius: 4,
      borderColor: '#FDE68A',
    });

    // 数字对比
    boxes.push({
      id: 'top-banner-stats',
      slot: 'top-banner-stats',
      kind: 'text',
      box: { x: PAD_X + 16, y: bannerY + 18, w: 280, h: 64 },
      z: 3,
      text: {
        value: `${c.item.independentSources}  →  ${c.item.totalReposts}+`,
        font: 'num',
        size: FONT.number,
        weight: 700,
        lineHeight: 1.2,
        align: 'left',
        color: theme.colors.accent,
        maxLines: 1,
      },
    });

    // 横幅说明
    const bannerText = `独立信源 ${c.item.independentSources}，转载 ${c.item.totalReposts}+ —— 转载 ≠ 独立信源`;
    boxes.push({
      id: 'top-banner-summary',
      slot: 'top-banner-summary',
      kind: 'text',
      box: { x: PAD_X + 310, y: bannerY + 24, w: 540, h: 60 },
      z: 3,
      text: {
        value: bannerText,
        font: 'cn',
        size: FONT.body,
        weight: 400,
        lineHeight: 1.55,
        align: 'left',
        color: theme.colors.accent,
        maxLines: 3,
      },
    });

    // 三栏
    const colY = bannerY + bannerH + 16;
    const colH = H - colY - 50;
    const colGap = 12;
    const colW = (W - PAD_X * 2 - colGap * 2) / 3;

    // 列 1：事件本身
    boxes.push({
      id: 'col-1-title',
      slot: 'col-1-title',
      kind: 'text',
      box: { x: PAD_X, y: colY, w: colW, h: 22 },
      z: 2,
      text: {
        value: '事件本身',
        font: 'cn',
        size: FONT.body,
        weight: 700,
        lineHeight: 1.3,
        align: 'left',
        color: theme.colors.ink,
        maxLines: 1,
      },
    });

    const col1Lines = measureLines(c.item.summary, FONT.caption, colW, { weight: 400, font: 'cn' });
    boxes.push({
      id: 'col-1-body',
      slot: 'col-1-body',
      kind: 'text',
      box: { x: PAD_X, y: colY + 28, w: colW, h: colH - 28 },
      z: 2,
      text: {
        value: c.item.summary,
        font: 'cn',
        size: FONT.caption,
        weight: 400,
        lineHeight: 1.55,
        align: 'left',
        color: theme.colors.inkMuted,
        maxLines: Math.min(col1Lines, 10),
      },
    });

    // 列 2：为何存疑
    const col2X = PAD_X + colW + colGap;
    boxes.push({
      id: 'col-2-title',
      slot: 'col-2-title',
      kind: 'text',
      box: { x: col2X, y: colY, w: colW, h: 22 },
      z: 2,
      text: {
        value: '为何评为 D 存疑',
        font: 'cn',
        size: FONT.body,
        weight: 700,
        lineHeight: 1.3,
        align: 'left',
        color: theme.colors.accent,
        maxLines: 1,
      },
    });

    const doubtText = c.item.whyDoubtful.length > 0
      ? c.item.whyDoubtful.map((d, i) => `${i + 1}. ${d}`).join('\n')
      : '缺乏多源印证';
    const col2Lines = measureLines(doubtText, FONT.caption, colW, { weight: 400, font: 'cn' });
    boxes.push({
      id: 'col-2-body',
      slot: 'col-2-body',
      kind: 'text',
      box: { x: col2X, y: colY + 28, w: colW, h: colH - 28 },
      z: 2,
      text: {
        value: doubtText,
        font: 'cn',
        size: FONT.caption,
        weight: 400,
        lineHeight: 1.55,
        align: 'left',
        color: theme.colors.inkMuted,
        maxLines: Math.min(col2Lines, 10),
      },
    });

    // 列 3：为何仍值得关注
    const col3X = PAD_X + 2 * (colW + colGap);
    boxes.push({
      id: 'col-3-title',
      slot: 'col-3-title',
      kind: 'text',
      box: { x: col3X, y: colY, w: colW, h: 22 },
      z: 2,
      text: {
        value: '为何仍值得关注',
        font: 'cn',
        size: FONT.body,
        weight: 700,
        lineHeight: 1.3,
        align: 'left',
        color: theme.colors.primary,
        maxLines: 1,
      },
    });

    const mattersText = c.item.whyMatters ?? '行业关注度高，建议持续跟踪';
    const col3Lines = measureLines(mattersText, FONT.caption, colW, { weight: 400, font: 'cn' });
    boxes.push({
      id: 'col-3-body',
      slot: 'col-3-body',
      kind: 'text',
      box: { x: col3X, y: colY + 28, w: colW, h: colH - 28 },
      z: 2,
      text: {
        value: mattersText,
        font: 'cn',
        size: FONT.caption,
        weight: 400,
        lineHeight: 1.55,
        align: 'left',
        color: theme.colors.inkMuted,
        maxLines: Math.min(col3Lines, 10),
      },
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

    return { pageNo, totalPages, pageType: 'rumor', boxes };
  },
};
