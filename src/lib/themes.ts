// 来源：.cursor/skills/workbench-ui-designer/SKILL.md §4 配色系统
// 6 套预设主题 + HSL DIY 强调色 + 背景图持久化
// 浏览器兼容性：现代浏览器原生支持 OKLCH；老浏览器降级到 HSL。

export type ThemePreset = 'paper' | 'ink' | 'mint' | 'lavender' | 'amber' | 'ocean';

export interface AccentHSL {
  /** 0-360 */
  h: number;
  /** 0-100 */
  s: number;
  /** 30-80, 默认 55 */
  l: number;
}

/** 单个预设的 OKLCH 值，浅色 + 暗色 */
export interface PresetTokens {
  preset: ThemePreset;
  name: string;
  description: string;
  light: Palette;
  dark: Palette;
}

/** 一套色板 */
export interface Palette {
  background: string;
  foreground: string;
  surface: string;
  surfaceElevated: string;
  muted: string;
  mutedForeground: string;
  border: string;
  ring: string;
  accent: string;
  accentFg: string;
  destructive: string;
  success: string;
  warning: string;
}

export const PRESETS: Record<ThemePreset, PresetTokens> = {
  paper: {
    preset: 'paper',
    name: '纸面奶白',
    description: '默认 · 温暖纸感',
    light: {
      background: 'oklch(98.5% 0.005 90)',
      foreground: 'oklch(22% 0.015 250)',
      surface: 'oklch(100% 0 0 / 0.6)',
      surfaceElevated: 'oklch(100% 0 0)',
      muted: 'oklch(96% 0.008 90)',
      mutedForeground: 'oklch(50% 0.015 250)',
      border: 'oklch(92% 0.01 90)',
      ring: 'oklch(72% 0.14 65)',
      accent: 'oklch(72% 0.14 65)',
      accentFg: 'oklch(20% 0.05 65)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(78% 0.15 75)',
    },
    dark: {
      background: 'oklch(18% 0.012 250)',
      foreground: 'oklch(95% 0.008 90)',
      surface: 'oklch(22% 0.012 250 / 0.7)',
      surfaceElevated: 'oklch(24% 0.012 250)',
      muted: 'oklch(26% 0.012 250)',
      mutedForeground: 'oklch(70% 0.012 250)',
      border: 'oklch(30% 0.015 250)',
      ring: 'oklch(75% 0.16 65)',
      accent: 'oklch(75% 0.16 65)',
      accentFg: 'oklch(15% 0.02 65)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(78% 0.15 75)',
    },
  },
  ink: {
    preset: 'ink',
    name: '墨韵深褐',
    description: '文人风 · 暖褐',
    light: {
      background: 'oklch(97% 0.008 60)',
      foreground: 'oklch(20% 0.02 50)',
      surface: 'oklch(99% 0.005 60 / 0.7)',
      surfaceElevated: 'oklch(99% 0.005 60)',
      muted: 'oklch(94% 0.012 60)',
      mutedForeground: 'oklch(48% 0.02 50)',
      border: 'oklch(90% 0.014 60)',
      ring: 'oklch(60% 0.12 45)',
      accent: 'oklch(60% 0.12 45)',
      accentFg: 'oklch(20% 0.04 45)',
      destructive: 'oklch(56% 0.22 25)',
      success: 'oklch(60% 0.14 145)',
      warning: 'oklch(75% 0.15 70)',
    },
    dark: {
      background: 'oklch(16% 0.018 50)',
      foreground: 'oklch(94% 0.012 60)',
      surface: 'oklch(20% 0.018 50 / 0.7)',
      surfaceElevated: 'oklch(22% 0.018 50)',
      muted: 'oklch(24% 0.018 50)',
      mutedForeground: 'oklch(70% 0.018 50)',
      border: 'oklch(28% 0.02 50)',
      ring: 'oklch(70% 0.14 45)',
      accent: 'oklch(70% 0.14 45)',
      accentFg: 'oklch(15% 0.02 45)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(60% 0.14 145)',
      warning: 'oklch(75% 0.15 70)',
    },
  },
  mint: {
    preset: 'mint',
    name: '薄荷晨雾',
    description: 'WorkBuddy 风 · 清爽',
    light: {
      background: 'oklch(98% 0.012 160)',
      foreground: 'oklch(22% 0.02 170)',
      surface: 'oklch(100% 0 0 / 0.65)',
      surfaceElevated: 'oklch(100% 0 0)',
      muted: 'oklch(95% 0.018 160)',
      mutedForeground: 'oklch(50% 0.02 170)',
      border: 'oklch(91% 0.018 160)',
      ring: 'oklch(70% 0.16 160)',
      accent: 'oklch(70% 0.16 160)',
      accentFg: 'oklch(20% 0.06 160)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.18 150)',
      warning: 'oklch(78% 0.15 75)',
    },
    dark: {
      background: 'oklch(17% 0.02 160)',
      foreground: 'oklch(95% 0.012 160)',
      surface: 'oklch(21% 0.02 160 / 0.7)',
      surfaceElevated: 'oklch(23% 0.02 160)',
      muted: 'oklch(25% 0.02 160)',
      mutedForeground: 'oklch(70% 0.02 160)',
      border: 'oklch(29% 0.022 160)',
      ring: 'oklch(72% 0.18 160)',
      accent: 'oklch(72% 0.18 160)',
      accentFg: 'oklch(15% 0.04 160)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.18 150)',
      warning: 'oklch(78% 0.15 75)',
    },
  },
  lavender: {
    preset: 'lavender',
    name: '紫晶夜读',
    description: 'Hermes 风 · 紫调',
    light: {
      background: 'oklch(98% 0.012 290)',
      foreground: 'oklch(22% 0.03 290)',
      surface: 'oklch(100% 0 0 / 0.65)',
      surfaceElevated: 'oklch(100% 0 0)',
      muted: 'oklch(95% 0.02 290)',
      mutedForeground: 'oklch(50% 0.025 290)',
      border: 'oklch(91% 0.022 290)',
      ring: 'oklch(68% 0.18 290)',
      accent: 'oklch(68% 0.18 290)',
      accentFg: 'oklch(20% 0.08 290)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(78% 0.15 75)',
    },
    dark: {
      background: 'oklch(18% 0.025 290)',
      foreground: 'oklch(95% 0.018 290)',
      surface: 'oklch(22% 0.025 290 / 0.7)',
      surfaceElevated: 'oklch(24% 0.025 290)',
      muted: 'oklch(26% 0.025 290)',
      mutedForeground: 'oklch(70% 0.025 290)',
      border: 'oklch(30% 0.028 290)',
      ring: 'oklch(72% 0.2 290)',
      accent: 'oklch(72% 0.2 290)',
      accentFg: 'oklch(15% 0.05 290)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(78% 0.15 75)',
    },
  },
  amber: {
    preset: 'amber',
    name: '琥珀灯下',
    description: '暖夜 · 琥珀',
    light: {
      background: 'oklch(97% 0.02 75)',
      foreground: 'oklch(22% 0.025 65)',
      surface: 'oklch(99% 0.01 75 / 0.7)',
      surfaceElevated: 'oklch(99% 0.01 75)',
      muted: 'oklch(94% 0.025 75)',
      mutedForeground: 'oklch(48% 0.03 65)',
      border: 'oklch(90% 0.028 75)',
      ring: 'oklch(72% 0.16 65)',
      accent: 'oklch(72% 0.16 65)',
      accentFg: 'oklch(20% 0.06 65)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(80% 0.18 75)',
    },
    dark: {
      background: 'oklch(16% 0.025 65)',
      foreground: 'oklch(94% 0.018 75)',
      surface: 'oklch(20% 0.025 65 / 0.7)',
      surfaceElevated: 'oklch(22% 0.025 65)',
      muted: 'oklch(24% 0.025 65)',
      mutedForeground: 'oklch(70% 0.025 65)',
      border: 'oklch(28% 0.028 65)',
      ring: 'oklch(75% 0.18 65)',
      accent: 'oklch(75% 0.18 65)',
      accentFg: 'oklch(15% 0.04 65)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(80% 0.18 75)',
    },
  },
  ocean: {
    preset: 'ocean',
    name: '海盐青蓝',
    description: 'Cursor 蓝 · 冷调',
    light: {
      background: 'oklch(98% 0.008 220)',
      foreground: 'oklch(22% 0.025 230)',
      surface: 'oklch(100% 0 0 / 0.65)',
      surfaceElevated: 'oklch(100% 0 0)',
      muted: 'oklch(95% 0.018 220)',
      mutedForeground: 'oklch(50% 0.025 230)',
      border: 'oklch(91% 0.018 220)',
      ring: 'oklch(68% 0.16 230)',
      accent: 'oklch(68% 0.16 230)',
      accentFg: 'oklch(20% 0.06 230)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(78% 0.15 75)',
    },
    dark: {
      background: 'oklch(17% 0.025 220)',
      foreground: 'oklch(95% 0.015 220)',
      surface: 'oklch(21% 0.025 220 / 0.7)',
      surfaceElevated: 'oklch(23% 0.025 220)',
      muted: 'oklch(25% 0.025 220)',
      mutedForeground: 'oklch(70% 0.025 220)',
      border: 'oklch(29% 0.028 220)',
      ring: 'oklch(72% 0.18 230)',
      accent: 'oklch(72% 0.18 230)',
      accentFg: 'oklch(15% 0.04 230)',
      destructive: 'oklch(58% 0.22 25)',
      success: 'oklch(65% 0.15 145)',
      warning: 'oklch(78% 0.15 75)',
    },
  },
};

export const PRESET_LIST: PresetTokens[] = Object.values(PRESETS);

/** 预设 + 强调色 → 一组完整 CSS 变量 */
export function buildTokens(preset: ThemePreset, accent?: AccentHSL | null): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const tokens = PRESETS[preset];
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};

  // 1. 写入整套预设色板
  for (const key of Object.keys(tokens.light) as (keyof Palette)[]) {
    light[`--${camelToKebab(key)}`] = tokens.light[key];
    dark[`--${camelToKebab(key)}`] = tokens.dark[key];
  }

  // 2. 用 accent 覆盖 accent / ring / accentFg
  //    注意：--accent 与 --accent-fg 必须是 HSL 三元组（"H S% L%"），
  //    因为 Tailwind 配置里它们被 hsl(var(--accent)) 包裹使用（见 tailwind.config.ts）。
  //    --ring 直接以 var(--ring) 读取，所以可以保持完整 hsl() 值。
  if (accent) {
    const lightAccent = hslToCss(accent.h, accent.s, accent.l);              // 给 --ring 用（var(--ring) 直读，需要完整 hsl()）
    const darkAccent = hslToCss(accent.h, accent.s, Math.max(40, accent.l + 5));
    light['--accent'] = hslTriplet(accent.h, accent.s, accent.l);              // 三元组，被 hsl(var(--accent)) 包裹
    light['--ring'] = lightAccent;
    light['--accent-fg'] = hslTriplet(accent.h, accent.s, 20);
    dark['--accent'] = hslTriplet(accent.h, accent.s, Math.max(40, accent.l + 5));
    dark['--ring'] = darkAccent;
    dark['--accent-fg'] = hslTriplet(accent.h, accent.s, 15);
  }

  return { light, dark };
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

function hslToCss(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
}

/** HSL 三元组（不带 hsl() 包装），用于被 hsl(var(--token)) 再次包裹的变量（--accent / --accent-fg） */
function hslTriplet(h: number, s: number, l: number): string {
  return `${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%`;
}

/** localStorage 兼容：旧值（"light"/"dark"/"system"）映射成新结构 */
export interface StoredTheme {
  preset: ThemePreset;
  mode: 'light' | 'dark' | 'system';
  accent: AccentHSL | null;
  bgUrl: string | null;
}

export const DEFAULT_THEME: StoredTheme = {
  preset: 'paper',
  mode: 'system',
  accent: null,
  bgUrl: null,
};

const STORAGE_KEY = 'aihub-theme-v2';

export function readStoredTheme(): StoredTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<StoredTheme>;
    if (parsed.preset && PRESETS[parsed.preset as ThemePreset]) {
      return {
        preset: parsed.preset,
        mode: parsed.mode ?? 'system',
        accent: parsed.accent ?? null,
        bgUrl: parsed.bgUrl ?? null,
      };
    }
  } catch {
    // 旧值（字符串）fallback
    try {
      const old = localStorage.getItem('aihub-theme');
      if (old === 'light' || old === 'dark') {
        return { ...DEFAULT_THEME, mode: old };
      }
    } catch (err) {
      console.warn('[theme] readStoredTheme parse error:', err);
    }
  }
  return DEFAULT_THEME;
}

export function writeStoredTheme(t: StoredTheme) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch (err) {
    console.warn('[theme] writeStoredTheme failed:', err);
  }
}