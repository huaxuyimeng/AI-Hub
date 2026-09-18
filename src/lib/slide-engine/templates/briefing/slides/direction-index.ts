/**
 * 方向索引页型（Direction Index）
 * 元素：左侧色带 + 大数字圆 + 右侧条目列表
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';
import { clipToLines } from '../../../layout/measure';
import { FONT } from '../theme';

export const DirectionIndexContentSchema = z.object({
  title: z.string().max(40),
  subtitle: z.string().max(40),
  count: z.number().int().positive(),
  direction: z.enum(['coding', 'embodied']),
  items: z.array(z.object({
    rank: z.number().int().positive(),
    title: z.string().max(50),
    oneLine: z.string().max(60),
    category: z.string().max(20),
    confidence: z.enum(['A', 'B', 'C', 'D']),
  })).min(1).max(6),
});

export type DirectionIndexContent = z.infer<typeof DirectionIndexContentSchema>;

const SLOTS = [
  'color-band',
  'big-circle', 'big-circle-number', 'big-circle-label',
  'item-1', 'item-1-rank', 'item-1-title', 'item-1-meta', 'item-1-category', 'item-1-confidence',
  'item-2', 'item-2-rank', 'item-2-title', 'item-2-meta', 'item-2-category', 'item-2-confidence',
  'item-3', 'item-3-rank', 'item-3-title', 'item-3-meta', 'item-3-category', 'item-3-confidence',
  'item-4', 'item-4-rank', 'item-4-title', 'item-4-meta', 'item-4-category', 'item-4-confidence',
  'item-5', 'item-5-rank', 'item-5-title', 'item-5-meta', 'item-5-category', 'item-5-confidence',
  'item-6', 'item-6-rank', 'item-6-title', 'item-6-meta', 'item-6-category', 'item-6-confidence',
  'page-no',
];

export const directionIndexPageType: PageTypeDefinition = {
  key: 'direction-index',
  title: '方向索引',
  contentSchema: DirectionIndexContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = DirectionIndexContentSchema.parse(content);
    return checkCapacity(
      c.items.map((it, i) => ({ slot: `item-${i + 1}`, chars: it.title.length, lines: 1 })),
      c.items.map((_, i) => ({ slot: `item-${i + 1}`, maxChars: 50, maxLines: 1 })),
    );
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = DirectionIndexContentSchema.parse(content);
    const { theme, pageNo, totalPages } = ctx;
    const boxes: PlacedBox[] = [];
    const W = theme.page.width;
    const H = theme.page.height;

    const isCoding = c.direction === 'coding';
    const primaryCol = isCoding ? theme.colors.primary : theme.colors.secondary;
    const darkCol = isCoding ? theme.colors.primary : theme.colors.secondary;

    // 左侧色带
    boxes.push({
      id: 'color-band',
      slot: 'color-band',
      kind: 'divider',
      box: { x: 0, y: 0, w: 9, h: H },
      z: 1,
      fill: primaryCol,
      decorative: true,
    });

    // 巨型数字圆
    const circleW = 220;
    const circleH = 360;
    const circleX = 50;
    const circleY = 80;

    boxes.push({
      id: 'big-circle',
      slot: 'big-circle',
      kind: 'card',
      box: { x: circleX, y: circleY, w: circleW, h: circleH },
      z: 2,
      fill: primaryCol,
      radius: 16,
    });

    boxes.push({
      id: 'big-circle-number',
      slot: 'big-circle-number',
      kind: 'text',
      box: { x: circleX, y: circleY + 80, w: circleW, h: 120 },
      z: 3,
      text: {
        value: String(c.count),
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
      id: 'big-circle-label',
      slot: 'big-circle-label',
      kind: 'text',
      box: { x: circleX, y: circleY + 220, w: circleW, h: 24 },
      z: 3,
      text: {
        value: `条 · ${isCoding ? '智能编程' : '具身智能'}`,
        font: 'cn',
        size: FONT.body,
        weight: 400,
        lineHeight: 1.3,
        align: 'center',
        color: theme.colors.primarySoft,
        maxLines: 1,
      },
    });

    // 右侧列表
    //
    // 旧写法 `(circleH - 5*8) / Math.min(c.items.length, 6)`：分子按 6 行留间距、分母却是实际条数。
    // 方向只有 1 条新闻时行高被算成 320pt —— 单行拉成整块巨型色块，标题、类别、置信度散在上下两端。
    // 现在：行高限制在 [ROW_MIN, ROW_MAX] 内按条数均分（间距按 n-1 算），
    // 条数少时不再撑高，整块列表在色带内垂直居中。
    const listX = circleX + circleW + 30;
    const listW = W - listX - 36;
    /** 标题可用宽：右侧要给类别标签（≤96pt）与置信度徽标（22pt）让位，标题盒不得越过去 */
    const TITLE_W = listW - 224;
    const ROW_GAP = 8;
    const ROW_MIN = 50;
    const ROW_MAX = 88;
    const shown = Math.min(c.items.length, 6);
    const rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, (circleH - (shown - 1) * ROW_GAP) / shown));
    const listH = shown * rowH + (shown - 1) * ROW_GAP;
    const listTop = circleY + Math.max(0, (circleH - listH) / 2);

    c.items.slice(0, 6).forEach((item, i) => {
      const ry = listTop + i * (rowH + ROW_GAP);

      // 行背景
      boxes.push({
        id: `item-${i + 1}`,
        slot: `item-${i + 1}`,
        kind: 'card',
        box: { x: listX, y: ry, w: listW, h: rowH },
        z: 2,
        fill: i % 2 === 0 ? theme.colors.surface : theme.colors.primarySoft,
        radius: 4,
        borderColor: theme.colors.border,
      });

      // 序号
      boxes.push({
        id: `item-${i + 1}-rank`,
        slot: `item-${i + 1}-rank`,
        kind: 'text',
        box: { x: listX + 10, y: ry + 8, w: 36, h: rowH - 16 },
        z: 3,
        text: {
          value: String(item.rank).padStart(2, '0'),
          font: 'num',
          size: FONT.h3,
          weight: 700,
          lineHeight: 1.2,
          align: 'left',
          color: primaryCol,
          maxLines: 1,
        },
      });

      // 标题（单行盒：50 字上限装不下 1 行，按行截断）
      boxes.push({
        id: `item-${i + 1}-title`,
        slot: `item-${i + 1}-title`,
        kind: 'text',
        box: { x: listX + 52, y: ry + 7, w: TITLE_W, h: 18 },
        z: 3,
        text: {
          value: clipToLines(item.title, FONT.body, TITLE_W, 1, { weight: 700, font: 'cn' }),
          font: 'cn',
          size: FONT.body,
          weight: 700,
          lineHeight: 1.3,
          align: 'left',
          color: theme.colors.ink,
          maxLines: 1,
        },
      });

      // oneLine + category
      boxes.push({
        id: `item-${i + 1}-meta`,
        slot: `item-${i + 1}-meta`,
        kind: 'text',
        box: { x: listX + 52, y: ry + 27, w: listW - 100, h: 16 },
        z: 3,
        text: {
          value: clipToLines(item.oneLine, FONT.micro, listW - 100, 1, { weight: 400, font: 'cn' }),
          font: 'cn',
          size: FONT.micro,
          weight: 400,
          lineHeight: 1.3,
          align: 'left',
          color: theme.colors.inkSubtle,
          maxLines: 1,
        },
      });

      // 类别标签
      // 旧版锚在行底（ry + rowH - 22）：行高被压到 53pt 时会与上面的 oneLine 重叠，
      // 5 条时只差 0.4pt 靠 lint 容差侥幸通过、6 条时必然报 L3。改为固定在标题行右侧。
      if (item.category) {
        boxes.push({
          id: `item-${i + 1}-category`,
          slot: `item-${i + 1}-category`,
          kind: 'badge',
          box: {
            x: listX + listW - 168,
            y: ry + 8,
            w: Math.min(96, Math.max(40, item.category.length * FONT.micro + 16)),
            h: 16,
          },
          z: 3,
          fill: theme.colors.inkSubtle,
          radius: 8,
          text: {
            value: item.category,
            font: 'cn',
            size: FONT.micro,
            weight: 400,
            lineHeight: 1.2,
            align: 'center',
            color: '#FFFFFF',
            maxLines: 1,
          },
        });
      }

      // 置信度
      const confColorMap = { A: theme.colors.primary, B: theme.colors.primary, C: theme.colors.secondary, D: theme.colors.accent };
      boxes.push({
        id: `item-${i + 1}-confidence`,
        slot: `item-${i + 1}-confidence`,
        kind: 'badge',
        box: { x: listX + listW - 32, y: ry + (rowH - 18) / 2, w: 22, h: 18 },
        z: 3,
        fill: confColorMap[item.confidence],
        radius: 3,
        text: {
          value: item.confidence,
          font: 'num',
          size: FONT.caption,
          weight: 700,
          lineHeight: 1.2,
          align: 'center',
          color: '#FFFFFF',
          maxLines: 1,
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

    return { pageNo, totalPages, pageType: 'direction-index', boxes };
  },
};
