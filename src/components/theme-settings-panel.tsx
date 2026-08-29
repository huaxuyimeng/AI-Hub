'use client';

// 来源：.cursor/skills/workbench-ui-designer §6.1
// 给 Settings 页提供一个独立的主题设置入口（sidebar 之外）

import { useTheme } from './theme-provider';
import { ThemeSwitcher } from './theme/theme-switcher';

export function ThemeSettingsPanel() {
  const { theme } = useTheme();

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
      <div>
        <div className="text-sm font-medium">主题</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          当前：{theme.preset} · {theme.mode === 'system' ? '跟随系统' : theme.mode === 'dark' ? '暗色' : '浅色'}
          {theme.accent ? ' · 自定义强调色' : ''}
          {theme.bgUrl ? ' · 自定义背景图' : ''}
        </div>
      </div>
      <ThemeSwitcher />
    </div>
  );
}