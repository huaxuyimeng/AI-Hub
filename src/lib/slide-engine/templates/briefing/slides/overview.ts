/**
 * 概览页型（Overview）
 * 左侧：TL;DR 列表 + 置信度分布
 * 右侧：评级方法 + 信源家族
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';
import { FONT } from '../theme';

export const OverviewContentSchema = z.object({
  methodNote: z.string().max(60),
  sourcesCount: z.number().int().positive(),
  itemsCount: z.number().int().positive(),
  /** 4 类信源家族的真实名称（与 sourcesCount 对应）。
   *  历史实现只传了数量、把标签硬编码成「信源 1..4」，
   *  导致内容里明明有名称却从不展示——这里补上。
   *  不加 max：名称由上游内容决定，长度风险在渲染侧裁剪兜底。 */
  sourceNames: z.array(z.string()).length(4),
  tlDr: z.array(z.string().max(90)).min(2).max(4),
  confidenceLegend: z.array(z.object({
    level: z.enum(['A', 'B', 'C', 'D']),
    label: z.string(),
    rule: z.string().max(60),
    color: z.enum(['primary', 'secondary', 'accent']),
  })).length(4),
  distribution: z.array(z.object({
    level: z.enum(['A', 'B', 'C', 'D']),
    count: z.number().int().min(0),
  })).length(4),
});

export type OverviewContent = z.infer<typeof OverviewContentSchema>;

const SLOTS = [
  'header-title', 'header-subtitle', 'header-chip',
  'tldr-title',
  'tldr-line-1', 'tldr-line-2', 'tldr-line-3', 'tldr-line-4',
  'distribution-title',
  'distribution-row-1', 'distribution-row-2', 'distribution-row-3', 'distribution-row-4',
  'legend-title',
  'legend-row-1', 'legend-row-2', 'legend-row-3', 'legend-row-4',
  'sources-title',
  'source-1', 'source-2', 'source-3', 'source-4',
  'page-no',
];

export const overviewPageType: PageTypeDefinition = {
  key: 'overview',
  title: '概览',
  contentSchema: OverviewContentSchema,
  slots: SLOTS,

  capacity(content) {
    const c = OverviewContentSchema.parse(content);
    return checkCapacity(
      c.tlDr.map((line, i) => ({ slot: `tldr-line-${i + 1}`, chars: line.length, lines: 1 })),
      c.tlDr.map((_, i) => ({ slot: `tldr-line-${i + 1}`, maxChars: 90, maxLines: 1 })),
    );
  },

  plan(content: unknown, ctx: PlanContext) {
    const c = OverviewContentSchema.parse(content);
    const { theme, pageNo, totalPages, measureLines } = ctx;
    const boxes: PlacedBox[] = [];
    const W = theme.page.width;
    const H = theme.page.height;
    const PAD_X = 36;

    // ===== 顶部 Header 区 =====
    boxes.push({
      id: 'header-title',
      slot: 'header-title',
      kind: 'text',
      box: { x: PAD_X, y: 18, w: 600, h: 32 },
      z: 2,
      text: {
        value: '本期概览与置信度评级方法',
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
        value: c.methodNote,
        font: 'cn',
        size: theme.type.caption.size,
        weight: theme.type.caption.weight,
        lineHeight: theme.type.caption.lineHeight,
        align: 'left',
        color: theme.colors.inkSubtle,
        maxLines: 1,
      },
    });

    // 右上 chip
    boxes.push({
      id: 'header-chip',
      slot: 'header-chip',
      kind: 'badge',
      box: { x: W - 240, y: 22, w: 204, h: 30 },
      z: 2,
      fill: theme.colors.primarySoft,
      radius: 15,
      text: {
        value: `${c.sourcesCount} 类信源 · ${c.itemsCount} 条精选`,
        font: 'cn',
        size: FONT.caption,
        weight: 600,
        lineHeight: 1.2,
        align: 'center',
        color: theme.colors.primary,
        maxLines: 1,
      },
    });

    // ===== 左侧：TL;DR + 置信度分布 =====
    const leftW = 540;
    const leftX = PAD_X;
    let curY = 100;

    boxes.push({
      id: 'tldr-title',
      slot: 'tldr-title',
      kind: 'text',
      box: { x: leftX, y: curY, w: 200, h: 24 },
      z: 2,
      text: {
        value: 'TL;DR',
        font: 'cn',
        size: FONT.body,
        weight: 700,
        lineHeight: 1.3,
        align: 'left',
        color: theme.colors.ink,
        maxLines: 1,
      },
    });
    curY += 30;

    // TL;DR 列表（最多 4 条）
    //
    // 字号自适应：默认用正文档（FONT.body，对齐参考稿「正文」层）；
    // 4 条按正文档排完若超出 TL;DR 区预算，说明这一期要点写得太长，
    // 整体降一档到 FONT.caption —— 宁可小一号，也不能把下方的置信度分布挤出页面。
    const TLDR_W = leftW - 30;
    const TLDR_BUDGET = 230; // pt：TL;DR 区可用高度（下方分布图块固定占 158pt）
    const tldrItems = c.tlDr.slice(0, 4);
    const tldrHeightAt = (size: number): number =>
      tldrItems.reduce((sum, line) => {
        const n = measureLines(line, size, TLDR_W, { weight: 400, font: 'cn' });
        return sum + Math.max(22, n * size * 1.55) + 4;
      }, 0);
    const TLDR_SIZE = tldrHeightAt(FONT.body) <= TLDR_BUDGET ? FONT.body : FONT.caption;

    tldrItems.forEach((line, i) => {
      const tldrLines = measureLines(line, TLDR_SIZE, TLDR_W, { weight: 400, font: 'cn' });
      const rowH = Math.max(22, tldrLines * TLDR_SIZE * 1.55);

      boxes.push({
        id: `tldr-line-${i + 1}`,
        slot: `tldr-line-${i + 1}`,
        kind: 'text',
        box: { x: leftX + 24, y: curY, w: leftW - 24, h: rowH },
        z: 2,
        text: {
          value: line,
          font: 'cn',
          size: TLDR_SIZE,
          weight: 400,
          lineHeight: 1.55,
          align: 'left',
          color: theme.colors.inkMuted,
          maxLines: tldrLines,
        },
      });
      curY += rowH + 4;
    });

    // 置信度分布
    curY += 14;
    boxes.push({
      id: 'distribution-title',
      slot: 'distribution-title',
      kind: 'text',
      box: { x: leftX, y: curY, w: 200, h: 22 },
      z: 2,
      text: {
        value: '置信度分布',
        font: 'cn',
        size: FONT.body,
        weight: 700,
        lineHeight: 1.3,
        align: 'left',
        color: theme.colors.ink,
        maxLines: 1,
      },
    });
    curY += 26;

    const maxCount = Math.max(...c.distribution.map(d => d.count), 1);
    const barH = 20;
    const barGap = 4;
    c.distribution.forEach((d, i) => {
      const barW = Math.max(2, (d.count / maxCount) * (leftW - 60));
      const colorMap = { A: theme.colors.primary, B: theme.colors.primary, C: theme.colors.secondary, D: theme.colors.accent };
      const color = colorMap[d.level];

      boxes.push({
        id: `distribution-row-${i + 1}`,
        slot: `distribution-row-${i + 1}`,
        kind: 'bar',
        box: { x: leftX + 50, y: curY, w: barW, h: barH },
        z: 2,
        fill: color,
      });
      curY += barH + barGap;
    });

    // ===== 右侧：评级方法 + 信源家族 =====
    const rightX = leftX + leftW + 24;
    const rightW = W - rightX - PAD_X;
    let ry = 100;

    boxes.push({
      id: 'legend-title',
      slot: 'legend-title',
      kind: 'text',
      box: { x: rightX, y: ry, w: rightW, h: 24 },
      z: 2,
      text: {
        value: '评级方法',
        font: 'cn',
        size: FONT.body,
        weight: 700,
        lineHeight: 1.3,
        align: 'left',
        color: theme.colors.ink,
        maxLines: 1,
      },
    });
    ry += 30;

    c.confidenceLegend.forEach((legend, i) => {
      const colorMap = { primary: theme.colors.primary, secondary: theme.colors.secondary, accent: theme.colors.accent };
      const color = colorMap[legend.color];

      // 等级色块
      boxes.push({
        id: `legend-row-${i + 1}`,
        slot: `legend-row-${i + 1}`,
        kind: 'badge',
        box: { x: rightX, y: ry, w: 22, h: 22 },
        z: 2,
        fill: color,
        radius: 3,
        text: {
          value: legend.level,
          font: 'num',
          size: FONT.caption,
          weight: 700,
          lineHeight: 1.2,
          align: 'center',
          color: '#FFFFFF',
          maxLines: 1,
        },
      });

      // 规则说明
      boxes.push({
        id: `legend-row-${i + 1}-text`,
        slot: `legend-row-${i + 1}`,
        kind: 'text',
        box: { x: rightX + 28, y: ry, w: rightW - 28, h: 22 },
        z: 2,
        text: {
          value: `${legend.label}：${legend.rule}`,
          font: 'cn',
          size: FONT.caption,
          weight: 400,
          lineHeight: 1.3,
          align: 'left',
          color: theme.colors.inkMuted,
          maxLines: 1,
        },
      });
      ry += 28;
    });

    // 信源家族
    ry += 8;
    boxes.push({
      id: 'sources-title',
      slot: 'sources-title',
      kind: 'text',
      box: { x: rightX, y: ry, w: rightW, h: 22 },
      z: 2,
      text: {
        value: '信源家族（4 类）',
        font: 'cn',
        size: FONT.body,
        weight: 700,
        lineHeight: 1.3,
        align: 'left',
        color: theme.colors.ink,
        maxLines: 1,
      },
    });
    ry += 26;

    // 4 信源卡（紧凑）
    // 名称裁剪到 14 字：条宽约 204pt、字号 10pt（全角≈10pt/字），14 字≈140pt 有充足余量。
    // 兜底裁剪而非依赖 lint —— 名称来自上游内容，不能让一个长名字把整本 deck 打挂。
    const NAME_MAX = 14;
    for (let i = 0; i < 4; i++) {
      const rawName = c.sourceNames[i] ?? `信源 ${i + 1}`;
      const label = rawName.length > NAME_MAX ? `${rawName.slice(0, NAME_MAX - 1)}…` : rawName;
      boxes.push({
        id: `source-${i + 1}`,
        slot: `source-${i + 1}`,
        kind: 'badge',
        box: { x: rightX, y: ry, w: rightW, h: 28 },
        z: 2,
        fill: i % 2 === 0 ? theme.colors.primary : i === 1 ? theme.colors.secondary : theme.colors.accent,
        radius: 4,
        text: {
          value: label,
          font: 'cn',
          size: FONT.caption,
          weight: 600,
          lineHeight: 1.2,
          align: 'center',
          color: '#FFFFFF',
          maxLines: 1,
        },
      });
      ry += 32;
    }

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

    return { pageNo, totalPages, pageType: 'overview', boxes };
  },
};
