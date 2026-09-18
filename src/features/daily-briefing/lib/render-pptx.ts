/**
 * AI 早报 — PPTX 构建编排（slide-engine 唯一入口）
 * 路径：src/features/daily-briefing/lib/render-pptx.ts
 *
 * 职责：把 DailyReportContent 走"新引擎（slide-engine）"链路渲染成 PPTX。
 *   plan → lint（fail-fast）→ render
 *
 * 与旧 build-pptx.ts 的区别：
 *   - 旧：pptxgenjs 直接调用，1410 行单文件，装不下就 truncate 硬砍文字
 *   - 新：几何先算（PlacedSlide）→ lint 完全校验 → 通过才渲染；error > 0 拒绝产出
 *
 * 为什么 lint 要阻断（对齐参考 ai-news-kit/build-pptx.mjs 的 exit 1 纪律）：
 *   产出"文字被砍断的 PPT"比"不产出"更糟 —— 读者看到的是病句而不是一条明确的失败。
 *
 * 使用：
 *   const buf = await renderBriefingPptx(content);          // Buffer（下载用）
 *   const { buffer, report } = await renderBriefingPptxWithReport(content);
 */

import { logger } from '@/lib/observability/logger';
import { registerBriefingPageTypes } from '@/lib/slide-engine/templates/briefing/slides';
import { paperTheme } from '@/lib/slide-engine/templates/briefing/theme';
import {
  planBriefingDeck,
  planBriefingToPlacedSlides,
} from '@/lib/slide-engine/templates/briefing/plan';
import { lintDeck } from '@/lib/slide-engine/qa/lint';
import { renderDeckToBuffer } from '@/lib/slide-engine/render/pptx';
import type { LintIssue, LintReport } from '@/lib/slide-engine/contracts/lint';
import type { PlacedSlide } from '@/lib/slide-engine/contracts/geometry';
import type { ThemeTokens } from '@/lib/slide-engine/contracts/theme';
import type { DailyReportContent } from './types';
import { paperThemeAdapter } from './theme-adapter';

// ============================================================================
// 类型
// ============================================================================

export type RenderBriefingResult = {
  /** PPTX 二进制 */
  buffer: Buffer;
  /** lint 报告 */
  report: LintReport;
  /** 实际页数 */
  pageCount: number;
  /** 形状（box）总数 */
  boxCount: number;
  /** 渲染耗时 ms */
  durationMs: number;
};

/** 布局未通过 lint 时抛出。调用方可据此降级到旧引擎或 Markdown。 */
export class LayoutValidationError extends Error {
  readonly issues: LintIssue[];
  readonly pageCount: number;

  constructor(issues: LintIssue[], pageCount: number) {
    const errors = issues.filter((i) => i.level === 'error');
    const sample = errors
      .slice(0, 3)
      .map((e) => `[${e.rule}]P${e.pageNo}:${e.detail}`)
      .join('；');
    super(
      `布局校验未通过：${errors.length} 处 error（共 ${pageCount} 页）。${sample}${errors.length > 3 ? '…' : ''}`,
    );
    this.name = 'LayoutValidationError';
    this.issues = issues;
    this.pageCount = pageCount;
  }
}

// ============================================================================
// 核心编排
// ============================================================================

/**
 * 跑新引擎管线到 PlacedSlide（不含渲染）。
 * 单独导出便于：影子模式比对、lint 预览、单测。
 */
export function buildPlacedSlides(
  content: DailyReportContent,
  theme: ThemeTokens = paperTheme,
): PlacedSlide[] {
  registerBriefingPageTypes();
  const entries = planBriefingDeck(content);
  return planBriefingToPlacedSlides(entries, theme);
}

/**
 * 渲染早报 PPTX（新引擎）。
 *
 * @throws LayoutValidationError lint 有 error 时抛出（fail-fast，不产出被砍断的 PPT）
 */
export async function renderBriefingPptxWithReport(
  content: DailyReportContent,
  opts: { theme?: ThemeTokens; strict?: boolean; skipRender?: boolean } = {},
): Promise<RenderBriefingResult> {
  const theme = opts.theme ?? paperThemeAdapter(content);
  const strict = opts.strict ?? true;
  const skipRender = opts.skipRender ?? false;
  const t0 = Date.now();

  const slides = buildPlacedSlides(content, theme);
  const report = lintDeck(slides, theme);

  const errors = report.issues.filter((i) => i.level === 'error');
  const warns = report.issues.filter((i) => i.level === 'warn');

  if (strict && errors.length > 0) {
    logger.error('[briefing/render-pptx] 布局校验失败，拒绝产出', {
      date: content.date,
      pageCount: slides.length,
      errors: errors.length,
      warns: warns.length,
      sample: errors.slice(0, 3).map((e) => `${e.rule}/P${e.pageNo}`),
    });
    throw new LayoutValidationError(report.issues, slides.length);
  }

  // lint-only 模式：只出几何 + 报告，不翻译 PPTX（省一次整包渲染）
  if (skipRender) {
    return {
      buffer: Buffer.alloc(0),
      report,
      pageCount: slides.length,
      boxCount: slides.reduce((n, s) => n + s.boxes.length, 0),
      durationMs: Date.now() - t0,
    };
  }

  const buffer = await renderDeckToBuffer(slides, theme, {
    title: `AI 日报 ${content.date}`,
    author: 'AIHub',
    company: 'AIHub',
  });

  const durationMs = Date.now() - t0;
  const boxCount = slides.reduce((n, s) => n + s.boxes.length, 0);

  logger.info('[briefing/render-pptx] 渲染完成', {
    date: content.date,
    pages: slides.length,
    boxes: boxCount,
    errors: errors.length,
    warns: warns.length,
    bytes: buffer.length,
    durationMs,
  });

  return { buffer, report, pageCount: slides.length, boxCount, durationMs };
}

/**
 * 简洁入口：只拿 Buffer。
 * @throws LayoutValidationError
 */
export async function renderBriefingPptx(
  content: DailyReportContent,
  opts: { theme?: ThemeTokens; strict?: boolean } = {},
): Promise<Buffer> {
  const { buffer } = await renderBriefingPptxWithReport(content, opts);
  return buffer;
}

// ============================================================================
// 文件名
// ============================================================================

/** 生成下载文件名。草稿（degraded）显式加后缀，绝不与正式产物同名。 */
export function briefingFileName(date: string, isDraft = false): string {
  return isDraft ? `AIHub-AI早报-${date}-机器草稿.pptx` : `AIHub-AI早报-${date}.pptx`;
}
