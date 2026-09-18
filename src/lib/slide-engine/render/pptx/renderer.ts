/**
 * pptxgenjs 哑渲染器
 * 只做一件事：PlacedSlide → pptxgenjs Slide 的翻译
 * 布局决策全部在页型定义里，这里零逻辑
 *
 * 单位约定：内部统一 pt（960×540），渲染器出口转 in（除以 72）
 */

import PptxGenJS from 'pptxgenjs';
import type { ThemeTokens } from '../../contracts/theme';
import type { PlacedSlide, PlacedBox, TextMeta } from '../../contracts/geometry';

// pt → in 换算
const PT_TO_IN = 1 / 72;

function pt2in(pt: number): number {
  return pt * PT_TO_IN;
}

function hex2css(hex: string | undefined): string {
  if (!hex) return '#000000';
  // rgba(r, g, b, a) → #rrggbb（pptxgenjs 不支持 alpha，用基础色）
  const rgbaMatch = hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    const [, r, g, b] = rgbaMatch;
    return `#${[r, g, b].map(c => parseInt(c).toString(16).padStart(2, '0')).join('')}`;
  }
  // #RRGGBBAA → #RRGGBB（8 位 hex 也截断 alpha）
  if (/^#[0-9a-f]{8}$/i.test(hex)) {
    return hex.slice(0, 7);
  }
  return hex;
}

export function renderDeckPptx(
  slides: PlacedSlide[],
  theme: ThemeTokens,
  opts: {
    title?: string;
    author?: string;
    company?: string;
  } = {},
): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  pptx.title = opts.title ?? 'Generated Presentation';
  pptx.author = opts.author ?? 'AIHub';
  pptx.company = opts.company ?? 'AIHub';

  for (const slideModel of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.colors.surface };

    for (const box of slideModel.boxes) {
      renderBox(slide, box, theme);
    }
  }

  return pptx;
}

function renderBox(
  slide: PptxGenJS.Slide,
  box: PlacedBox,
  theme: ThemeTokens,
): void {
  const x = pt2in(box.box.x);
  const y = pt2in(box.box.y);
  const w = pt2in(box.box.w);
  const h = pt2in(box.box.h);

  switch (box.kind) {
    case 'card':
    case 'badge':
      renderShape(slide, box, x, y, w, h, theme);
      // card/badge 允许携带文字（如 header-chip 徽标）。
      // 早期实现只画形状不画文字，导致「4 类信源 · 8 条精选」「⚠ D 存疑」这类
      // 徽标全部渲染成空色块 —— 形状看着没坏，字却整条不见了。
      if (box.text?.value) {
        // 徽标文字默认垂直居中：h 通常只有 30pt，顶部对齐会贴边
        renderText(slide, box, x, y, w, h, theme, 'middle');
      }
      break;
    case 'divider':
      renderDivider(slide, box, x, y, w, h, theme);
      break;
    case 'bar':
      renderBar(slide, box, x, y, w, h, theme);
      break;
    case 'text':
      renderText(slide, box, x, y, w, h, theme);
      break;
    case 'table':
      renderTable(slide, box, x, y, w, h, theme);
      break;
    case 'image':
      // 图片需要外部注入数据，不在这里处理
      break;
    default:
      // 未知类型，尝试当 card 渲染
      renderShape(slide, box, x, y, w, h, theme);
  }
}

function renderShape(
  slide: PptxGenJS.Slide,
  box: PlacedBox,
  x: number, y: number, w: number, h: number,
  _theme: ThemeTokens,
): void {
  const fill = hex2css(box.fill);
  const borderColor = hex2css(box.borderColor);
  const radius = box.radius ?? 0;

  if (radius > 0) {
    slide.addShape('roundRect', {
      x, y, w, h,
      rectRadius: pt2in(radius),
      fill: { color: fill },
      line: borderColor ? { color: borderColor, width: 0.5 } : { type: 'none' },
    });
  } else {
    slide.addShape('rect', {
      x, y, w, h,
      fill: { color: fill },
      line: borderColor ? { color: borderColor, width: 0.5 } : { type: 'none' },
    });
  }
}

function renderDivider(
  slide: PptxGenJS.Slide,
  box: PlacedBox,
  x: number, y: number, w: number, h: number,
  _theme: ThemeTokens,
): void {
  const color = hex2css(box.fill);
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color },
    line: { type: 'none' },
  });
}

function renderBar(
  slide: PptxGenJS.Slide,
  box: PlacedBox,
  x: number, y: number, w: number, h: number,
  _theme: ThemeTokens,
): void {
  const fill = hex2css(box.fill);
  slide.addShape('roundRect', {
    x, y, w, h,
    rectRadius: pt2in(Math.min(h / 2, 4)),
    fill: { color: fill },
    line: { type: 'none' },
  });
}

function renderText(
  slide: PptxGenJS.Slide,
  box: PlacedBox,
  x: number, y: number, w: number, h: number,
  _theme: ThemeTokens,
  valign: 'top' | 'middle' = 'top',
): void {
  const text = box.text;
  if (!text || !text.value) return;

  const font = text.font === 'num' ? _theme.fonts.num : _theme.fonts.cn;
  const size = text.size;
  const weight = text.weight;
  const align = text.align ?? 'left';

  slide.addText(text.value, {
    x, y, w, h,
    fontSize: size,
    fontFace: font,
    bold: weight >= 600,
    color: hex2css(text.color),
    align: align as 'left' | 'center' | 'right',
    valign,
    fit: 'shrink',
    // margin 必须显式置 0。
    // 不传时 pptxgenjs 不写 lIns/rIns/tIns/bIns，PowerPoint 会套用默认内边距
    // （左右各 7.2pt、上下各 3.6pt），而引擎的 lint 与几何模型都是按盒子的
    // **完整宽高、零内边距**算的 —— 两边差 14.4pt / 7.2pt。
    // 实测后果：142 个文本盒里 99 个受影响，其中 A/B/C/D 图例字母的盒子只有 22pt 宽，
    // 扣掉 14.4pt 只剩 7.6pt，单个字符直接折成两行。
    margin: 0,
  });
}

function renderTable(
  slide: PptxGenJS.Slide,
  box: PlacedBox,
  x: number, y: number, w: number, h: number,
  theme: ThemeTokens,
): void {
  const cells = box.cells;
  if (!cells || cells.length === 0) return;

  const tableData = cells.map(row =>
    row.map(cell => ({
      text: cell.value,
      options: {
        fontSize: cell.size,
        fontFace: cell.font === 'num' ? theme.fonts.num : theme.fonts.cn,
        color: hex2css(cell.color),
        align: cell.align ?? 'left',
        // 表格单元格同样要置 0：pptxgenjs 默认给单元格 0.05in 内边距，
        // 会把列宽吃掉，导致表头/内容错位。行高已由管线按盒高算好。
        margin: 0,
      },
    }))
  );

  slide.addTable(tableData, {
    x, y, w, h,
    border: { pt: 0.5, color: theme.colors.border },
    margin: 0,
  });
}

// ============================================================================
// 便捷入口：直接生成 Buffer
// ============================================================================

export async function renderDeckToBuffer(
  slides: PlacedSlide[],
  theme: ThemeTokens,
  opts?: {
    title?: string;
    author?: string;
    company?: string;
  },
): Promise<Buffer> {
  const pptx = renderDeckPptx(slides, theme, opts);
  const blob = await pptx.write({ outputType: 'nodebuffer' });
  return blob as Buffer;
}
