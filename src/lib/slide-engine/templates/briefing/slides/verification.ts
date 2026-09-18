/**
 * 验证表页型（Verification Table）
 * 6 列表格：# / 议题 / 方向 / 独立信源 / 一手链接 / 置信度
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import type { TextMeta } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';
import { FONT } from '../theme';

export const VerificationContentSchema = z.object({
  title: z.string().max(40),
  subtitle: z.string().max(60),
  rows: z.array(z.object({
    rank: z.string().max(4),
    topic: z.string().max(40),
    direction: z.string().max(16),
    sources: z.string().max(10),
    primaryLink: z.string().max(20),
    confidence: z.enum(['A', 'B', 'C', 'D']),
  })).min(5).max(20),
  summary: z.string().max(120),
});

export type VerificationContent = z.infer<typeof VerificationContentSchema>;

const SLOTS = ['header-title', 'header-subtitle', 'table', 'summary', 'page-no'];

const COL_WIDTHS = [40, 280, 110, 80, 140, 60]; // 总和 710
const COL_RATIOS = COL_WIDTHS.map(w => w / COL_WIDTHS.reduce((a, b) => a + b, 0));

export const verificationPageType: PageTypeDefinition = {
  key: 'verification',
  title: '验证表',
  contentSchema: VerificationContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = VerificationContentSchema.parse(content);
    return checkCapacity(
      c.rows.map((_, i) => ({ slot: `table-row-${i}`, chars: 0, lines: 1 })),
      c.rows.map((_, i) => ({ slot: `table-row-${i}`, maxItems: 1 })),
    );
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = VerificationContentSchema.parse(content);
    const { theme, pageNo, totalPages } = ctx;
    const boxes: PlacedBox[] = [];
    const W = theme.page.width;
    const H = theme.page.height;
    const PAD_X = 36;
    const tableX = PAD_X;
    const tableW = W - PAD_X * 2;
    const tableTop = 90;
    const tableBottom = H - 90;
    const tableH = tableBottom - tableTop;
    const rowCount = Math.min(c.rows.length, 14);
    const rowH = (tableH - 30) / rowCount;

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

    // 表头 + 数据行合并为 table
    const confColorMap = { A: theme.colors.primary, B: theme.colors.primary, C: theme.colors.secondary, D: theme.colors.accent };
    const headers = ['#', '议题', '方向', '独立信源', '一手链接', '置信'];
    const headerCells: TextMeta[][] = [headers.map(h => ({
      value: h,
      font: 'cn',
      size: FONT.caption,
      weight: 700,
      lineHeight: 1.3,
      align: 'center',
      color: '#FFFFFF',
      maxLines: 1,
    }))];

    const dataCells: TextMeta[][] = c.rows.slice(0, rowCount).map((row, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : theme.colors.surface;
      return [
        { value: row.rank, font: 'num', size: FONT.caption, weight: 400, lineHeight: 1.3, align: 'center', color: theme.colors.inkMuted, maxLines: 1 },
        { value: row.topic, font: 'cn', size: FONT.caption, weight: 400, lineHeight: 1.3, align: 'left', color: theme.colors.ink, maxLines: 1 },
        { value: row.direction, font: 'cn', size: FONT.caption, weight: 400, lineHeight: 1.3, align: 'left', color: theme.colors.inkMuted, maxLines: 1 },
        { value: row.sources, font: 'cn', size: FONT.caption, weight: 400, lineHeight: 1.3, align: 'center', color: theme.colors.inkMuted, maxLines: 1 },
        { value: row.primaryLink, font: 'cn', size: FONT.caption, weight: 400, lineHeight: 1.3, align: 'center', color: theme.colors.inkMuted, maxLines: 1 },
        { value: row.confidence, font: 'num', size: FONT.caption, weight: 700, lineHeight: 1.3, align: 'center', color: confColorMap[row.confidence], maxLines: 1 },
      ];
    });

    boxes.push({
      id: 'table',
      slot: 'table',
      kind: 'table',
      box: { x: tableX, y: tableTop, w: tableW, h: rowCount * rowH + 26 },
      z: 2,
      borderColor: theme.colors.border,
      cells: [...headerCells, ...dataCells],
    });

    // 汇总
    boxes.push({
      id: 'summary',
      slot: 'summary',
      kind: 'text',
      box: { x: PAD_X, y: tableBottom + 12, w: W - PAD_X * 2, h: 24 },
      z: 2,
      text: {
        value: c.summary,
        font: 'cn',
        size: FONT.caption,
        weight: 400,
        lineHeight: 1.5,
        align: 'left',
        color: theme.colors.inkMuted,
        maxLines: 1,
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

    return { pageNo, totalPages, pageType: 'verification', boxes };
  },
};
