/**
 * 趋势页型（Trends）
 * 左 25% 大数字 "3" 圆 + 右 75% 三趋势卡
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';
import { FONT } from '../theme';

export const TrendsContentSchema = z.object({
  title: z.string().max(40),
  subtitle: z.string().max(60),
  trends: z.array(z.object({
    rank: z.number().int().positive(),
    title: z.string().max(20),
    description: z.string().max(110),
  })).length(3),
});

export type TrendsContent = z.infer<typeof TrendsContentSchema>;

const SLOTS = ['header-title', 'header-subtitle', 'big-3', 'big-3-number', 'big-3-circle', 'big-3-label', 'trend-1', 'trend-1-rank', 'trend-1-title', 'trend-1-desc', 'trend-2', 'trend-2-rank', 'trend-2-title', 'trend-2-desc', 'trend-3', 'trend-3-rank', 'trend-3-title', 'trend-3-desc', 'page-no'];

export const trendsPageType: PageTypeDefinition = {
  key: 'trends',
  title: '趋势',
  contentSchema: TrendsContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = TrendsContentSchema.parse(content);
    return checkCapacity(
      c.trends.map((t, i) => ({ slot: `trend-${i + 1}`, chars: t.description.length, lines: 4 })),
      c.trends.map((_, i) => ({ slot: `trend-${i + 1}`, maxChars: 110, maxLines: 4 })),
    );
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = TrendsContentSchema.parse(content);
    const { theme, pageNo, totalPages, measureLines } = ctx;
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

    // 左：大 3
    const bigY = 100;
    const bigW = 200;
    const bigH = 360;

    boxes.push({
      id: 'big-3-circle',
      slot: 'big-3-circle',
      kind: 'card',
      box: { x: PAD_X, y: bigY, w: bigW, h: bigH },
      z: 2,
      fill: theme.colors.accent,
      radius: 100,
    });

    boxes.push({
      id: 'big-3-number',
      slot: 'big-3-number',
      kind: 'text',
      box: { x: PAD_X, y: bigY + 80, w: bigW, h: 130 },
      z: 3,
      text: {
        value: '3',
        font: 'num',
        size: FONT.mega,
        weight: 700,
        lineHeight: 1,
        align: 'center',
        color: '#FFFFFF',
        maxLines: 1,
      },
    });

    boxes.push({
      id: 'big-3-label',
      slot: 'big-3-label',
      kind: 'text',
      box: { x: PAD_X, y: bigY + 230, w: bigW, h: 24 },
      z: 3,
      text: {
        value: '条 · 趋势判断',
        font: 'cn',
        size: FONT.body,
        weight: 400,
        lineHeight: 1.3,
        align: 'center',
        color: theme.colors.accentSoft,
        maxLines: 1,
      },
    });

    // 右：三趋势卡
    const trendX = PAD_X + bigW + 30;
    const trendW = W - trendX - PAD_X;
    const trendH = (bigH - 16) / 3;

    c.trends.forEach((t, i) => {
      const ty = bigY + i * (trendH + 8);

      boxes.push({
        id: `trend-${i + 1}`,
        slot: `trend-${i + 1}`,
        kind: 'card',
        box: { x: trendX, y: ty, w: trendW, h: trendH },
        z: 2,
        fill: theme.colors.surface,
        radius: 4,
        borderColor: theme.colors.border,
      });

      boxes.push({
        id: `trend-${i + 1}-rank`,
        slot: `trend-${i + 1}-rank`,
        kind: 'badge',
        box: { x: trendX + 16, y: ty + 18, w: 36, h: 36 },
        z: 3,
        fill: theme.colors.primary,
        radius: 18,
        text: {
          value: String(t.rank),
          font: 'num',
          size: FONT.h2,
          weight: 700,
          lineHeight: 1.2,
          align: 'center',
          color: '#FFFFFF',
          maxLines: 1,
        },
      });

      boxes.push({
        id: `trend-${i + 1}-title`,
        slot: `trend-${i + 1}-title`,
        kind: 'text',
        box: { x: trendX + 60, y: ty + 18, w: trendW - 76, h: 22 },
        z: 3,
        text: {
          value: t.title,
          font: 'cn',
          size: FONT.h3,
          weight: 700,
          lineHeight: 1.3,
          align: 'left',
          color: theme.colors.ink,
          maxLines: 1,
        },
      });

      const descLines = measureLines(t.description, FONT.caption, trendW - 76, { weight: 400, font: 'cn' });
      boxes.push({
        id: `trend-${i + 1}-desc`,
        slot: `trend-${i + 1}-desc`,
        kind: 'text',
        box: { x: trendX + 60, y: ty + 42, w: trendW - 76, h: descLines * FONT.caption * 1.55 },
        z: 3,
        text: {
          value: t.description,
          font: 'cn',
          size: FONT.caption,
          weight: 400,
          lineHeight: 1.55,
          align: 'left',
          color: theme.colors.inkMuted,
          maxLines: Math.min(descLines, 4),
        },
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

    return { pageNo, totalPages, pageType: 'trends', boxes };
  },
};
