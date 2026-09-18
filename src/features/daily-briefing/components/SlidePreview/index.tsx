'use client';

/**
 * SlidePreview 模块 — barrel export
 *
 * 为保持向后兼容，外部仍可 `import { SlidePreview } from '.../SlidePreview'`。
 *
 * 拆分说明（2026-09-04 P0-1）：
 * - SlidePreview 主组件暂保留在原 SlidePreview.tsx（1103 行）
 * - CoverSlide 已拆为 slides/CoverSlide.tsx（试点）
 * - P0-2 阶段将剩余 10 个 slide 一一拆出
 * - P0-3 阶段消除模块级 let _currentTotalPages
 *
 * 直接导出 CoverSlide 供新代码使用，旧 SlidePreview.tsx 内部继续引用原函数。
 */

export { SlidePreview } from '../SlidePreview';
export { CoverSlide } from './slides/CoverSlide';
export type { CoverSlideProps } from './slides/CoverSlide';
