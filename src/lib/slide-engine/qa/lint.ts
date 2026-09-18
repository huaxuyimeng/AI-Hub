/**
 * 布局 lint（M5）：跑在 PlacedSlide 几何模型上的纯函数
 * L1 越界 / L2 文本溢出 / L3 元素重叠 / L4 容量超限 / L5 页数一致 / L6 密度 / L7 字号栅格
 * 约定：插槽名以 bullet 开头的文本盒计为条目；页码盒插槽名为 page-no
 */

import type { ThemeTokens } from '../contracts/theme';
import type { PlacedBox, PlacedSlide } from '../contracts/geometry';
import type { LintIssue, LintReport } from '../contracts/lint';
import { measureLines, measureTextHeight } from '../layout/measure';

export type LintOptions = {
  /** 相对余量，默认 0.05，兜测量误差 */
  tolerance?: number;
  /** L3 容差（pt），默认 0.5 */
  overlapTolerance?: number;
};

const DEFAULTS: Required<LintOptions> = { tolerance: 0.05, overlapTolerance: 0.5 };

/** L6：允许连续出现的同页型张数上限（超出即提示编排异常） */
const MAX_CONSECUTIVE_SAME_TYPE = 5;

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function lintSlide(slide: PlacedSlide, theme: ThemeTokens, opts?: LintOptions): LintIssue[] {
  const o = { ...DEFAULTS, ...opts };
  const issues: LintIssue[] = [];
  const page = theme.page;

  // L1 越界与非法尺寸
  for (const b of slide.boxes) {
    if (b.box.w <= 0 || b.box.h <= 0) {
      issues.push({
        rule: 'L1', pageNo: slide.pageNo, boxId: b.id, level: 'error',
        detail: `盒 ${b.id}（${b.slot}）尺寸非法：${round(b.box.w)} × ${round(b.box.h)} pt`,
      });
      continue;
    }
    const outsideCanvas =
      b.box.x < 0 || b.box.y < 0 || b.box.x + b.box.w > page.width || b.box.y + b.box.h > page.height;
    if (outsideCanvas) {
      issues.push({
        rule: 'L1', pageNo: slide.pageNo, boxId: b.id, level: 'error',
        detail: `盒 ${b.id}（${b.slot}）越出画布（${page.width} × ${page.height} pt）`,
      });
      continue;
    }
    if (b.decorative || b.allowUnsafe) continue;
    const outsideSafe =
      b.box.x < theme.margin.x ||
      b.box.y < theme.margin.y ||
      b.box.x + b.box.w > page.width - theme.margin.x ||
      b.box.y + b.box.h > page.height - theme.margin.y;
    if (outsideSafe) {
      issues.push({
        rule: 'L1', pageNo: slide.pageNo, boxId: b.id, level: 'error',
        detail: `盒 ${b.id}（${b.slot}）越出安全区（边距 ${theme.margin.x} / ${theme.margin.y} pt）`,
      });
    }
  }

  // L2 文本溢出：估算行数与高度对盒高
  for (const b of slide.boxes) {
    const t = b.text;
    if (!t || !t.value) continue;
    const lines = measureLines(t.value, t.size, b.box.w, { weight: t.weight, font: t.font });
    if (!Number.isFinite(lines)) {
      issues.push({
        rule: 'L2', pageNo: slide.pageNo, boxId: b.id, level: 'error',
        detail: `盒 ${b.id}（${b.slot}）宽度 ${round(b.box.w)} pt 非法，无法折行`,
      });
      continue;
    }
    if (lines > t.maxLines) {
      issues.push({
        rule: 'L2', pageNo: slide.pageNo, boxId: b.id, level: 'error',
        detail: `盒 ${b.id}（${b.slot}）需 ${lines} 行，超上限 ${t.maxLines} 行`,
      });
    }
    const height = measureTextHeight(lines, t.size, t.lineHeight);
    if (height > b.box.h * (1 + o.tolerance)) {
      issues.push({
        rule: 'L2', pageNo: slide.pageNo, boxId: b.id, level: 'error',
        detail: `盒 ${b.id}（${b.slot}）文本高 ${round(height)} pt 超盒高 ${round(b.box.h)} pt（余量 ${o.tolerance * 100}%）`,
      });
    }
  }

  // L3 元素重叠：非装饰盒两两相交且互不包含即报错（包含 = 容器与子元素，合法）
  const solid = slide.boxes.filter((b) => !b.decorative);
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i];
      const b = solid[j];
      const t = o.overlapTolerance;
      const overlap =
        a.box.x + a.box.w - b.box.x > t &&
        b.box.x + b.box.w - a.box.x > t &&
        a.box.y + a.box.h - b.box.y > t &&
        b.box.y + b.box.h - a.box.y > t;
      if (!overlap) continue;
      const aContainsB =
        b.box.x >= a.box.x - t && b.box.y >= a.box.y - t &&
        b.box.x + b.box.w <= a.box.x + a.box.w + t && b.box.y + b.box.h <= a.box.y + a.box.h + t;
      const bContainsA =
        a.box.x >= b.box.x - t && a.box.y >= b.box.y - t &&
        a.box.x + a.box.w <= b.box.x + b.box.w + t && a.box.y + a.box.h <= b.box.y + b.box.h + t;
      // 完全重合（互为包含）几乎必然是坐标算错，不是容器关系
      if (aContainsB && bContainsA) {
        issues.push({
          rule: 'L3', pageNo: slide.pageNo, boxId: b.id, level: 'error',
          detail: `盒 ${a.id}（${a.slot}）与盒 ${b.id}（${b.slot}）完全重合`,
        });
        continue;
      }
      if (aContainsB || bContainsA) continue;
      issues.push({
        rule: 'L3', pageNo: slide.pageNo, boxId: b.id, level: 'error',
        detail: `盒 ${b.id}（${b.slot}）与盒 ${a.id}（${a.slot}）部分重叠`,
      });
    }
  }

  // L4 容量超限（capacity 由管线装配时附上）
  if (slide.capacity && !slide.capacity.ok) {
    for (const ov of slide.capacity.overflows) {
      issues.push({
        rule: 'L4', pageNo: slide.pageNo, level: ov.action === 'compress' ? 'error' : 'warn',
        detail: `插槽 ${ov.slot} ${ov.kind === 'chars' ? '字数' : ov.kind === 'lines' ? '行数' : '条目数'} ${ov.actual} 超预算 ${ov.budget}`,
      });
    }
  }

  // L7 字号栅格：text.size 必须是 theme.type 里声明过的层级
  // 否则会出现「14pt / 15pt / 17pt」这类随手写的字号，视觉层级立刻散掉。
  // 用 theme 自身推导允许集合，保持 lint 与具体模板解耦。
  const allowedSizes = new Set(
    Object.values(theme.type).map((t) => Math.round(t.size * 100) / 100),
  );
  for (const b of slide.boxes) {
    const t = b.text;
    if (!t || !t.value) continue;
    const size = Math.round(t.size * 100) / 100;
    if (!allowedSizes.has(size)) {
      issues.push({
        rule: 'L7', pageNo: slide.pageNo, boxId: b.id, level: 'warn',
        detail: `盒 ${b.id}（${b.slot}）字号 ${size}pt 不在字号栅格内（允许：${[...allowedSizes].sort((a, b2) => a - b2).join(' / ')}）`,
      });
    }
  }

  return issues;
}

export function lintDeck(slides: PlacedSlide[], theme: ThemeTokens, opts?: LintOptions): LintReport {
  const issues: LintIssue[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    issues.push(...lintSlide(slide, theme, opts));

    // L5 页码连续与总页数一致
    if (slide.pageNo !== i + 1) {
      issues.push({
        rule: 'L5', pageNo: slide.pageNo, level: 'error',
        detail: `第 ${i + 1} 张的 pageNo 为 ${slide.pageNo}，应为 ${i + 1}`,
      });
    }
    if (slide.totalPages !== slides.length) {
      issues.push({
        rule: 'L5', pageNo: slide.pageNo, level: 'error',
        detail: `第 ${slide.pageNo} 页 totalPages 为 ${slide.totalPages}，实际共 ${slides.length} 页`,
      });
    }
    const pageNoBox = slide.boxes.find((b) => b.slot === 'page-no');
    if (pageNoBox?.text && !pageNoBox.text.value.includes(String(slide.pageNo))) {
      issues.push({
        rule: 'L5', pageNo: slide.pageNo, boxId: pageNoBox.id, level: 'warn',
        detail: `页码盒 ${pageNoBox.id} 文本「${pageNoBox.text.value}」不含页码 ${slide.pageNo}`,
      });
    }

    // L6 密度：条目数上限
    const bullets = slide.boxes.filter((b) => b.slot.startsWith('bullet')).length;
    if (bullets > 6) {
      issues.push({
        rule: 'L6', pageNo: slide.pageNo, level: 'warn',
        detail: `本页 ${bullets} 条 bullet，超 6 条上限`,
      });
    }

    // L6 连续同页型：连续 5 张以内视为刻意的序列化展开
    // （例如「一条新闻一页详情」，page count 随当天条数变化），
    // 超过 5 张才提示，避免把正常编排误报成 bug。
    if (i > 0 && slides[i - 1].pageType === slide.pageType) {
      let run = 1;
      for (let k = i - 1; k >= 0 && slides[k].pageType === slide.pageType; k--) run++;
      if (run > MAX_CONSECUTIVE_SAME_TYPE) {
        issues.push({
          rule: 'L6', pageNo: slide.pageNo, level: 'warn',
          detail: `第 ${slide.pageNo - run + 1}-${slide.pageNo} 页连续 ${run} 张同页型 ${slide.pageType}，超 ${MAX_CONSECUTIVE_SAME_TYPE} 张`,
        });
      }
    }
  }

  return { issues, passed: issues.every((x) => x.level !== 'error') };
}

