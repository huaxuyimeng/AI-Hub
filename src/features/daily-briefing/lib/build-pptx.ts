/**
 * AI 早报 — .pptx 构建（pptxgenjs）v4
 * 路径：src/features/daily-briefing/lib/build-pptx.ts
 *
 * 视觉规格（参考 D:\1Money\AI新闻\AI日报_2026-08-29）：
 * - 画布：13.33 × 7.5 in（16:9），全篇白底（#FFFFFF）
 * - 颜色系统：4 主色（slate-900 / blue-500 / cyan-500 / amber-500）+ 3 同族浅底 + 中性色
 * - 字体：中文 Microsoft YaHei；数字 Inter
 * - 动态页数：由 content 决定实际渲染哪些页，页码自动重编号
 *
 * 章节规划（动态页数，由 content 决定实际渲染哪些页）：
 *   第一幕：封面 + 概览（P1 / P2）
 *   第二幕：coding 方向索引+详情 + embodied 方向索引+详情（P3-P6 或更少）
 *   第三幕：rumor（可选） + authors + 验证表 + 趋势 + 结尾
 *
 * R-1 修复（2026-09-02）：plan-based dispatch，页码自动重编号，footer 分母取实际页数
 */

import PptxGenJS from 'pptxgenjs';
import type {
  DailyReportContent,
  Item,
  DirectionIndex,
  HeroMetric,
  PrimaryLink,
  VideoAuthor,
  VerificationRow,
  Trend,
  ConfidenceLevel,
  PageRole,
} from './types';
import { CONFIDENCE_META, DIRECTION_META, truncate } from './types';

// ========================================================================
// 全局常量
// ========================================================================

const FONT_CN = 'Microsoft YaHei';
const FONT_NUM = 'Inter';

const COLORS = {
  text: '1E293B',
  textMuted: '475569',
  textSubtle: '64748B',
  textFaint: '94A3B8',
  primary: '3B82F6',
  primaryDark: '2563EB',
  secondary: '06B6D4',
  secondaryDark: '0891B2',
  accent: 'F59E0B',
  accentDark: 'D97706',
  accentText: '92400E',
  border: 'E2E8F0',
  borderLight: 'EEF2F7',
  bgCard: 'F8FAFC',
  lightBlue: 'EFF6FF',
  lightCyan: 'ECFEFF',
  lightAmber: 'FFFBEB',
  linkBlue: '1D4ED8',
};

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const PAD_X = 0.5;
const PAD_TOP = 0.25;

/** A 区标题块高度 */
const HEADER_H = 0.92;
/** C 区页脚高度 */
const FOOTER_H = 0.42;

// ========================================================================
// 工具函数
// ========================================================================

/** 估算字符串视觉宽度（CJK ≈ 2，ASCII ≈ 1） */
function estimateVisualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF\u3040-\u309F\u30A0-\u30FF]/.test(ch)) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** 短截断（保留末尾省略号） */
function truncateShort(s: string, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** 取首字母大写（用于 source 图标） */
function iconLetter(name: string): string {
  const n = name.trim();
  if (!n) return '?';
  return /[A-Za-z]/.test(n[0]) ? n[0].toUpperCase() : (n[1] ?? '?').toUpperCase();
}

// ========================================================================
// Slide tracking（R-1：闭包式全局状态，供 addHeader/addFooter 反向引用）
// ========================================================================

const slideByPage = new Map<number, PptxGenJS.Slide>();

/**
 * R-1 修复：实际总页数（由 plan.length 计算得出）。
 * addFooter 从闭包读取此值，因此无需在每个调用处再传 totalPages。
 */
let _totalPages = 0;
/** 全局 content 引用，供 addFooter 读取 draft 标记 */
let _contentRef: DailyReportContent | null = null;

function trackSlide(slide: PptxGenJS.Slide, pageNo: number): PptxGenJS.Slide {
  slideByPage.set(pageNo, slide);
  return slide;
}

function getSlide(pageNo: number): PptxGenJS.Slide | undefined {
  return slideByPage.get(pageNo);
}

// ========================================================================
// 图片预下载（R-3：避免 pptxgenjs addImage 同步阻塞 CDN 抖动时整个 PPT 生成卡死）
// ========================================================================

/** 预下载图片到临时 Buffer，带 5s 超时。失败返回 null（静默降级，不阻断 PPT 生成）。 */
async function downloadImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) return null;
    // pptxgenjs addImage 的 data 需要 base64 header（'image/png;base64,…'），
    // 内容嗅探（CDN 的 Content-Type 不可靠）
    let mime = 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
    else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif';
    else if (buf[0] === 0x42 && buf[1] === 0x4d) mime = 'image/bmp';
    else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) return null; // webp：pptx 不支持
    return `${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

// ========================================================================
// 布局辅助
// ========================================================================

/** A 区标题 + 副标题 + 可选 chip */
function addHeader(
  pageNo: number,
  title: string,
  subtitle: string,
  chip: { text: string; bg: string; fg: string } | null,
) {
  const slide = getSlide(pageNo);
  if (!slide) return;

  slide.addText(title, {
    x: PAD_X, y: PAD_TOP + 0.08, w: 9.0, h: 0.5,
    fontSize: 26, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle', fit: 'shrink',
  });
  slide.addText(subtitle, {
    x: PAD_X, y: PAD_TOP + 0.58, w: 9.0, h: 0.3,
    fontSize: 12, fontFace: FONT_CN, color: COLORS.textSubtle,
    align: 'left', valign: 'top', fit: 'shrink',
  });

  if (chip) {
    const chipW = Math.max(1.2, estimateVisualWidth(chip.text) * 0.13 + 0.4);
    slide.addShape('roundRect', {
      x: SLIDE_W - PAD_X - chipW, y: PAD_TOP + 0.16, w: chipW, h: 0.44, rectRadius: 0.22,
      fill: { color: chip.bg }, line: { type: 'none' },
    });
    slide.addText(chip.text, {
      x: SLIDE_W - PAD_X - chipW, y: PAD_TOP + 0.16, w: chipW, h: 0.44,
      fontSize: 12, fontFace: FONT_CN, bold: true, color: chip.fg,
      align: 'center', valign: 'middle',
    });
  }
}

/** C 区页脚 — R-1 修复：totalPages 从闭包 _totalPages 读取，不再硬编码 14 */
function isDraftContent(content: DailyReportContent): boolean {
  // 检测是否为机器草稿：subtitle 含"草稿"关键词
  return content.cover.subtitle.includes('草稿') || content.cover.emphasis.includes('Draft');
}

function addFooter(pageNo: number, leftText = 'AI 日报') {
  const slide = getSlide(pageNo);
  if (!slide) return;
  const total = _totalPages;
  const draft = _contentRef ? isDraftContent(_contentRef) : false;

  const footerText = draft ? `[机器草稿] ${leftText}` : leftText;
  const footerColor = draft ? COLORS.accent : COLORS.textFaint;

  slide.addText(footerText, {
    x: PAD_X, y: SLIDE_H - FOOTER_H + 0.08, w: 8, h: 0.28,
    fontSize: 10, fontFace: FONT_CN, color: footerColor,
    align: 'left', valign: 'middle',
  });
  slide.addText(`${String(pageNo).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, {
    x: SLIDE_W - PAD_X - 1.5, y: SLIDE_H - FOOTER_H + 0.08, w: 1.5, h: 0.28,
    fontSize: 10, fontFace: FONT_CN, color: footerColor,
    align: 'right', valign: 'middle',
  });
}

/** 软阴影卡片背景 */
function addSoftCard(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  bg = COLORS.bgCard, borderColor = COLORS.borderLight,
) {
  slide.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.12,
    fill: { color: bg },
    line: { color: borderColor, width: 0.5 },
    shadow: { type: 'outer', blur: 3, offset: 1, angle: 45, color: '00000015' },
  });
}

/** Tag 小药丸 */
// R-3：封面图预下载缓存（5s 超时，避免 CDN 抖动时阻塞整个 PPT 生成）
const _imageCache = new Map<string, string>();

/** R-3：预下载所有封面图（在 plan.forEach 之前完成，最大并发 5 个） */
async function preloadCoverImages(items: Item[]): Promise<void> {
  const urls = [...new Set(items.map((i) => i.coverUrl).filter((u): u is string => !!u))];
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += 5) chunks.push(urls.slice(i, i + 5));
  for (const batch of chunks) {
    await Promise.all(batch.map(async (url) => {
      const data = await downloadImage(url);
      if (data) _imageCache.set(url, data);
    }));
  }
}

function addTagPill(slide: PptxGenJS.Slide, text: string, x: number, y: number, color: string) {
  const fw = estimateVisualWidth(text);
  const pillW = Math.max(0.5, fw * 0.14 + 0.35);
  const pillH = 0.3;
  slide.addShape('roundRect', {
    x, y, w: pillW, h: pillH, rectRadius: 0.15,
    fill: { color }, line: { type: 'none' },
  });
  slide.addText(text, {
    x, y, w: pillW, h: pillH,
    fontSize: 10, fontFace: FONT_CN, color: 'FFFFFF',
    align: 'center', valign: 'middle',
  });
}

/** 取置信度颜色 */
function confColor(level: ConfidenceLevel): string {
  return CONFIDENCE_META[level]?.color ?? COLORS.primary;
}

function confLightBg(level: ConfidenceLevel): string {
  return CONFIDENCE_META[level]?.lightBg ?? COLORS.lightBlue;
}

// ========================================================================
// 主入口
// ========================================================================

/** @deprecated use buildPptx */
export const buildBriefingPptx = buildPptx;

/** 旧版文件名生成（保留） */
export function briefingFileName(date: string, draft = false): string {
  const suffix = draft ? '-草稿' : '';
  return `AIHub-AI早报${suffix}-${date}.pptx`;
}

export async function buildPptx(content: DailyReportContent): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5
  pptx.title = `AI 日报 ${content.date}`;
  pptx.author = 'AIHub';
  pptx.company = 'AIHub';

  // R-1 修复：plan-based dispatch —— 先根据 content 决定"哪些页实际会被渲染"，
  // plan.length 即为真实总页数；在 plan.forEach 之前赋值 _totalPages，
  // 所有 addFooter 调用从闭包读到的是实际页数（避免缺页时 footer 仍写 "/ 14"）。
  const plan: Array<(pageNo: number) => void> = [];

  plan.push((pn) => addCover(pptx, content, pn));
  plan.push((pn) => addConfidenceScale(pptx, content, pn)); // Batch 4：P03 置信度评级页
  plan.push((pn) => addOverview(pptx, content, pn));

  const coding = content.directions.find((d) => d.key === 'coding');
  const embodied = content.directions.find((d) => d.key === 'embodied');

  if (coding) {
    const heroRank = coding.summaryItems[0]?.rank;
    plan.push((pn) => addIndex(pptx, content, coding, pn));
    plan.push((pn) => addDirectionHero(pptx, content, coding, pn));
    const codingItems = content.items.filter((i) => i.direction === 'coding' && i.rank !== heroRank);
    if (codingItems.length > 0) {
      plan.push((pn) => addTwoColCards(pptx, content, codingItems.slice(0, 2), pn));
      if (codingItems.length > 2) {
        plan.push((pn) => addTwoColCards(pptx, content, codingItems.slice(2, 4), pn));
      }
    }
  }

  if (embodied) {
    const heroRank = embodied.summaryItems[0]?.rank;
    plan.push((pn) => addIndex(pptx, content, embodied, pn));
    plan.push((pn) => addDirectionHero(pptx, content, embodied, pn));
    const embodiedItems = content.items.filter((i) => i.direction === 'embodied' && i.rank !== heroRank);
    if (embodiedItems.length > 0) {
      plan.push((pn) => addThreeColCards(pptx, content, embodiedItems.slice(0, 3), pn));
    }
  }

  const rumorItems = content.items.filter((i) => i.direction === 'rumor');
  if (rumorItems.length > 0) {
    plan.push((pn) => addRumor(pptx, content, rumorItems[0], pn));
  }

  plan.push((pn) => addAuthors(pptx, content, pn));
  plan.push((pn) => addVerificationTable(pptx, content, pn));
  plan.push((pn) => addTrends(pptx, content, pn));
  plan.push((pn) => addEnding(pptx, content, pn));
  plan.push((pn) => addDisclaimer(pptx, content, pn)); // Batch 5：P15 免责声明

  // R-3：预下载所有封面图（5s 超时），在渲染前完成，不阻塞页面生成
  _imageCache.clear();
  await preloadCoverImages(content.items);

  // R-1 核心：先确定真实总页数，再渲染
  _totalPages = plan.length;
  _contentRef = content; // Batch 3：供 addFooter 检测草稿模式
  if (_totalPages === 0) {
    throw new Error('buildPptx: empty plan, expected at least 1 page');
  }
  plan.forEach((render, i) => render(i + 1));

  const blob = await pptx.write({ outputType: 'nodebuffer' });
  return blob as Buffer;
}

// ========================================================================
// P01 封面
// ========================================================================

function addCover(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  // 顶部蓝色渐变条
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W, h: 0.08,
    fill: { color: COLORS.primary }, line: { type: 'none' },
  });

  // 机器草稿角标（右上角，橙色）
  if (isDraftContent(content)) {
    const badgeW = 1.4;
    const badgeH = 0.38;
    const badgeX = SLIDE_W - PAD_X - badgeW;
    const badgeY = 0.2;
    slide.addShape('roundRect', {
      x: badgeX, y: badgeY, w: badgeW, h: badgeH,
      fill: { color: COLORS.accent }, line: { type: 'none' },
    });
    slide.addText('机器草稿 · 待核验', {
      x: badgeX, y: badgeY, w: badgeW, h: badgeH,
      fontSize: 10, fontFace: FONT_CN, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
  }

  // 左侧蓝色垂直条
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.12, h: SLIDE_H,
    fill: { color: COLORS.primary }, line: { type: 'none' },
  });

  // 日期标签
  slide.addText(content.cover.subtitle, {
    x: PAD_X + 0.15, y: 0.55, w: 5, h: 0.4,
    fontSize: 14, fontFace: FONT_CN, color: COLORS.textSubtle,
    align: 'left', valign: 'middle',
  });

  // 主标题
  slide.addText(content.cover.title, {
    x: PAD_X + 0.15, y: 1.05, w: 9, h: 1.1,
    fontSize: 52, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle',
  });

  // 强调语
  slide.addText(content.cover.emphasis, {
    x: PAD_X + 0.15, y: 2.2, w: 8, h: 0.45,
    fontSize: 18, fontFace: FONT_CN, color: COLORS.primary,
    align: 'left', valign: 'middle',
  });

  // 三列统计卡片
  const cardY = 3.2;
  const cardH = 1.2;
  const cardW = 3.4;
  const cardGap = 0.35;
  const startX = PAD_X + 0.15;

  content.cover.stats.forEach((stat, i) => {
    const cx = startX + i * (cardW + cardGap);
    addSoftCard(slide, cx, cardY, cardW, cardH, COLORS.lightBlue, COLORS.border);
    slide.addText(stat.value, {
      x: cx + 0.2, y: cardY + 0.18, w: cardW - 0.4, h: 0.55,
      fontSize: 32, fontFace: FONT_NUM, bold: true, color: COLORS.primary,
      align: 'left', valign: 'middle',
    });
    slide.addText(stat.label, {
      x: cx + 0.2, y: cardY + 0.72, w: cardW - 0.4, h: 0.32,
      fontSize: 12, fontFace: FONT_CN, color: COLORS.textMuted,
      align: 'left', valign: 'middle',
    });
  });

  // 底部信息栏
  const infoY = SLIDE_H - FOOTER_H - 0.05;
  slide.addShape('rect', {
    x: 0, y: infoY, w: SLIDE_W, h: 0.01,
    fill: { color: COLORS.border }, line: { type: 'none' },
  });
  slide.addText('AIHub · 每日 AI 新闻精选', {
    x: PAD_X, y: infoY + 0.1, w: 6, h: 0.3,
    fontSize: 11, fontFace: FONT_CN, color: COLORS.textFaint,
    align: 'left', valign: 'middle',
  });
  slide.addText(content.date, {
    x: SLIDE_W - PAD_X - 1.5, y: infoY + 0.1, w: 1.5, h: 0.3,
    fontSize: 11, fontFace: FONT_NUM, color: COLORS.textFaint,
    align: 'right', valign: 'middle',
  });
}

// ========================================================================
// P03 置信度评级表（Batch 4）
//   - 4 张卡片横排（A/B/C/D）
//   - 每张卡：A/B/C/D 大字 + label + rule + distribution 迷你柱状条
//   - 数据源：overview.confidenceLegend[4] + overview.distribution[4]
// ========================================================================

function addConfidenceScale(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  // 计算总 picks（来自 distribution）
  const totalPicks = content.overview.distribution.reduce((sum, d) => sum + d.count, 0);

  addHeader(
    pageNo,
    '置信度评级一览',
    '用 A/B/C/D 标注每条要闻的可信度，方便快速判断是否需要再核验',
    {
      text: `${totalPicks} 条要闻 · 评级覆盖度 100%`,
      bg: COLORS.lightBlue,
      fg: COLORS.primary,
    },
  );

  const headerBottom = PAD_TOP + HEADER_H + 0.35;

  // 4 张卡片横排
  const cardY = headerBottom;
  const cardH = 4.6;
  const totalCardsW = SLIDE_W - 2 * PAD_X;
  const cardGap = 0.18;
  const cardW = (totalCardsW - 3 * cardGap) / 4;

  content.overview.confidenceLegend.forEach((legend, i) => {
    const cx = PAD_X + i * (cardW + cardGap);
    const dist = content.overview.distribution[i];
    const lv = legend.level;
    const count = dist?.count ?? 0;

    // 卡片颜色：按 confColor() 取，但 D 用 accentDark 区分
    const baseColor = lv === 'A' ? COLORS.primary
      : lv === 'B' ? COLORS.secondary
      : lv === 'C' ? COLORS.accent
      : COLORS.accentDark;
    const lightBg = lv === 'A' ? COLORS.lightBlue
      : lv === 'B' ? COLORS.lightCyan
      : lv === 'C' ? COLORS.lightAmber
      : COLORS.lightAmber;

    // 卡片背景
    addSoftCard(slide, cx, cardY, cardW, cardH, lightBg, COLORS.border);

    // 顶部大字 A/B/C/D
    slide.addText(lv, {
      x: cx, y: cardY + 0.18, w: cardW, h: 1.0,
      fontSize: 64, fontFace: FONT_NUM, bold: true, color: baseColor,
      align: 'center', valign: 'middle',
    });

    // label（"极高/高/中/存疑"）
    slide.addText(legend.label, {
      x: cx, y: cardY + 1.25, w: cardW, h: 0.32,
      fontSize: 14, fontFace: FONT_CN, bold: true, color: COLORS.text,
      align: 'center', valign: 'middle',
    });

    // 分割线
    slide.addShape('line', {
      x: cx + cardW * 0.2, y: cardY + 1.7, w: cardW * 0.6, h: 0,
      line: { color: COLORS.border, width: 0.5 },
    });

    // 评级规则（rule）
    slide.addText(legend.rule, {
      x: cx + 0.15, y: cardY + 1.85, w: cardW - 0.3, h: 1.6,
      fontSize: 10, fontFace: FONT_CN, color: COLORS.textMuted,
      align: 'left', valign: 'top',
      lineSpacingMultiple: 1.2,
    });

    // 底部：迷你分布条 + 数量
    const miniBarTop = cardY + cardH - 0.85;
    const miniBarH = 0.18;
    const miniBarMaxW = cardW - 0.4;
    const countFraction = totalPicks > 0 ? count / totalPicks : 0;
    const miniBarW = Math.max(0.05, countFraction * miniBarMaxW);

    slide.addText('本期数量', {
      x: cx + 0.2, y: miniBarTop - 0.3, w: cardW - 0.4, h: 0.22,
      fontSize: 9, fontFace: FONT_CN, color: COLORS.textSubtle,
      align: 'left', valign: 'middle',
    });

    // 底槽
    slide.addShape('roundRect', {
      x: cx + 0.2, y: miniBarTop, w: miniBarMaxW, h: miniBarH, rectRadius: 0.04,
      fill: { color: COLORS.bgCard }, line: { color: COLORS.border, width: 0.3 },
    });
    // 实际值
    slide.addShape('roundRect', {
      x: cx + 0.2, y: miniBarTop, w: miniBarW, h: miniBarH, rectRadius: 0.04,
      fill: { color: baseColor }, line: { type: 'none' },
    });

    // 数量数字
    slide.addText(`${count} 条`, {
      x: cx + 0.2, y: miniBarTop + miniBarH + 0.04, w: cardW - 0.4, h: 0.25,
      fontSize: 11, fontFace: FONT_NUM, bold: true, color: baseColor,
      align: 'right', valign: 'middle',
    });
  });

  addFooter(pageNo);
}

// ========================================================================
// P02 概览 + 置信度方法
// ========================================================================

function addOverview(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);
  addHeader(pageNo, '本期概览与置信度评级方法', content.overview.methodNote, {
    text: `${content.overview.sources.length} 类信源 · ${content.items.length} 条精选`,
    bg: COLORS.lightBlue, fg: COLORS.primary,
  });

  const top = PAD_TOP + HEADER_H + 0.15;
  const colGap = 0.18;
  const leftW = 7.6;

  // --- 左侧：TL;DR + 置信度分布 ---

  slide.addText('TL;DR', {
    x: PAD_X, y: top, w: 2, h: 0.35,
    fontSize: 13, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle',
  });

  content.overview.tlDr.forEach((line, i) => {
    const ly = top + 0.38 + i * 0.42;
    slide.addText(`${i + 1}.`, {
      x: PAD_X, y: ly, w: 0.35, h: 0.36,
      fontSize: 12, fontFace: FONT_NUM, bold: true, color: COLORS.primary,
      align: 'left', valign: 'top',
    });
    slide.addText(truncateShort(line, 90), {
      x: PAD_X + 0.35, y: ly, w: leftW - 0.35, h: 0.36,
      fontSize: 12, fontFace: FONT_CN, color: COLORS.textMuted,
      align: 'left', valign: 'top',
    });
  });

  const tlEndY = top + 0.38 + content.overview.tlDr.length * 0.42;

  // 置信度分布
  const distY = tlEndY + 0.3;
  slide.addText('置信度分布', {
    x: PAD_X, y: distY, w: 2, h: 0.32,
    fontSize: 12, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle',
  });

  const dist = content.overview.distribution;
  const maxCount = Math.max(...dist.map((d) => d.count), 1);
  const barH = 0.28;
  const barGap = 0.06;

  dist.forEach((d, i) => {
    const dy = distY + 0.35 + i * (barH + barGap);
    const barW = (d.count / maxCount) * (leftW - 1.2);
    const col = confColor(d.level as ConfidenceLevel);
    slide.addShape('roundRect', {
      x: PAD_X + 0.5, y: dy, w: barW, h: barH, rectRadius: 0.06,
      fill: { color: col }, line: { type: 'none' },
    });
    slide.addText(`${d.level} 级`, {
      x: PAD_X, y: dy, w: 0.48, h: barH,
      fontSize: 11, fontFace: FONT_CN, color: COLORS.textSubtle,
      align: 'left', valign: 'middle',
    });
    if (d.count > 0) {
      slide.addText(String(d.count), {
        x: PAD_X + 0.55 + barW, y: dy, w: 0.5, h: barH,
        fontSize: 10, fontFace: FONT_NUM, color: col, bold: true,
        align: 'left', valign: 'middle',
      });
    }
  });

  // --- 右侧：置信度评级说明 + 信源家族 ---
  const rightX = PAD_X + leftW + colGap;
  const rightW = SLIDE_W - rightX - PAD_X;

  slide.addText('评级方法', {
    x: rightX, y: top, w: rightW, h: 0.32,
    fontSize: 12, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle',
  });

  content.overview.confidenceLegend.forEach((c, i) => {
    const cy = top + 0.35 + i * 0.58;
    const col = confColor(c.level as ConfidenceLevel);
    slide.addShape('roundRect', {
      x: rightX, y: cy, w: 0.32, h: 0.32, rectRadius: 0.06,
      fill: { color: col }, line: { type: 'none' },
    });
    slide.addText(c.level, {
      x: rightX, y: cy, w: 0.32, h: 0.32,
      fontSize: 12, fontFace: FONT_NUM, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
    slide.addText(c.label, {
      x: rightX + 0.4, y: cy, w: rightW - 0.4, h: 0.2,
      fontSize: 11, fontFace: FONT_CN, bold: true, color: COLORS.text,
      align: 'left', valign: 'middle',
    });
    slide.addText(c.rule, {
      x: rightX + 0.4, y: cy + 0.2, w: rightW - 0.4, h: 0.28,
      fontSize: 10, fontFace: FONT_CN, color: COLORS.textSubtle,
      align: 'left', valign: 'top',
    });
  });

  // 信源家族
  const srcY = top + 0.35 + content.overview.confidenceLegend.length * 0.58 + 0.25;
  slide.addText('信源家族', {
    x: rightX, y: srcY, w: rightW, h: 0.32,
    fontSize: 12, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle',
  });

  content.overview.sources.forEach((src, i) => {
    const sy = srcY + 0.35 + i * 0.52;
    const srcCol = src.color === 'primary' ? COLORS.primary
      : src.color === 'secondary' ? COLORS.secondary : COLORS.accent;
    slide.addShape('roundRect', {
      x: rightX, y: sy, w: rightW, h: 0.46, rectRadius: 0.1,
      fill: { color: srcCol }, line: { type: 'none' },
    });
    slide.addText(src.name, {
      x: rightX + 0.15, y: sy + 0.04, w: rightW - 0.3, h: 0.22,
      fontSize: 11, fontFace: FONT_CN, bold: true, color: 'FFFFFF',
      align: 'left', valign: 'middle',
    });
    slide.addText(truncateShort(src.description, 28), {
      x: rightX + 0.15, y: sy + 0.25, w: rightW - 0.3, h: 0.18,
      fontSize: 9, fontFace: FONT_CN, color: 'FFFFFF', transparency: 20,
      align: 'left', valign: 'middle',
    });
  });

  addFooter(pageNo);
}

// ========================================================================
// P03 / P07 方向索引
// ========================================================================

function addIndex(pptx: PptxGenJS, content: DailyReportContent, dir: DirectionIndex, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  const isCoding = dir.key === 'coding';
  const primaryCol = isCoding ? COLORS.primary : COLORS.secondary;
  const lightBg = isCoding ? COLORS.lightBlue : COLORS.lightCyan;

  // 左侧色带
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.12, h: SLIDE_H,
    fill: { color: primaryCol }, line: { type: 'none' },
  });

  // 方向标题
  slide.addText(dir.title, {
    x: PAD_X + 0.15, y: PAD_TOP + 0.05, w: 7, h: 0.65,
    fontSize: 28, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle',
  });
  slide.addText(dir.subtitle, {
    x: PAD_X + 0.15, y: PAD_TOP + 0.7, w: 7, h: 0.3,
    fontSize: 13, fontFace: FONT_CN, color: COLORS.textSubtle,
    align: 'left', valign: 'middle',
  });

  // 索引条目
  const startY = PAD_TOP + 1.1;
  const rowH = 0.9;
  const maxRows = Math.min(dir.summaryItems.length, 6);

  dir.summaryItems.slice(0, maxRows).forEach((item, i) => {
    const ry = startY + i * rowH;
    const bg = i % 2 === 0 ? lightBg : 'FFFFFF';
    slide.addShape('rect', {
      x: PAD_X, y: ry, w: SLIDE_W - PAD_X * 2, h: rowH - 0.04,
      fill: { color: bg }, line: { type: 'none' },
    });

    // 序号
    slide.addText(String(item.rank), {
      x: PAD_X + 0.1, y: ry + 0.08, w: 0.4, h: 0.7,
      fontSize: 22, fontFace: FONT_NUM, bold: true, color: primaryCol,
      align: 'left', valign: 'middle',
    });

    // 标题
    slide.addText(truncateShort(item.title, 36), {
      x: PAD_X + 0.55, y: ry + 0.1, w: 7.5, h: 0.4,
      fontSize: 14, fontFace: FONT_CN, bold: true, color: COLORS.text,
      align: 'left', valign: 'middle',
    });

    // 类别 chip
    if (item.category) {
      addTagPill(slide, item.category, PAD_X + 0.55, ry + 0.52, COLORS.textSubtle);
    }

    // 置信度
    const cc = confColor(item.confidence as ConfidenceLevel);
    slide.addShape('roundRect', {
      x: PAD_X + 8.8, y: ry + 0.3, w: 0.5, h: 0.3, rectRadius: 0.06,
      fill: { color: cc }, line: { type: 'none' },
    });
    slide.addText(item.confidence, {
      x: PAD_X + 8.8, y: ry + 0.3, w: 0.5, h: 0.3,
      fontSize: 12, fontFace: FONT_NUM, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
  });

  addFooter(pageNo);
}

// ========================================================================
// P04 / P08 方向 Hero
// ========================================================================

function addDirectionHero(pptx: PptxGenJS, content: DailyReportContent, dir: DirectionIndex, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  const isCoding = dir.key === 'coding';
  const primaryCol = isCoding ? COLORS.primary : COLORS.secondary;
  const darkCol = isCoding ? COLORS.primaryDark : COLORS.secondaryDark;

  // 左侧色板（40%）
  slide.addShape('rect', {
    x: 0, y: 0, w: SLIDE_W * 0.38, h: SLIDE_H,
    fill: { color: primaryCol }, line: { type: 'none' },
  });

  addHeader(pageNo, dir.title, dir.subtitle, {
    text: `${dir.count} 条内容`,
    bg: darkCol, fg: 'FFFFFF',
  });

  // Hero item（summaryItems[0]）
  const hero = dir.summaryItems[0];
  if (!hero) {
    addFooter(pageNo);
    return;
  }

  const item = content.items.find((it) => it.rank === hero.rank);
  const leftX = 0.15;
  const leftW = SLIDE_W * 0.38 - 0.3;
  const topY = PAD_TOP + HEADER_H + 0.2;

  // Hero 标题
  slide.addText(truncateShort(hero.title, 20), {
    x: leftX, y: topY, w: leftW, h: 0.55,
    fontSize: 16, fontFace: FONT_CN, bold: true, color: 'FFFFFF',
    align: 'left', valign: 'middle',
  });

  // 巨型数字锚点
  if (item?.heroMetrics.length) {
    item.heroMetrics.slice(0, 2).forEach((m, i) => {
      const my = topY + 0.65 + i * 1.0;
      slide.addText(m.value, {
        x: leftX, y: my, w: leftW, h: 0.65,
        fontSize: 42, fontFace: FONT_NUM, bold: true, color: 'FFFFFF',
        align: 'left', valign: 'middle',
      });
      if (m.sub) {
        slide.addText(m.sub, {
          x: leftX, y: my + 0.65, w: leftW, h: 0.28,
          fontSize: 11, fontFace: FONT_CN, color: 'FFFFFF', transparency: 20,
          align: 'left', valign: 'middle',
        });
      }
    });
  }

  // 右侧：摘要 + 评论
  const rightX = SLIDE_W * 0.38 + 0.3;
  const rightW = SLIDE_W - rightX - PAD_X;

  if (item) {
    const ry = PAD_TOP + HEADER_H + 0.2;
    slide.addText(truncateShort(item.summary, 160), {
      x: rightX, y: ry, w: rightW, h: 2.0,
      fontSize: 13, fontFace: FONT_CN, color: COLORS.text,
      align: 'left', valign: 'top',
    });

    if (item.comment) {
      slide.addText('💡 ' + truncateShort(item.comment, 80), {
        x: rightX, y: ry + 2.1, w: rightW, h: 0.5,
        fontSize: 12, fontFace: FONT_CN, color: COLORS.textMuted,
        align: 'left', valign: 'top',
      });
    }

    // 一手链接
    if (item.primaryLinks.length > 0) {
      const linkY = ry + 2.7;
      slide.addText('一手来源', {
        x: rightX, y: linkY, w: rightW, h: 0.28,
        fontSize: 11, fontFace: FONT_CN, bold: true, color: COLORS.textSubtle,
        align: 'left', valign: 'middle',
      });
      item.primaryLinks.slice(0, 2).forEach((pl, i) => {
        slide.addText(`${i + 1}. ${truncateShort(pl.source, 20)} → ${pl.url.slice(0, 40)}…`, {
          x: rightX, y: linkY + 0.3 + i * 0.32, w: rightW, h: 0.28,
          fontSize: 10, fontFace: FONT_CN, color: COLORS.linkBlue,
          align: 'left', valign: 'middle',
        });
      });
    }
  }

  addFooter(pageNo);
}

// ========================================================================
// P05 / P06 双列详情卡
// ========================================================================

function addTwoColCards(pptx: PptxGenJS, content: DailyReportContent, items: Item[], pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  const cardW = (SLIDE_W - PAD_X * 2 - 0.2) / 2;
  const cardH = SLIDE_H - PAD_TOP - HEADER_H - FOOTER_H - 0.3;
  const cardY = PAD_TOP + HEADER_H + 0.1;

  const dir0 = items[0] ? content.directions.find((d) => d.key === items[0].direction) : null;
  addHeader(pageNo, dir0?.title ?? 'AI Coding', dir0?.subtitle ?? '', null);

  items.forEach((item, i) => {
    const cx = PAD_X + i * (cardW + 0.2);
    addItemCard(slide, cx, cardY, cardW, cardH, item);
  });

  addFooter(pageNo);
}

function addItemCard(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  item: Item,
) {
  addSoftCard(slide, x, y, w, h, COLORS.bgCard, COLORS.border);

  let cy = y + 0.12;

  // 右上角置信度大角标（Batch 5：显眼、便于快速识别）
  const cc = confColor(item.confidenceLevel);
  const badgeW = 0.7;
  const badgeH = 0.34;
  const badgeX = x + w - badgeW - 0.12;
  const badgeY = y + 0.12;
  slide.addShape('roundRect', {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH, rectRadius: 0.06,
    fill: { color: cc }, line: { type: 'none' },
  });
  slide.addText(item.confidenceLevel, {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    fontSize: 16, fontFace: FONT_NUM, bold: true, color: 'FFFFFF',
    align: 'center', valign: 'middle',
  });

  if (item.category) {
    addTagPill(slide, item.category, x + 0.12, cy, COLORS.textSubtle);
    cy += 0.38;
  }

  // 标题宽度避开右上角角标（如果卡片较窄）
  const titleW = w - 0.24 - (badgeW + 0.15);
  slide.addText(truncateShort(item.title, 28), {
    x: x + 0.12, y: cy, w: titleW, h: 0.5,
    fontSize: 13, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'top',
  });
  cy += 0.52;

  // 左下保留原 confidence 小色块（信息完整：包含独立信源数）
  slide.addShape('roundRect', {
    x: x + 0.12, y: cy, w: 0.5, h: 0.28, rectRadius: 0.06,
    fill: { color: cc }, line: { type: 'none' },
  });
  slide.addText(item.confidenceLevel, {
    x: x + 0.12, y: cy, w: 0.5, h: 0.28,
    fontSize: 11, fontFace: FONT_NUM, bold: true, color: 'FFFFFF',
    align: 'center', valign: 'middle',
  });

  slide.addText(`${item.independentSources} 独立信源`, {
    x: x + 0.7, y: cy, w: 1.5, h: 0.28,
    fontSize: 10, fontFace: FONT_CN, color: COLORS.textSubtle,
    align: 'left', valign: 'middle',
  });
  cy += 0.36;

  slide.addText(truncateShort(item.summary, 120), {
    x: x + 0.12, y: cy, w: w - 0.24, h: h - (cy - y) - 0.5,
    fontSize: 11, fontFace: FONT_CN, color: COLORS.textMuted,
    align: 'left', valign: 'top',
  });

  if (item.coverUrl) {
    const data = _imageCache.get(item.coverUrl);
    if (data) {
      try {
        slide.addImage({ data, x: x + 0.08, y: y + 0.08, w: w - 0.16, h: h * 0.35 });
      } catch {
        // 图片渲染失败，静默忽略
      }
    }
  }
}

// ========================================================================
// P09 三列详情卡
// ========================================================================

function addThreeColCards(pptx: PptxGenJS, content: DailyReportContent, items: Item[], pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  const cardW = (SLIDE_W - PAD_X * 2 - 0.4) / 3;
  const cardH = SLIDE_H - PAD_TOP - HEADER_H - FOOTER_H - 0.3;
  const cardY = PAD_TOP + HEADER_H + 0.1;

  const dir0 = items[0] ? content.directions.find((d) => d.key === items[0].direction) : null;
  addHeader(pageNo, dir0?.title ?? '具身智能', dir0?.subtitle ?? '', null);

  items.forEach((item, i) => {
    const cx = PAD_X + i * (cardW + 0.2);
    addItemCard(slide, cx, cardY, cardW, cardH, item);
  });

  addFooter(pageNo);
}

// ========================================================================
// P10 Rumor
// ========================================================================

function addRumor(pptx: PptxGenJS, content: DailyReportContent, item: Item, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  addHeader(pageNo, item.title, `传闻待验 · ${item.source} · ${item.publishedAt}`, {
    text: '⚠ D 存疑',
    bg: COLORS.accent, fg: 'FFFFFF',
  });

  const top = PAD_TOP + HEADER_H + 0.15;
  const leftW = SLIDE_W * 0.45;
  const rightX = PAD_X + leftW + 0.25;
  const rightW = SLIDE_W - rightX - PAD_X;

  // 左侧：WhyDoubtful
  slide.addText('为何存疑', {
    x: PAD_X, y: top, w: leftW, h: 0.32,
    fontSize: 13, fontFace: FONT_CN, bold: true, color: COLORS.accentDark,
    align: 'left', valign: 'middle',
  });

  if (item.whyDoubtful.length > 0) {
    item.whyDoubtful.forEach((d, i) => {
      const dy = top + 0.38 + i * 0.45;
      slide.addShape('rect', {
        x: PAD_X, y: dy, w: 0.06, h: 0.36, fill: { color: COLORS.accent }, line: { type: 'none' },
      });
      slide.addText(truncateShort(d, 70), {
        x: PAD_X + 0.15, y: dy, w: leftW - 0.15, h: 0.36,
        fontSize: 12, fontFace: FONT_CN, color: COLORS.textMuted,
        align: 'left', valign: 'middle',
      });
    });
  } else {
    slide.addText(truncateShort(item.summary, 100), {
      x: PAD_X, y: top + 0.38, w: leftW, h: 1.0,
      fontSize: 12, fontFace: FONT_CN, color: COLORS.textSubtle,
      align: 'left', valign: 'top',
    });
  }

  // 右侧：摘要 + 评论
  slide.addText('摘要', {
    x: rightX, y: top, w: rightW, h: 0.32,
    fontSize: 13, fontFace: FONT_CN, bold: true, color: COLORS.text,
    align: 'left', valign: 'middle',
  });

  slide.addText(truncateShort(item.summary, 140), {
    x: rightX, y: top + 0.35, w: rightW, h: 1.5,
    fontSize: 12, fontFace: FONT_CN, color: COLORS.textMuted,
    align: 'left', valign: 'top',
  });

  if (item.comment) {
    slide.addText('💡 ' + truncateShort(item.comment, 80), {
      x: rightX, y: top + 1.9, w: rightW, h: 0.5,
      fontSize: 12, fontFace: FONT_CN, color: COLORS.textMuted,
      align: 'left', valign: 'top',
    });
  }

  // 背景数字
  if (item.keyStats.length > 0) {
    const statY = top + 2.6;
    slide.addText('背景数字', {
      x: rightX, y: statY, w: rightW, h: 0.28,
      fontSize: 11, fontFace: FONT_CN, bold: true, color: COLORS.textSubtle,
      align: 'left', valign: 'middle',
    });
    item.keyStats.slice(0, 3).forEach((s, i) => {
      const sx = rightX + i * 1.8;
      slide.addText(s.value, {
        x: sx, y: statY + 0.3, w: 1.7, h: 0.5,
        fontSize: 20, fontFace: FONT_NUM, bold: true, color: COLORS.accent,
        align: 'left', valign: 'middle',
      });
      slide.addText(s.label, {
        x: sx, y: statY + 0.78, w: 1.7, h: 0.24,
        fontSize: 10, fontFace: FONT_CN, color: COLORS.textSubtle,
        align: 'left', valign: 'middle',
      });
    });
  }

  addFooter(pageNo);
}

// ========================================================================
// P11 B站作者
// ========================================================================

function addAuthors(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  addHeader(pageNo, 'B 站视频作者', `${content.authors.length} 位 AI 早报口播作者 · 信源透明说明`, null);

  const startY = PAD_TOP + HEADER_H + 0.2;
  // R-9 修复（2026-09-16）：authors 之前按"宽度按 2 列算、位置按 4 张排一列"，
  // 第 3/4 张卡片 x=945/1400pt 完全越出 960pt 画布（审计实证）。
  // 现在改为每行最多 2 张的网格布局，行数由实际数量决定。
  const shown = content.authors.slice(0, 4);
  const cols = Math.min(shown.length, 2);
  const rows = Math.ceil(shown.length / cols);
  const gapX = 0.3;
  const gapY = 0.3;
  const cardW = (SLIDE_W - PAD_X * 2 - gapX * (cols - 1)) / cols;
  const cardH = rows > 1 ? 2.35 : 2.8;

  shown.forEach((author, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ax = PAD_X + col * (cardW + gapX);
    const ay = startY + row * (cardH + gapY);
    const ok = author.status === 'ok';
    const col2 = ok ? COLORS.primary : COLORS.accent;
    const bg = ok ? COLORS.lightBlue : COLORS.lightAmber;

    addSoftCard(slide, ax, ay, cardW, cardH, bg, COLORS.border);

    // 头像圆
    slide.addShape('ellipse', {
      x: ax + 0.2, y: ay + 0.2, w: 0.6, h: 0.6,
      fill: { color: col2 }, line: { type: 'none' },
    });
    slide.addText(iconLetter(author.name), {
      x: ax + 0.2, y: ay + 0.2, w: 0.6, h: 0.6,
      fontSize: 18, fontFace: FONT_NUM, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });

    // 名字
    slide.addText(author.name, {
      x: ax + 0.9, y: ay + 0.22, w: cardW - 1.1, h: 0.3,
      fontSize: 14, fontFace: FONT_CN, bold: true, color: COLORS.text,
      align: 'left', valign: 'middle',
    });

    // 状态
    slide.addText(author.statusText, {
      x: ax + 0.9, y: ay + 0.52, w: cardW - 1.1, h: 0.24,
      fontSize: 10, fontFace: FONT_CN, color: col2,
      align: 'left', valign: 'middle',
    });

    // 描述
    slide.addText(truncateShort(author.description, 80), {
      x: ax + 0.15, y: ay + 0.9, w: cardW - 0.3, h: cardH - 1.3,
      fontSize: 11, fontFace: FONT_CN, color: COLORS.textMuted,
      align: 'left', valign: 'top',
    });

    // 链接
    slide.addText('→ 查看主页', {
      x: ax + 0.15, y: ay + cardH - 0.4, w: cardW - 0.3, h: 0.28,
      fontSize: 10, fontFace: FONT_CN, color: COLORS.linkBlue,
      align: 'right', valign: 'middle',
    });
  });

  addFooter(pageNo);
}

// ========================================================================
// P12 验证表
// ========================================================================

function addVerificationTable(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  addHeader(pageNo, '交叉验证汇总 · 置信度', '每条均标注独立信源数、一手链接与置信度', null);

  const { rows } = content.verificationTable;
  const tableTop = PAD_TOP + HEADER_H + 0.1;
  const colWidths = [0.5, 3.8, 1.6, 1.4, 1.2, 0.7];
  const rowH = Math.min(0.42, (SLIDE_H - tableTop - FOOTER_H - 0.5) / Math.max(rows.length, 1));

  // 表头
  const headers = ['#', '话题', '方向', '信源', '一手', '置信'];
  let x = PAD_X;
  headers.forEach((h, i) => {
    slide.addShape('rect', {
      x, y: tableTop, w: colWidths[i], h: rowH,
      fill: { color: COLORS.text }, line: { type: 'none' },
    });
    slide.addText(h, {
      x, y: tableTop, w: colWidths[i], h: rowH,
      fontSize: 10, fontFace: FONT_CN, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
    x += colWidths[i];
  });

  // 数据行
  rows.slice(0, 14).forEach((row, ri) => {
    const ry = tableTop + rowH * (ri + 1);
    const bg = ri % 2 === 0 ? 'FFFFFF' : COLORS.borderLight;
    let cx = PAD_X;

    const cells = [
      { text: row.rank, align: 'center' as const },
      { text: truncateShort(row.topic, 28), align: 'left' as const },
      { text: row.direction, align: 'left' as const },
      { text: row.sources, align: 'center' as const },
      { text: row.primaryLink, align: 'center' as const },
      { text: row.confidence, align: 'center' as const },
    ];

    cells.forEach((cell, ci) => {
      slide.addShape('rect', {
        x: cx, y: ry, w: colWidths[ci], h: rowH,
        fill: { color: bg }, line: { color: COLORS.border, width: 0.3 },
      });
      const fg = ci === 5 ? confColor(row.confidence as ConfidenceLevel) : COLORS.textMuted;
      slide.addText(cell.text, {
        x: cx + 0.05, y: ry, w: colWidths[ci] - 0.1, h: rowH,
        fontSize: 10, fontFace: ci === 0 || ci === 5 ? FONT_NUM : FONT_CN,
        bold: ci === 5, color: fg,
        align: cell.align, valign: 'middle',
      });
      cx += colWidths[ci];
    });
  });

  // 汇总句
  const sumY = tableTop + rowH * (Math.min(rows.length, 14) + 1) + 0.1;
  if (sumY < SLIDE_H - FOOTER_H - 0.4) {
    slide.addText(truncateShort(content.verificationTable.summary, 120), {
      x: PAD_X, y: sumY, w: SLIDE_W - PAD_X * 2, h: 0.4,
      fontSize: 11, fontFace: FONT_CN, color: COLORS.textSubtle,
      align: 'left', valign: 'middle',
    });
  }

  addFooter(pageNo);
}

// ========================================================================
// P13 趋势
// ========================================================================

function addTrends(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  addHeader(pageNo, '三条趋势判断', '未来一年主线 · AI Coding × 具身智能 × 治理', null);

  const startY = PAD_TOP + HEADER_H + 0.2;
  const cardW = (SLIDE_W - PAD_X * 2 - 0.4) / 3;
  const cardH = SLIDE_H - startY - FOOTER_H - 0.2;

  const cols = [COLORS.primary, COLORS.secondary, COLORS.accent];
  const lights = [COLORS.lightBlue, COLORS.lightCyan, COLORS.lightAmber];

  content.trends.slice(0, 3).forEach((trend, i) => {
    const cx = PAD_X + i * (cardW + 0.2);
    const col = cols[i] ?? COLORS.primary;
    const light = lights[i] ?? COLORS.lightBlue;

    addSoftCard(slide, cx, startY, cardW, cardH, light, COLORS.border);

    // 巨型序号
    slide.addText(String(trend.rank), {
      x: cx + 0.15, y: startY + 0.15, w: 1.2, h: 1.0,
      fontSize: 56, fontFace: FONT_NUM, bold: true, color: col,
      align: 'left', valign: 'top',
    });

    // 标题
    slide.addText(truncateShort(trend.title, 18), {
      x: cx + 0.15, y: startY + 1.2, w: cardW - 0.3, h: 0.45,
      fontSize: 13, fontFace: FONT_CN, bold: true, color: COLORS.text,
      align: 'left', valign: 'top',
    });

    // 描述
    slide.addText(truncateShort(trend.description, 90), {
      x: cx + 0.15, y: startY + 1.7, w: cardW - 0.3, h: cardH - 2.0,
      fontSize: 11, fontFace: FONT_CN, color: COLORS.textMuted,
      align: 'left', valign: 'top',
    });
  });

  addFooter(pageNo);
}

// ========================================================================
// P14 信源清单
// ========================================================================

function addEnding(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  addHeader(pageNo, '信源清单与说明', '全部新闻均来自以下相互独立的信息源家族，关键结论附一手官方链接', null);

  const { sources } = content;
  const blocks = [
    { title: '聚合信源', items: sources.skills },
    { title: '视频作者', items: sources.videoAuthors },
    { title: '第三方交叉源', items: sources.crossSources },
    { title: '一手官方链接', items: sources.officialLinks },
  ];

  const startY = PAD_TOP + HEADER_H + 0.2;
  const colW = (SLIDE_W - PAD_X * 2 - 0.3) / 2;
  const rowH = 1.4;

  blocks.forEach((block, i) => {
    const bx = PAD_X + (i % 2) * (colW + 0.3);
    const by = startY + Math.floor(i / 2) * (rowH + 0.15);

    slide.addText(block.title, {
      x: bx, y: by, w: colW, h: 0.28,
      fontSize: 12, fontFace: FONT_CN, bold: true, color: COLORS.text,
      align: 'left', valign: 'middle',
    });

    block.items.slice(0, 5).forEach((it, j) => {
      const iy = by + 0.32 + j * 0.22;
      slide.addText(`• ${truncateShort(it.name, 22)}`, {
        x: bx, y: iy, w: colW - 0.5, h: 0.2,
        fontSize: 10, fontFace: FONT_CN, color: COLORS.textSubtle,
        align: 'left', valign: 'middle',
      });
    });
  });

  addFooter(pageNo, `生成时间 ${content.date} · AIHub 自动化推送`);
}

// ========================================================================
// P15 免责声明（Batch 5）
//   - 4 段说明：①AI 自动生成 ②转载与独立信源 ③评级方法 ④时效性
//   - 风格：浅灰底、左对齐、字号 11
// ========================================================================

function addDisclaimer(pptx: PptxGenJS, content: DailyReportContent, pageNo: number) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  trackSlide(slide, pageNo);

  addHeader(pageNo, '免责声明与编辑说明', '请仔细阅读以下内容，正确理解本份早报', null);

  const startY = PAD_TOP + HEADER_H + 0.4;
  const sectionGap = 1.05;
  const sectionW = SLIDE_W - 2 * PAD_X;

  const sections = [
    {
      title: '一、AI 自动生成',
      body: '本份早报内容由 AI 自动采集、聚簇、评级生成，未经人工逐条核验。读者应自行判断内容的真实性与适用性，不应将其作为唯一决策依据。',
    },
    {
      title: '二、转载与独立信源说明',
      body: '本报告刻意区分「转载」与「独立信源」：多家媒体引用同一家独家报道，仅按 1 个独立信源计算。评级 B 以上需追溯至一手官方材料（官网 / 论文 / 公告）。',
    },
    {
      title: '三、置信度评级方法',
      body: 'A ≥3 个相互独立的信源 + 一手官方材料；B 2 个独立信源 或 1 信源 + 一手；C 单一信源报道；D 关键数字互相矛盾 或 无官方确认。机器草稿评级上限为 B。',
    },
    {
      title: '四、数据采集与时效性',
      body: '本份早报基于「采集时刻」的公开数据。AI 行业动态瞬息万变，6 小时前的信息可能已过时。引用前请再次访问原始链接核对最新版本。',
    },
  ];

  sections.forEach((s, i) => {
    const sy = startY + i * sectionGap;

    // 左侧装饰条
    slide.addShape('rect', {
      x: PAD_X, y: sy + 0.05, w: 0.06, h: 0.7,
      fill: { color: COLORS.primary }, line: { type: 'none' },
    });

    // 段落标题
    slide.addText(s.title, {
      x: PAD_X + 0.2, y: sy, w: sectionW - 0.2, h: 0.32,
      fontSize: 13, fontFace: FONT_CN, bold: true, color: COLORS.text,
      align: 'left', valign: 'middle',
    });

    // 段落正文
    slide.addText(s.body, {
      x: PAD_X + 0.2, y: sy + 0.36, w: sectionW - 0.2, h: 0.6,
      fontSize: 11, fontFace: FONT_CN, color: COLORS.textMuted,
      align: 'left', valign: 'top',
      lineSpacingMultiple: 1.3,
    });
  });

  addFooter(pageNo, `生成时间 ${content.date} · AIHub 自动化推送`);
}
