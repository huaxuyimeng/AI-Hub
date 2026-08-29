'use client';

// 三态外观切换：浅色 / 暗色 / 跟随系统。
// 完整「预设 + DIY + 背景图」用 ThemeSwitcher（设置页 / 顶栏触发）。

import { IconSun, IconMoon, IconDeviceLaptop } from '@tabler/icons-react';
import { useTheme } from './theme-provider';

export function ThemeToggle() {
  const { theme, setMode } = useTheme();
  const Icon = theme.mode === 'light' ? IconSun : theme.mode === 'dark' ? IconMoon : IconDeviceLaptop;
  const label = theme.mode === 'light' ? '浅色' : theme.mode === 'dark' ? '暗色' : '跟随系统';

  const next = theme.mode === 'light' ? 'dark' : theme.mode === 'dark' ? 'system' : 'light';

  return (
    <button
      type="button"
      aria-label={`当前：${label}（点击切换）`}
      onClick={() => setMode(next)}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground hover:bg-accent transition-colors"
    >
      <Icon size={16} />
    </button>
  );
}