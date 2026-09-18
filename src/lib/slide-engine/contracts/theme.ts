/**
 * 主题 Token 契约（M2）
 * 单位统一 pt（1in = 72pt），画布 16:9 为 960 × 540
 * 所有页面代码只读 token，禁止散落硬编码色值与字号
 *
 * v2（2026-09-13）：扩展色域以支持早报视觉系统的所有需求
 *   - textMuted/textSubtle/textFaint：文字三档（深/中/浅）
 *   - primaryDark/secondaryDark/accentDark：3 主色的深色变体
 *   - accentText：accent 上的文字色（amber 系配深棕）
 *   - lightBlue/lightCyan/lightAmber：3 主色的浅底（同族浅底）
 *   - bgCard：卡片底色
 *   - borderLight：浅边框
 *   - linkBlue：链接色
 * 所有原 token（primary/secondary/accent/ink/inkMuted/inkSubtle/surface/border）保持不变。
 */

/**
 * 字号层级 key。
 *
 * 9 级栅格（对齐参考稿 DESIGN.md 的「7 级正文层级 + 数字/锚点」，
 * 按 1280px → 960pt 折算 ×0.75）：
 *   mega     88  巨型锚点（参考 72-120px → 54-90pt）
 *   display  52  封面主标 / 章节大字（参考 64-72px → 48-54pt）
 *   h1       26  页标题（参考 32-36px → 24-27pt）
 *   h2       20  区块标题（参考 22-26px 上限）
 *   h3       16  卡片小标题（参考 22-26px 下限）
 *   body     13  正文（参考 18-22px → 13.5-16.5pt，取保守下限）
 *   caption  11  副标题 / 说明（参考 脚注 14px → 10.5pt）
 *   micro     9  标签 / 页码
 *   number   32  指标数字
 *
 * 任何页面 text.size 都必须取值于栅格（lint L7 守卫）。
 */
export type TypeScaleKey =
  | 'mega'
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'caption'
  | 'micro'
  | 'number';

export type TypeStyle = {
  /** pt */
  size: number;
  weight: 400 | 600 | 700;
  /** 行高倍数 */
  lineHeight: number;
};

export type ThemeTokens = {
  id: string;
  colors: {
    // === 基础三主色（hex 带 #） ===
    primary: string;
    secondary: string;
    accent: string;
    /** 同族浅底 */
    primarySoft: string;
    secondarySoft: string;
    accentSoft: string;
    // === 文字三档 ===
    ink: string;
    inkMuted: string;
    inkSubtle: string;
    surface: string;
    border: string;
    // === v2 新增：早报视觉系统所需的全量色 ===
    /** 文字深色（同 ink 别名；SlidePreview 沿用 text 字段） */
    text: string;
    textMuted: string;
    textSubtle: string;
    textFaint: string;
    primaryDark: string;
    secondaryDark: string;
    accentDark: string;
    /** accent 上的文字色（amber 系配深棕 #92400E） */
    accentText: string;
    lightBlue: string;
    lightCyan: string;
    lightAmber: string;
    bgCard: string;
    borderLight: string;
    linkBlue: string;
  };
  fonts: {
    cn: string;
    num: string;
  };
  type: Record<TypeScaleKey, TypeStyle>;
  page: {
    width: number;
    height: number;
  };
  margin: {
    x: number;
    y: number;
  };
};

/** 默认派生色（基于基础三主色 + ink 计算） */
export function deriveExtendedColors(t: Pick<ThemeTokens, 'colors'>): ThemeTokens['colors'] {
  const c = t.colors;
  return {
    ...c,
    text: c.ink,
    textMuted: c.inkMuted,
    textSubtle: c.inkSubtle,
    textFaint: '#94A3B8',
    primaryDark: c.primaryDark ?? '#2563EB',
    secondaryDark: c.secondaryDark ?? '#0891B2',
    accentDark: c.accentDark ?? '#D97706',
    accentText: c.accentText ?? '#92400E',
    lightBlue: c.lightBlue ?? c.primarySoft,
    lightCyan: c.lightCyan ?? c.secondarySoft,
    lightAmber: c.lightAmber ?? c.accentSoft,
    bgCard: c.bgCard ?? '#F8FAFC',
    borderLight: c.borderLight ?? '#EEF2F7',
    linkBlue: c.linkBlue ?? '#1D4ED8',
  };
}

export const PAGE_16_9 = { width: 960, height: 540 } as const;
