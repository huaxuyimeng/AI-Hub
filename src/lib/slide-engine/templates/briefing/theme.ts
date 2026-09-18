/**
 * 早报主题 Token
 * 从现有 themes.ts 收敛而来，6 套主题：paper / ink / mint / lavender / amber / ocean
 *
 * 颜色对应关系（参考原 build-pptx.ts 的 COLORS）：
 * - paper  → 白底 + 蓝色调（原 paper 主题）
 * - ink    → 深色底 + 米色字
 * - mint   → 浅绿调
 * - lavender → 浅紫调
 * - amber  → 浅橙调
 * - ocean  → 青色调
 *
 * C3 闭环：扩展色域（v2）—— 把 SlidePreview 用的全部 13+ 个色 token 也补进每个主题，
 * 这样 SlidePreview 能从 COLORS = theme.colors 派生，不再硬编码。
 * 派生规则：text/primaryDark/secondaryDark/accentDark/accentText/lightBlue/lightCyan/lightAmber/bgCard/borderLight/linkBlue 都是从基础三主色推出来的；
 * 每个主题里直接 inline 写出来，避免下游需要 derive。
 */

import type { ThemeTokens } from '../../contracts/theme';

// ============================================================================
// 早报默认主题：paper（白底蓝调，原 v4 风格）
// ============================================================================

// ============================================================================
// 字号栅格（单一真相）
//
// 参考稿 DESIGN.md 的层级（1280px 画布）：封面主标 / 章节大字 / 巨型锚点 /
// 页标题 / 卡片小标题 / 正文 / 脚注。本引擎画布 960pt，按 0.75 折算并对齐到
// 整数栅格。页面代码一律 import { FONT } 取值，禁止再写裸数字。
// lint L7 会检查任何越界字号。
// ============================================================================

export const FONT = {
  /** 巨型锚点（方向页大数字、趋势页大数字） */
  mega: 88,
  /** 封面主标 / 章节大字 */
  display: 52,
  /** 页标题 */
  h1: 26,
  /** 区块标题 */
  h2: 20,
  /** 卡片小标题 */
  h3: 16,
  /** 正文 */
  body: 13,
  /** 副标题 / 说明 */
  caption: 11,
  /** 脚注 / 页码 / 标签 */
  micro: 9,
  /** 指标数字 */
  number: 32,
} as const;

/** 允许出现的字号集合（lint L7 用；与 FONT 同源，不会漂移） */
export const FONT_GRID: readonly number[] = Object.values(FONT);

const BASE_TYPE = {
  mega:    { size: FONT.mega, weight: 700 as const, lineHeight: 1.0 },
  display: { size: FONT.display, weight: 700 as const, lineHeight: 1.2 },
  h1:      { size: FONT.h1, weight: 700 as const, lineHeight: 1.25 },
  h2:      { size: FONT.h2, weight: 700 as const, lineHeight: 1.3 },
  h3:      { size: FONT.h3, weight: 700 as const, lineHeight: 1.3 },
  body:    { size: FONT.body, weight: 400 as const, lineHeight: 1.55 },
  caption: { size: FONT.caption, weight: 400 as const, lineHeight: 1.4 },
  micro:   { size: FONT.micro, weight: 400 as const, lineHeight: 1.4 },
  number:  { size: FONT.number, weight: 700 as const, lineHeight: 1.1 },
};
const BASE_PAGE = { width: 960, height: 540 };
const BASE_MARGIN = { x: 36, y: 18 };
const BASE_FONTS = { cn: 'Microsoft YaHei', num: 'Inter' };

export const paperTheme: ThemeTokens = {
  id: 'paper',
  colors: {
    primary: '#3B82F6',
    secondary: '#06B6D4',
    accent: '#F59E0B',
    primarySoft: '#EFF6FF',
    secondarySoft: '#ECFEFF',
    accentSoft: '#FFFBEB',
    ink: '#1E293B',
    inkMuted: '#475569',
    inkSubtle: '#64748B',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    text: '#1E293B',
    textMuted: '#475569',
    textSubtle: '#64748B',
    textFaint: '#94A3B8',
    primaryDark: '#2563EB',
    secondaryDark: '#0891B2',
    accentDark: '#D97706',
    accentText: '#92400E',
    lightBlue: '#EFF6FF',
    lightCyan: '#ECFEFF',
    lightAmber: '#FFFBEB',
    bgCard: '#F8FAFC',
    borderLight: '#EEF2F7',
    linkBlue: '#1D4ED8',
  },
  fonts: BASE_FONTS,
  type: BASE_TYPE,
  page: BASE_PAGE,
  margin: BASE_MARGIN,
};

// ============================================================================
// ink 主题：深色底 + 米色字
// ============================================================================

export const inkTheme: ThemeTokens = {
  id: 'ink',
  colors: {
    primary: '#FFFFFF',
    secondary: '#E5E7EB',
    accent: '#FBBF24',
    primarySoft: '#1F2937',
    secondarySoft: '#374151',
    accentSoft: '#422006',
    ink: '#FAFAF9',
    inkMuted: '#D6D3D1',
    inkSubtle: '#A8A29E',
    surface: '#0C0A09',
    border: '#44403C',
    text: '#FAFAF9',
    textMuted: '#D6D3D1',
    textSubtle: '#A8A29E',
    textFaint: '#78716C',
    primaryDark: '#E5E7EB',
    secondaryDark: '#D6D3D1',
    accentDark: '#D97706',
    accentText: '#FAFAF9',
    lightBlue: '#1F2937',
    lightCyan: '#374151',
    lightAmber: '#422006',
    bgCard: '#1C1917',
    borderLight: '#292524',
    linkBlue: '#93C5FD',
  },
  fonts: BASE_FONTS,
  type: BASE_TYPE,
  page: BASE_PAGE,
  margin: BASE_MARGIN,
};

// ============================================================================
// mint 主题：浅绿调
// ============================================================================

export const mintTheme: ThemeTokens = {
  id: 'mint',
  colors: {
    primary: '#10B981',
    secondary: '#34D399',
    accent: '#F59E0B',
    primarySoft: '#ECFDF5',
    secondarySoft: '#D1FAE5',
    accentSoft: '#FEF3C7',
    ink: '#064E3B',
    inkMuted: '#065F46',
    inkSubtle: '#047857',
    surface: '#FFFFFF',
    border: '#A7F3D0',
    text: '#064E3B',
    textMuted: '#065F46',
    textSubtle: '#047857',
    textFaint: '#6EE7B7',
    primaryDark: '#059669',
    secondaryDark: '#10B981',
    accentDark: '#D97706',
    accentText: '#92400E',
    lightBlue: '#ECFDF5',
    lightCyan: '#D1FAE5',
    lightAmber: '#FEF3C7',
    bgCard: '#F0FDF4',
    borderLight: '#D1FAE5',
    linkBlue: '#047857',
  },
  fonts: BASE_FONTS,
  type: BASE_TYPE,
  page: BASE_PAGE,
  margin: BASE_MARGIN,
};

// ============================================================================
// lavender 主题：浅紫调
// ============================================================================

export const lavenderTheme: ThemeTokens = {
  id: 'lavender',
  colors: {
    primary: '#8B5CF6',
    secondary: '#A78BFA',
    accent: '#EC4899',
    primarySoft: '#F5F3FF',
    secondarySoft: '#EDE9FE',
    accentSoft: '#FCE7F3',
    ink: '#1E1B4B',
    inkMuted: '#312E81',
    inkSubtle: '#4C1D95',
    surface: '#FFFFFF',
    border: '#DDD6FE',
    text: '#1E1B4B',
    textMuted: '#312E81',
    textSubtle: '#4C1D95',
    textFaint: '#A5B4FC',
    primaryDark: '#7C3AED',
    secondaryDark: '#8B5CF6',
    accentDark: '#DB2777',
    accentText: '#9D174D',
    lightBlue: '#F5F3FF',
    lightCyan: '#EDE9FE',
    lightAmber: '#FCE7F3',
    bgCard: '#FAF5FF',
    borderLight: '#EDE9FE',
    linkBlue: '#6D28D9',
  },
  fonts: BASE_FONTS,
  type: BASE_TYPE,
  page: BASE_PAGE,
  margin: BASE_MARGIN,
};

// ============================================================================
// amber 主题：浅橙调
// ============================================================================

export const amberTheme: ThemeTokens = {
  id: 'amber',
  colors: {
    primary: '#F59E0B',
    secondary: '#FBBF24',
    accent: '#DC2626',
    primarySoft: '#FFFBEB',
    secondarySoft: '#FEF3C7',
    accentSoft: '#FEE2E2',
    ink: '#451A03',
    inkMuted: '#78350F',
    inkSubtle: '#92400E',
    surface: '#FFFFFF',
    border: '#FDE68A',
    text: '#451A03',
    textMuted: '#78350F',
    textSubtle: '#92400E',
    textFaint: '#FCD34D',
    primaryDark: '#D97706',
    secondaryDark: '#F59E0B',
    accentDark: '#B91C1C',
    accentText: '#7F1D1D',
    lightBlue: '#FFFBEB',
    lightCyan: '#FEF3C7',
    lightAmber: '#FEE2E2',
    bgCard: '#FFFBEB',
    borderLight: '#FEF3C7',
    linkBlue: '#B45309',
  },
  fonts: BASE_FONTS,
  type: BASE_TYPE,
  page: BASE_PAGE,
  margin: BASE_MARGIN,
};

// ============================================================================
// ocean 主题：青色调
// ============================================================================

export const oceanTheme: ThemeTokens = {
  id: 'ocean',
  colors: {
    primary: '#0891B2',
    secondary: '#06B6D4',
    accent: '#F97316',
    primarySoft: '#ECFEFF',
    secondarySoft: '#CFFAFE',
    accentSoft: '#FFEDD5',
    ink: '#083344',
    inkMuted: '#155E75',
    inkSubtle: '#0E7490',
    surface: '#FFFFFF',
    border: '#A5F3FC',
    text: '#083344',
    textMuted: '#155E75',
    textSubtle: '#0E7490',
    textFaint: '#67E8F9',
    primaryDark: '#0E7490',
    secondaryDark: '#0891B2',
    accentDark: '#EA580C',
    accentText: '#9A3412',
    lightBlue: '#ECFEFF',
    lightCyan: '#CFFAFE',
    lightAmber: '#FFEDD5',
    bgCard: '#ECFEFF',
    borderLight: '#CFFAFE',
    linkBlue: '#0E7490',
  },
  fonts: BASE_FONTS,
  type: BASE_TYPE,
  page: BASE_PAGE,
  margin: BASE_MARGIN,
};

// ============================================================================
// 主题注册表
// ============================================================================

export const BRIEFING_THEMES: Record<string, ThemeTokens> = {
  paper:    paperTheme,
  ink:      inkTheme,
  mint:     mintTheme,
  lavender: lavenderTheme,
  amber:    amberTheme,
  ocean:    oceanTheme,
};

export const DEFAULT_BRIEFING_THEME = paperTheme;

export function getTheme(id: string): ThemeTokens {
  return BRIEFING_THEMES[id] ?? DEFAULT_BRIEFING_THEME;
}
