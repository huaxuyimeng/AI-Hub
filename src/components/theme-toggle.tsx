'use client';

// 外观切换（亮 / 暗）：单按钮循环
// 完整「预设 + DIY + 背景图」用 ThemeSwitcher（设置页 / 顶栏触发）。
//
// 2026-09-11 重设计（按用户反馈）：
//   - 双按钮（radio group） → 单按钮 toggle
//   - 紧凑：与 ThemeSwitcher / 折叠按钮 等宽 30×30，单行高度
//
// 历史：
//   - 2026-08-30：移除"跟随系统"，保留 light/dark
//   - 2026-09-01：H-25 改用 role=radio；H-26 抽出 map
//   - 2026-09-11：再改回单按钮（占位更少，侧栏更整洁）

import { IconSun, IconMoon } from '@tabler/icons-react';
import { useTheme } from './theme-provider';

export function ThemeToggle() {
  const { theme, setMode } = useTheme();
  const isDark = theme.mode === 'dark';

  return (
    <button
      type="button"
      onClick={() => setMode(isDark ? 'light' : 'dark')}
      className={
        'inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border bg-background transition ' +
        'text-muted-foreground hover:bg-accent hover:text-foreground'
      }
      title={isDark ? '切换为浅色' : '切换为暗色'}
      aria-label={isDark ? '切换为浅色' : '切换为暗色'}
    >
      {isDark ? <IconMoon size={14} /> : <IconSun size={14} />}
    </button>
  );
}
