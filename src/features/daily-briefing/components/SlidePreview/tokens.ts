/**
 * SlidePreview 模块 — 配色 token（CSS 变量形式）
 *
 * 替换原 SlidePreview.tsx 中的硬编码 COLORS 对象（2026-09-04 P0-1 拆分）。
 * 在 React 组件中通过 style 属性注入到根 div，子组件即可用 var(--slide-primary) 引用。
 *
 * **注意**：与 src/lib/themes.ts 的 paper/slate 等全局主题不同，这里是 slide 专用配色，
 * 不参与主题切换。
 *
 * 与 build-pptx.ts 的关系：pptxgenjs 不支持 OKLCH，build-pptx.ts 仍用 hex 字符串（豁免），
 * 保持 web 预览与 PPTX 输出视觉一致靠的是"两套实现使用同样的色相与饱和度意图"。
 */

import type { CSSProperties } from 'react';

/** Slide 专用 token — 值用 CSS 变量引用
 *  TS 不识别 `--` 前缀的 CSSProperties key，用类型断言绕过 */
export const SLIDE_TOKENS = {
  // 文本色系
  '--slide-text':        'oklch(22% 0.015 250)',  // text       #1E293B
  '--slide-text-muted':  'oklch(40% 0.012 250)',  // textMuted  #475569
  '--slide-text-subtle': 'oklch(50% 0.012 250)',  // textSubtle #64748B
  '--slide-text-faint':  'oklch(70% 0.012 250)',  // textFaint  #94A3B8

  // 主色（4 系）
  '--slide-primary':        'oklch(62% 0.18 255)', // primary     #3B82F6
  '--slide-primary-dark':   'oklch(55% 0.18 255)',
  '--slide-secondary':      'oklch(70% 0.13 200)', // secondary   #06B6D4
  '--slide-secondary-dark': 'oklch(62% 0.13 200)',
  '--slide-accent':         'oklch(75% 0.15 75)',  // accent      #F59E0B
  '--slide-accent-dark':    'oklch(65% 0.15 65)',
  '--slide-accent-text':    'oklch(40% 0.05 65)',  // accentText  #92400E

  // 边框与背景
  '--slide-border':       'oklch(92% 0.01 250)',
  '--slide-border-light': 'oklch(95% 0.008 250)',
  '--slide-bg-card':      'oklch(98% 0.005 250)', // bgCard     #F8FAFC
  '--slide-light-blue':   'oklch(96% 0.02 255)',  // lightBlue  #EFF6FF
  '--slide-light-cyan':   'oklch(96% 0.02 200)',
  '--slide-light-amber':  'oklch(97% 0.04 80)',
  '--slide-link':         'oklch(50% 0.18 260)',  // linkBlue   #1D4ED8
} as unknown as CSSProperties;

/** 常用 token 名称 type，便于在子组件中约束 */
export type SlideTokenName =
  | '--slide-text'
  | '--slide-text-muted'
  | '--slide-text-subtle'
  | '--slide-text-faint'
  | '--slide-primary'
  | '--slide-primary-dark'
  | '--slide-secondary'
  | '--slide-secondary-dark'
  | '--slide-accent'
  | '--slide-accent-dark'
  | '--slide-accent-text'
  | '--slide-border'
  | '--slide-border-light'
  | '--slide-bg-card'
  | '--slide-light-blue'
  | '--slide-light-cyan'
  | '--slide-light-amber'
  | '--slide-link';
