'use client';

/**
 * SlidePreview 模块 — 共享 16:9 布局壳
 *
 * 为每个 slide 提供：
 * - 16:9 固定画布尺寸（width × height = W × H）
 * - 注入 SLIDE_TOKENS CSS 变量到根 div（子组件可用 var(--slide-*) 引用）
 * - 中文字体回退栈（与 build-pptx.ts 保持一致）
 *
 * 拆分自原 SlidePreview.tsx（2026-09-04 P0-1）。
 */

import type { ReactNode } from 'react';
import { W, H } from '../constants';
import { SLIDE_TOKENS } from '../tokens';

export interface SlideShellProps {
  children: ReactNode;
  /** 是否显示网格背景（CoverSlide 用） */
  grid?: boolean;
}

/** 中文字体回退栈（web 与 pptx 共用同一族） */
const FONT_STACK =
  '"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif';

export function SlideShell({ children, grid = false }: SlideShellProps) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        ...SLIDE_TOKENS,
        width: W,
        height: H,
        background: '#FFFFFF', // 画布底色保持纯白（OKLCH 纸面色不适合 PPT 渲染）
        fontFamily: FONT_STACK,
      }}
      data-slide-shell
      data-grid={grid ? 'on' : 'off'}
    >
      {children}
    </div>
  );
}
