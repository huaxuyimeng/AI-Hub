'use client';

/**
 * AI 早报 — 16:9 幻灯片预览
 *
 * 实现方式（2026-09-16 切流）：
 *   不再自己画幻灯片，而是直接消费 slide-engine 的几何模型 ——
 *   `planBriefingDeck(content)` → `planBriefingToPlacedSlides(...)` → `<DeckPreview/>`。
 *
 * 为什么必须改：
 *   1. 旧实现是一个 1236 行的 `switch (page) { case 1..14 }`，页数写死 14 页、
 *      页序写死（封面/概览/索引×2/详情×4/传闻/作者/验证/趋势/结尾），
 *      与「页数随当天新闻条数变化」的要求直接冲突 ——
 *      下载的 PPTX 有 13 页（含免责声明），面板里却永远显示 14 页的另一套版面。
 *   2. 生产 PPTX 已切到 slide-engine，预览若继续用自己的布局，
 *      就出现「所见」与「所得」不是同一份东西 —— 预览也就失去了意义。
 *   3. 页数不再由调用方估算：直接取 deck 长度，杜绝第三套页数公式。
 *
 * 与 PPTX 的一致性边界：
 *   几何（位置/尺寸/字号/文案）与 PPTX 完全同源；
 *   预览渲染器（SlideCanvas）是手写复刻，理论上仍可能与 PPTX 渲染层偏离，
 *   该偏离由 `pnpm audit:fonts` 与 `src/lib/slide-engine/visual-regression.test.ts` 守着。
 */

import React, { useMemo } from 'react';
import type { DailyReportContent } from '@/features/daily-briefing/lib/types';
import { paperTheme } from '@/lib/slide-engine/templates/briefing/theme';
import type { ThemeTokens } from '@/lib/slide-engine/contracts/theme';
import { registerBriefingPageTypes } from '@/lib/slide-engine/templates/briefing/slides';
import {
  planBriefingDeck,
  planBriefingToPlacedSlides,
} from '@/lib/slide-engine/templates/briefing/plan';
import { DeckPreview } from '@/lib/slide-engine/render/web';

/** 画布缩放：与旧实现保持同一显示尺寸（853 × 480），保证容器宽度不变 */
const S = 64;
const W = 13.33 * S;
const H = 7.5 * S;
/** 引擎画布是 960 × 540 pt，按显示宽度等比缩放 */
const SCALE = W / 960;

export const SlidePreview = React.memo(function SlidePreview({
  content,
  page,
  onPageChange,
  totalPages: propTotalPages,
  theme,
}: {
  content: DailyReportContent;
  page: number;
  onPageChange?: (page: number) => void;
  /** @deprecated 页数由 deck 长度决定，传了也会被忽略（保留仅为兼容旧调用方） */
  totalPages?: number;
  /** 可选主题；缺省 paperTheme */
  theme?: ThemeTokens;
}) {
  const th = theme ?? paperTheme;

  // 页型注册表是模块级单例，`registerBriefingPageTypes()` 已做幂等处理，
  // 反复调用安全；放在 useMemo 里保证首次渲染前一定注册好。
  // 注意 try 只该包住「规划」：注册失败与规划失败是两回事，混在一起会把
  // 「已经注册过」这种无害情况误判成 deck 为空。
  const slides = useMemo(() => {
    registerBriefingPageTypes();
    try {
      return planBriefingToPlacedSlides(planBriefingDeck(content), th);
    } catch (err) {
      // 内容不满足页型契约时不能让整个面板崩掉，降级为空 deck 由下方兜底提示
      console.error('[SlidePreview] deck 规划失败：', err);
      return [];
    }
  }, [content, th]);

  const totalPages = slides.length;

  if (totalPages === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-md border border-border bg-background text-sm text-muted-foreground"
        style={{ width: W, height: H }}
      >
        <p>预览生成失败</p>
        <p className="text-xs">内容未通过版面契约校验，请查看控制台或重新生成</p>
      </div>
    );
  }

  // totalPages 传入时若与 deck 长度不一致，说明调用方的页数公式过期了
  if (propTotalPages != null && propTotalPages !== totalPages) {
    console.warn(
      `[SlidePreview] 传入 totalPages=${propTotalPages}，实际 deck=${totalPages} 页，以实际为准`,
    );
  }

  return (
    <DeckPreview
      slides={slides}
      theme={th}
      scale={SCALE}
      page={page}
      onPageChange={onPageChange}
    />
  );
});
