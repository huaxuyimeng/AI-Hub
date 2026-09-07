'use client';

// 双按钮外观切换：浅色 / 暗色。
// 完整「预设 + DIY + 背景图」用 ThemeSwitcher（设置页 / 顶栏触发）。
//
// 2026-08-30 重设计（按用户反馈）：
//   - 移除"跟随系统"循环（mode 选项只保留 light/dark）
//   - 1 个三态循环按钮 → 2 个独立按钮（一键切换）
//
// 2026-09-01 修复：
//   - H-25：互斥语义 → role="radiogroup" + role="radio" + aria-checked
//     （原 aria-pressed 在互斥场景下语义不准）
//   - H-26：compact / 非 compact 两套按钮之前是 ~80 行复制粘贴，
//     改成数据驱动（MODE_BUTTONS.map）共用同一份渲染函数。
//   - SSR/CSR mismatch：mounted 后再读 window.matchMedia。

import { useEffect, useState } from 'react';
import * as React from 'react';
import { IconSun, IconMoon, type IconProps } from '@tabler/icons-react';
import { useTheme } from './theme-provider';

type Mode = 'light' | 'dark';

interface ModeDef {
  value: Mode;
  label: string;
  Icon: React.ComponentType<IconProps>;
}

const MODE_BUTTONS: ModeDef[] = [
  { value: 'light', label: '浅色', Icon: IconSun },
  { value: 'dark', label: '暗色', Icon: IconMoon },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setMode } = useTheme();
  const isLight = theme.mode === 'light';
  const isDark = theme.mode === 'dark';

  // ★ 修复 hydration mismatch：
  //   SSR 时无法读 window，统一用 isLight 兜底；
  //   客户端 mounted 后再根据系统偏好补回。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const systemLight =
    mounted &&
    !isLight &&
    !isDark &&
    typeof window !== 'undefined' &&
    !window.matchMedia('(prefers-color-scheme: dark)').matches;

  // effectiveMode = 实际生效的模式（system 跟随系统），用于 radio 高亮
  const effectiveMode: Mode | null = isLight
    ? 'light'
    : isDark
    ? 'dark'
    : systemLight
    ? 'light'
    : null;

  const buttonSize = compact ? 'h-7 w-7' : 'h-9 w-9';
  const iconSize = compact ? 12 : 14;

  // H-26 修复：compact 与非 compact 用同一份 map 渲染
  return (
    <div
      role="radiogroup"
      aria-label="切换外观"
      className={
        (compact ? 'flex-col items-center ' : 'inline-flex items-center ') +
        'overflow-hidden rounded-md border bg-background'
      }
    >
      {MODE_BUTTONS.map((btn, i) => {
        const checked = effectiveMode === btn.value;
        return (
          <div key={btn.value} className="flex items-center">
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={btn.label}
              tabIndex={checked || (effectiveMode === null && i === 0) ? 0 : -1}
              onClick={() => setMode(btn.value)}
              className={
                `inline-flex ${buttonSize} items-center justify-center transition ` +
                (checked
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground')
              }
              title={btn.label}
            >
              <btn.Icon size={iconSize} />
            </button>
            {i < MODE_BUTTONS.length - 1 && (
              <span
                className={(compact ? 'h-px w-5' : 'h-5 w-px') + ' bg-border'}
                aria-hidden
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
