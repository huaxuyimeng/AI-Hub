/**
 * SlidePreview 模块常量
 * 从原 SlidePreview.tsx 抽出（2026-09-04 P0-1 拆分）
 *
 * 16:9 画布的所有尺寸参数，单位 inches，乘以 S 得到 px。
 * 修改这些值会影响所有 slide 的布局，需要全量视觉回归。
 */

/** 缩放系数：S=58 → 64 时整体放大 10%（853×480 → 853×480），更饱满 */
export const S = 64;

/** 16:9 画布宽度（inches → px） */
export const W = 13.33 * S;

/** 16:9 画布高度（inches → px） */
export const H = 7.5 * S;

/** 左右内边距 */
export const PAD_X = 0.5 * S;

/** 顶部内边距（用于 Header 上方留白） */
export const PAD_TOP = 0.25 * S;

/** Header 高度 */
export const HEADER_H = 0.92 * S;

/** Footer 高度 */
export const FOOTER_H = 0.42 * S;

/** inches → px 转换器 */
export const px = (inches: number): number => inches * S;

/** 默认总页数（兼容未传入 totalPages 的旧调用） */
export const DEFAULT_TOTAL_PAGES = 14;
