/**
 * 页面级 cursor-following 渐变光晕的调色板定义
 *
 * 每套调色板有 2 套色阶：
 *   - light : 浅色模式（4 段）—— 给 radial-gradient 背景 + 鼠标 blob
 *   - dark  : 暗色模式（4 段）—— 同上
 *
 * 全部用 OKLCH 表达，保持低饱和（chroma 0.10-0.20）以避免"彩虹 AI"风格。
 *
 * 调色板迭代记录：
 *   v1（首版）：   浅 0.03-0.11 / 暗 0.05-0.16  → 用户反馈"颜色淡"
 *   v2（加深）：   浅 0.06-0.18 / 暗 0.12-0.26  → 用户反馈"太大了，颜色稍微淡一点点"
 *   v3（缩圈径）： 浅 0.04-0.13 / 暗 0.07-0.20，圈径 520px → 用户反馈"再小一点 + 一团"
 *   v4（SVG blob）：0.55-0.85 高饱和 SVG 形态位移 → 用户反馈"颜色变深了"
 *   v5（本次）：   浅 0.04-0.13 / 暗 0.07-0.20，box 380px + 40px blur，blob 形态
 *
 * 经验：上一版 SVG 用了高饱和透明度（0.55-0.85）+ plus-lighter 混合模式，
 *       颜色立刻变得很深很闷。这一版回到柔和档（0.04-0.20），
 *       颜色不抢戏，又能看到调色板在变化。
 */

import type { GradientPaletteName } from '@/lib/hooks/use-gradient-palette';

export type FixedPaletteName = Exclude<GradientPaletteName, 'auto'>;

export interface Palette {
  name: FixedPaletteName;
  label: string;
  /** 浅色模式（4 段：内→外） */
  light: [string, string, string, string];
  /** 暗色模式（4 段：内→外） */
  dark: [string, string, string, string];
}

export const PALETTES: Palette[] = [
  {
    name: 'glacier',
    label: '冰川',
    // 冷蓝 → 紫 → 青 → 暖微光
    light: [
      'oklch(70% 0.16 220 / 0.13)',
      'oklch(72% 0.15 290 / 0.10)',
      'oklch(76% 0.12 180 / 0.07)',
      'oklch(80% 0.12 60 / 0.04)',
    ],
    dark: [
      'oklch(72% 0.18 220 / 0.20)',
      'oklch(70% 0.20 290 / 0.15)',
      'oklch(74% 0.15 180 / 0.10)',
      'oklch(76% 0.12 60 / 0.06)',
    ],
  },
  {
    name: 'dusk',
    label: '黄昏',
    light: [
      'oklch(74% 0.15 25 / 0.13)',
      'oklch(76% 0.14 350 / 0.10)',
      'oklch(70% 0.14 310 / 0.07)',
      'oklch(83% 0.12 75 / 0.04)',
    ],
    dark: [
      'oklch(72% 0.17 25 / 0.20)',
      'oklch(74% 0.16 350 / 0.15)',
      'oklch(70% 0.16 310 / 0.10)',
      'oklch(80% 0.14 75 / 0.06)',
    ],
  },
  {
    name: 'moss',
    label: '苔藓',
    light: [
      'oklch(70% 0.13 155 / 0.13)',
      'oklch(72% 0.11 200 / 0.10)',
      'oklch(76% 0.10 220 / 0.07)',
      'oklch(83% 0.12 95 / 0.04)',
    ],
    dark: [
      'oklch(70% 0.15 155 / 0.19)',
      'oklch(72% 0.13 200 / 0.14)',
      'oklch(76% 0.12 220 / 0.10)',
      'oklch(80% 0.14 95 / 0.06)',
    ],
  },
  {
    name: 'aurora',
    label: '极光',
    light: [
      'oklch(76% 0.16 175 / 0.13)',
      'oklch(80% 0.14 150 / 0.10)',
      'oklch(74% 0.15 290 / 0.07)',
      'oklch(83% 0.11 350 / 0.04)',
    ],
    dark: [
      'oklch(76% 0.18 175 / 0.20)',
      'oklch(78% 0.16 150 / 0.15)',
      'oklch(72% 0.17 290 / 0.10)',
      'oklch(80% 0.13 350 / 0.06)',
    ],
  },
  {
    name: 'velvet',
    label: '丝绒',
    light: [
      'oklch(66% 0.16 320 / 0.13)',
      'oklch(68% 0.16 10 / 0.10)',
      'oklch(72% 0.15 345 / 0.07)',
      'oklch(80% 0.12 65 / 0.04)',
    ],
    dark: [
      'oklch(66% 0.18 320 / 0.20)',
      'oklch(68% 0.18 10 / 0.15)',
      'oklch(70% 0.17 345 / 0.10)',
      'oklch(78% 0.14 65 / 0.06)',
    ],
  },
  {
    name: 'mist',
    label: '晨雾',
    light: [
      'oklch(83% 0.10 175 / 0.12)',
      'oklch(80% 0.11 290 / 0.09)',
      'oklch(86% 0.07 30 / 0.06)',
      'oklch(90% 0.08 80 / 0.04)',
    ],
    dark: [
      'oklch(78% 0.12 175 / 0.17)',
      'oklch(74% 0.13 290 / 0.13)',
      'oklch(80% 0.09 30 / 0.09)',
      'oklch(83% 0.10 80 / 0.06)',
    ],
  },
];

export const PALETTE_INDEX: Record<FixedPaletteName, Palette> = PALETTES.reduce(
  (acc, p) => {
    acc[p.name] = p;
    return acc;
  },
  {} as Record<FixedPaletteName, Palette>,
);

export function getPaletteByName(name: FixedPaletteName): Palette {
  return PALETTE_INDEX[name];
}

/** 给定 light 4 段，生成预览渐变（用于主题设置面板的缩略图） */
export function palettePreviewGradient(light: readonly string[]): string {
  // 缩略图用 80px 半径、均匀分布
  const stops = light
    .map((color, i) => `${color} ${(i * 100) / (light.length - 1)}%`)
    .join(', ');
  return `radial-gradient(80px circle at 30% 30%, ${stops}, transparent 75%)`;
}