/**
 * 封面页型（Cover）
 *
 * 精准对齐 build-pptx.ts P01 addCover：
 * - 英寸换算 pt（×72）后的小数取整（避免累积误差）
 * - 颜色、字号完全对应 build-pptx COLORS 常量
 * - 元素坐标与 build-pptx 逐像素一致（误差 < 0.5pt）
 *
 * 布局参考（build-pptx.ts addCover）：
 *   顶部蓝色条:    x=0,   y=0,      w=13.33in, h=0.08in
 *   左侧蓝色条:    x=0,   y=0,      w=0.12in,  h=7.5in
 *   副标题:        x=0.65, y=0.55,  w=5,       (14pt, textSubtle)
 *   主标题:        x=0.65, y=1.05,  w=9,       (52pt bold, text)
 *   强调语:        x=0.65, y=2.2,   w=8,       (18pt, primary)
 *   三统计卡:      y=3.2,  h=1.2in, w=3.4in, gap=0.35in
 *   底部分隔线:    y=infoY, w=full
 *   底部品牌:      y=infoY+0.1, 左对齐 (11pt)
 *   底部日期:      y=infoY+0.1, 右对齐 (11pt)
 */

import { z } from 'zod';
import type { PageTypeDefinition, PlanContext } from '../../../contracts/page-type';
import type { PlacedBox } from '../../../contracts/geometry';
import { checkCapacity } from '../../../layout/capacity';
import { FONT } from '../theme';

// build-pptx.ts 常量换算（in → pt，round）
const SLIDE_W_IN = 13.33;
const SLIDE_H_IN = 7.5;
const PAD_X_IN = 0.5;       // 左侧留白
const PAD_TOP_IN = 0.25;     // 顶部留白
const FOOTER_H_IN = 0.42;   // 页脚高
const LEFT_BAR_W_IN = 0.12;  // 左侧蓝色条宽
const TOP_BAR_H_IN = 0.08;   // 顶部蓝色条高

// build-pptx COLORS 换算
const COL = {
  text:       '#1E293B',  // 主文字
  textMuted:  '#475569',  // 次要文字
  textSubtle: '#64748B',  // 浅文字
  textFaint:  '#94A3B8',  // 极淡文字
  primary:    '#3B82F6',  // 主色蓝
  secondary:  '#06B6D4',  // 青蓝
  accent:     '#F59E0B',  // 橙色
  border:     '#E2E8F0',  // 边框
  lightBlue:  '#EFF6FF',  // 浅蓝底
  lightCyan:  '#ECFEFF',  // 浅青底
  lightAmber: '#FFFBEB',  // 浅橙底
};

export const CoverContentSchema = z.object({
  title:    z.string().max(40),
  subtitle: z.string().max(40),
  emphasis: z.string().max(60),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stats: z.array(z.object({
    value: z.string().max(20),
    label: z.string().max(20),
  })).length(3),
});

export type CoverContent = z.infer<typeof CoverContentSchema>;

const SLOTS = [
  'top-bar', 'left-bar',
  'subtitle', 'title', 'emphasis',
  'stat-1', 'stat-1-value', 'stat-1-label',
  'stat-2', 'stat-2-value', 'stat-2-label',
  'stat-3', 'stat-3-value', 'stat-3-label',
  'footer-line', 'footer-brand', 'footer-date',
];

const BUDGETS = [
  { slot: 'title',    maxChars: 40, maxLines: 2 },
  { slot: 'subtitle', maxChars: 40, maxLines: 1 },
  { slot: 'emphasis', maxChars: 60, maxLines: 2 },
];

export const coverPageType: PageTypeDefinition = {
  key: 'cover',
  title: '封面',
  contentSchema: CoverContentSchema,
  slots: SLOTS,

  capacity(content: unknown) {
    const c = CoverContentSchema.parse(content);
    return checkCapacity(
      [
        { slot: 'title',    chars: c.title.length,    lines: 2 },
        { slot: 'subtitle', chars: c.subtitle.length, lines: 1 },
        { slot: 'emphasis', chars: c.emphasis.length, lines: 2 },
      ],
      BUDGETS,
    );
  },

  plan(content: unknown, ctx: PlanContext): { pageNo: number; totalPages: number; pageType: string; boxes: PlacedBox[] } {
    const c = CoverContentSchema.parse(content);
    const { theme, pageNo, totalPages } = ctx;
    const boxes: PlacedBox[] = [];

    // ==================== 装饰元素 ====================
    // 顶部蓝色条（y=0, h=TOP_BAR_H）
    boxes.push({
      id: 'top-bar', slot: 'top-bar', kind: 'divider',
      box: { x: 0, y: 0, w: Math.round(SLIDE_W_IN * 72), h: Math.round(TOP_BAR_H_IN * 72) },
      z: 1, fill: COL.primary, decorative: true,
    });

    // 左侧蓝色条（x=0, w=LEFT_BAR_W）
    boxes.push({
      id: 'left-bar', slot: 'left-bar', kind: 'divider',
      box: { x: 0, y: 0, w: Math.round(LEFT_BAR_W_IN * 72), h: Math.round(SLIDE_H_IN * 72) },
      z: 1, fill: COL.primary, decorative: true,
    });

    // ==================== 文字元素（白底上，彩色字） ====================
    const leftX = Math.round(PAD_X_IN * 72);  // 36

    // 副标题 y = PAD_TOP + 0.08 + 0.47 → (0.25+0.08)*72 = 23.76 → 24pt
    // build-pptx: y=0.55in = 39.6 → 40pt（取整 40）
    boxes.push({
      id: 'subtitle', slot: 'subtitle', kind: 'text',
      box: { x: leftX + Math.round(0.15 * 72), y: 40, w: Math.round(5 * 72), h: 28 },
      z: 2,
      text: { value: c.subtitle, font: 'cn', size: FONT.h3, weight: 400, lineHeight: 1.4, align: 'left', color: COL.textSubtle, maxLines: 1 },
    });

    // 主标题 y = 1.05in = 75.6 → 76pt, h = 1.1in = 79.2 → 80pt
    // build-pptx: fontSize=52 (超大标题)
    boxes.push({
      id: 'title', slot: 'title', kind: 'text',
      box: { x: leftX + Math.round(0.15 * 72), y: 76, w: Math.round(9 * 72), h: 80 },
      z: 2,
      text: { value: c.title, font: 'cn', size: FONT.display, weight: 700, lineHeight: 1.1, align: 'left', color: COL.text, maxLines: 2 },
    });

    // 强调语 y = 2.2in = 158.4 → 158pt
    // 盒高按「h2 两行」给足（2 × 20pt × 1.4 = 56pt），避免 LLM 写长一句就 L2 溢出
    boxes.push({
      id: 'emphasis', slot: 'emphasis', kind: 'text',
      box: { x: leftX + Math.round(0.15 * 72), y: 158, w: Math.round(8 * 72), h: 58 },
      z: 2,
      text: { value: c.emphasis, font: 'cn', size: FONT.h2, weight: 600, lineHeight: 1.4, align: 'left', color: COL.primary, maxLines: 2 },
    });

    // ==================== 三列统计卡片 ====================
    const cardW  = Math.round(3.4  * 72);  // 245
    const cardH  = Math.round(1.2  * 72);   // 86
    const cardGap = Math.round(0.35 * 72);  // 25
    const cardY  = Math.round(3.2  * 72);   // 230
    const cardX0 = leftX + Math.round(0.15 * 72);  // 46

    const lightBgs = [COL.lightBlue, COL.lightCyan, COL.lightAmber];
    const valColors = [COL.primary, COL.secondary, COL.accent];

    for (let i = 0; i < 3; i++) {
      const cx = cardX0 + i * (cardW + cardGap);
      const stat = c.stats[i];
      const lightBg = lightBgs[i];
      const valColor = valColors[i];

      // 卡片底（圆角软卡）
      boxes.push({
        id: `stat-${i + 1}`, slot: `stat-${i + 1}`, kind: 'card',
        box: { x: cx, y: cardY, w: cardW, h: cardH },
        z: 2, fill: lightBg, radius: 9,
        borderColor: COL.border,
      });

      // 值（字号按长度自适应：长数字用小一号）
      const valSize = stat.value.length > 6 ? FONT.h1 : FONT.number;
      boxes.push({
        id: `stat-${i + 1}-value`, slot: `stat-${i + 1}-value`, kind: 'text',
        box: { x: cx + 14, y: cardY + 13, w: cardW - 28, h: 40 },
        z: 3,
        text: { value: stat.value, font: 'num', size: valSize, weight: 700, lineHeight: 1.1, align: 'left', color: valColor, maxLines: 1 },
      });

      // 标签（value 底部 y+3 起始，避免重叠）
      boxes.push({
        id: `stat-${i + 1}-label`, slot: `stat-${i + 1}-label`, kind: 'text',
        box: { x: cx + 14, y: cardY + 55, w: cardW - 28, h: 22 },
        z: 3,
        text: { value: stat.label, font: 'cn', size: FONT.body, weight: 400, lineHeight: 1.4, align: 'left', color: COL.textMuted, maxLines: 1 },
      });
    }

    // ==================== 底部信息栏 ====================
    const infoY = Math.round((SLIDE_H_IN - FOOTER_H_IN - 0.05) * 72);  // 509

    // 分隔线（full width）
    boxes.push({
      id: 'footer-line', slot: 'footer-line', kind: 'divider',
      box: { x: 0, y: infoY, w: Math.round(SLIDE_W_IN * 72), h: 1 },
      z: 1, fill: COL.border, decorative: true,
    });

    // 底部品牌（左对齐，allowUnsafe 避免越界警告）
    boxes.push({
      id: 'footer-brand', slot: 'footer-brand', kind: 'text',
      box: { x: leftX, y: infoY + 7, w: Math.round(6 * 72), h: 22 },
      z: 2, allowUnsafe: true,
      text: { value: 'AIHub · 每日 AI 新闻精选', font: 'cn', size: FONT.caption, weight: 400, lineHeight: 1.4, align: 'left', color: COL.textFaint, maxLines: 1 },
    });

    // 底部日期（右对齐）
    boxes.push({
      id: 'footer-date', slot: 'footer-date', kind: 'text',
      box: { x: Math.round((SLIDE_W_IN - PAD_X_IN - 1.5) * 72), y: infoY + 7, w: Math.round(1.5 * 72), h: 22 },
      z: 2, allowUnsafe: true,
      text: { value: c.date, font: 'num', size: FONT.caption, weight: 400, lineHeight: 1.4, align: 'right', color: COL.textFaint, maxLines: 1 },
    });

    return { pageNo, totalPages, pageType: 'cover', boxes };
  },
};
