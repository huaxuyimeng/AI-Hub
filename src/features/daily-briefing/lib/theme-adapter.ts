/**
 * 早报主题适配器
 * 路径：src/features/daily-briefing/lib/theme-adapter.ts
 *
 * 职责：把 DailyReportContent + DB 里的 theme 标识，映射为 slide-engine 的 ThemeTokens。
 *
 * 背景：历史上 DB 存了 6 套主题（paper/ink/mint/lavender/amber/ocean），
 * 但 v4 视觉实际固定白底单主题。这里做收敛：
 *   - 显式 theme 命中注册表 → 用它（保留用户显式切换能力）
 *   - 否则 → paper（白底，项目纪律：交付物一律白底浅色）
 */

import {
  BRIEFING_THEMES,
  paperTheme,
  getTheme as getEngineTheme,
} from '@/lib/slide-engine/templates/briefing/theme';
import type { ThemeTokens } from '@/lib/slide-engine/contracts/theme';
import type { DailyReportContent } from './types';
import type { BriefingTheme } from './types';

/** 默认主题（白底）——所有早报的基线 */
export const DEFAULT_THEME = paperTheme;

/** 6 套历史主题 id → slide-engine 主题 id（当前 1:1 同名） */
const THEME_ID_MAP: Record<string, string> = {
  paper: 'paper',
  ink: 'ink',
  mint: 'mint',
  lavender: 'lavender',
  amber: 'amber',
  ocean: 'ocean',
};

/**
 * 从 DB theme 标识解析 ThemeTokens。
 * 未知/空 → 默认 paper（不抛错，保证渲染链路不因主题缺省而中断）。
 */
export function themeFromId(id: string | null | undefined): ThemeTokens {
  if (!id) return DEFAULT_THEME;
  const mapped = THEME_ID_MAP[id];
  if (!mapped) return DEFAULT_THEME;
  return BRIEFING_THEMES[mapped] ?? DEFAULT_THEME;
}

/**
 * 从内容推断主题。
 *
 * 当前策略（对齐 README「v4 视觉固定白底单主题」）：
 *   - 机器草稿 → paper（保持白底，草稿靠封面徽标/页脚/文件名区分，不改配色）
 *   - 其余 → paper
 *
 * 保留函数形态是为了后续「按方向着色」等演进时，调用方不用改。
 */
export function paperThemeAdapter(_content: DailyReportContent): ThemeTokens {
  return DEFAULT_THEME;
}

/** 组合入口：优先显式 theme，其次内容推断 */
export function resolveTheme(
  content: DailyReportContent,
  explicitThemeId?: string | null,
): ThemeTokens {
  if (explicitThemeId) return themeFromId(explicitThemeId);
  return paperThemeAdapter(content);
}

export { getEngineTheme };
export type { ThemeTokens, BriefingTheme };
