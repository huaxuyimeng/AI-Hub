/**
 * 结尾页型（Sources / Ending）
 * 4 列信源清单：聚合源 / 视频作者 / 第三方交叉源 / 一手官方
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { FONT } from '../theme';

export const SourcesContentSchema = z.object({
  title: z.string().max(40),
  subtitle: z.string().max(60),
  skills: z.array(z.object({
    name: z.string().max(30),
    url: z.string().url(),
  })).max(10),
  videoAuthors: z.array(z.object({
    name: z.string().max(30),
    url: z.string().url(),
  })).max(10),
  crossSources: z.array(z.object({
    name: z.string().max(30),
    url: z.string().url(),
  })).max(10),
  officialLinks: z.array(z.object({
    name: z.string().max(30),
    url: z.string().url(),
  })).max(10),
});

export type SourcesContent = z.infer<typeof SourcesContentSchema>;

const SLOTS = ['header-title', 'header-subtitle', 'block-1', 'block-2', 'block-3', 'block-4', 'page-no'];

export const sourcesPageType: PageTypeDefinition = {
  key: 'sources',
  title: '信源清单',
  contentSchema: SourcesContentSchema,
  slots: SLOTS,

  capacity() {
    return { ok: true, overflows: [] };
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = SourcesContentSchema.parse(content);
    const { theme, pageNo, totalPages } = ctx;
    const boxes: PlacedBox[] = [];
    const W = theme.page.width;
    const H = theme.page.height;
    const PAD_X = 36;

    // Header
    boxes.push({
      id: 'header-title',
      slot: 'header-title',
      kind: 'text',
      box: { x: PAD_X, y: 18, w: 600, h: 32 },
      z: 2,
      text: {
        value: c.title,
        font: 'cn',
        size: theme.type.h1.size,
        weight: theme.type.h1.weight,
        lineHeight: theme.type.h1.lineHeight,
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

    // 4 列
    const blocks = [
      { title: '聚合源', items: c.skills, color: theme.colors.primary, bg: theme.colors.primarySoft },
      { title: '视频作者', items: c.videoAuthors, color: theme.colors.secondary, bg: theme.colors.secondarySoft },
      { title: '第三方交叉', items: c.crossSources, color: theme.colors.accent, bg: theme.colors.accentSoft },
      { title: '一手官方', items: c.officialLinks, color: theme.colors.primary, bg: theme.colors.primarySoft },
    ];

    const blockTop = 90;
    const blockH = H - blockTop - 50;
    const blockW = (W - PAD_X * 2 - 12) / 4;

    blocks.forEach((block, i) => {
      const bx = PAD_X + i * (blockW + 4);

      // 卡片背景
      boxes.push({
        id: `block-${i + 1}`,
        slot: `block-${i + 1}`,
        kind: 'card',
        box: { x: bx, y: blockTop, w: blockW, h: blockH },
        z: 2,
        fill: block.bg,
        radius: 4,
        borderColor: theme.colors.border,
      });

      // 标题
      boxes.push({
        id: `block-${i + 1}-title`,
        slot: `block-${i + 1}`,
        kind: 'text',
        box: { x: bx + 8, y: blockTop + 10, w: blockW - 16, h: 22 },
        z: 3,
        text: {
          value: `${block.title}（${block.items.length}）`,
          font: 'cn',
          size: FONT.caption,
          weight: 700,
          lineHeight: 1.3,
          align: 'left',
          color: block.color,
          maxLines: 1,
        },
      });

      // 条目
      block.items.slice(0, 8).forEach((it, j) => {
        const iy = blockTop + 36 + j * 18;
        boxes.push({
          id: `block-${i + 1}-item-${j + 1}`,
          slot: `block-${i + 1}`,
          kind: 'text',
          box: { x: bx + 8, y: iy, w: blockW - 16, h: 16 },
          z: 3,
          text: {
            value: `• ${it.name.slice(0, 18)}`,
            font: 'cn',
            size: FONT.micro,
            weight: 400,
            lineHeight: 1.3,
            align: 'left',
            color: theme.colors.inkMuted,
            maxLines: 1,
          },
        });
      });
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

    return { pageNo, totalPages, pageType: 'sources', boxes };
  },
};
