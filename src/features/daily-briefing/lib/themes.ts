/**
 * AI 早报 — 主题色板（与 slide-engine 主题对齐）
 * 路径：src/features/daily-briefing/lib/themes.ts
 *
 * O1 闭环：色板预览 ↔ SlidePreview ↔ 下载 PPT 必须使用同一套主题 token。
 *   - 之前：BRIEFING_PALETTES 是独立的 OKLCH 衍生 HEX，与 slide-engine 主题不一致
 *   - 现在：色板从 slide-engine BRIEFING_THEMES 派生（同一份 token，三处同步）
 *   - 单一事实来源：src/lib/slide-engine/templates/briefing/theme.ts
 *
 * 保留 getPalette/css 旧 API（向后兼容 BriefingToast），但底层数据来自 theme.ts
 */

import type { BriefingTheme } from './types';
import { BRIEFING_THEMES } from '@/lib/slide-engine/templates/briefing/theme';

/** 旧 BriefingPalette 接口（保持外部调用方不破坏） */
export interface BriefingPalette {
  id: BriefingTheme;
  name: string;
  /** 是否深色底（影响文字配色） */
  dark: boolean;
  /** 幻灯片背景（无 #） */
  bg: string;
  /** 主文字（无 #） */
  fg: string;
  /** 次要文字（无 #） */
  muted: string;
  /** 强调色（无 #，用于 chip / 标题点缀） */
  accent: string;
  /** 浅色块背景（无 #） */
  softBlock: string;
  /** 分割线 / 边框（无 #） */
  line: string;
  /** 中文主题名（用于 UI 文案） */
  displayName: string;
}

/** 把 "#RRGGBB" 切成 "RRGGBB" */
function strip(hex: string): string {
  return hex.replace(/^#/, '');
}

/** 从 slide-engine ThemeTokens 派生 BriefingPalette */
function toPalette(themeId: BriefingTheme): BriefingPalette {
  const t = BRIEFING_THEMES[themeId];
  if (!t) return null as never;
  // ink 主题 surface 是深色，其它 5 个是白底
  const dark = t.id === 'ink';
  return {
    id: themeId,
    name: themeId,
    displayName: PALETTE_NAMES[themeId] ?? themeId,
    dark,
    bg: strip(t.colors.surface),
    fg: strip(t.colors.text),
    muted: strip(t.colors.textMuted),
    accent: strip(t.colors.primary),
    softBlock: strip(t.colors.primarySoft),
    line: strip(t.colors.border),
  };
}

/** 中文主题名（人类可读） */
const PALETTE_NAMES: Record<BriefingTheme, string> = {
  paper: '纸面蓝调',
  ink: '墨韵深褐',
  mint: '薄荷绿',
  lavender: '薰衣草紫',
  amber: '暖橙琥珀',
  ocean: '海洋青蓝',
};

/** 6 套主题（自动从 slide-engine 派生） */
export const BRIEFING_PALETTES: Record<BriefingTheme, BriefingPalette> = {
  paper: toPalette('paper'),
  ink: toPalette('ink'),
  mint: toPalette('mint'),
  lavender: toPalette('lavender'),
  amber: toPalette('amber'),
  ocean: toPalette('ocean'),
};

export function getPalette(theme: string): BriefingPalette {
  return BRIEFING_PALETTES[theme as BriefingTheme] ?? BRIEFING_PALETTES.paper;
}

/** CSS 用的 # 前缀版本 */
export function css(palette: BriefingPalette) {
  return {
    bg: `#${palette.bg}`,
    fg: `#${palette.fg}`,
    muted: `#${palette.muted}`,
    accent: `#${palette.accent}`,
    softBlock: `#${palette.softBlock}`,
    line: `#${palette.line}`,
  };
}
