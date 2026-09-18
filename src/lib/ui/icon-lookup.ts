/**
 * 通用图标查表 Hook
 *
 * @param name Tabler icon 名（如 'IconTarget' / 'IconShield'）
 * @returns React 组件；找不到返回 undefined（fallback 给 IconSparkles）
 *
 * 来源：原本在 ExpertMarketCard / ExpertSelectorDrawer / MyExpertCard 等多处复制粘贴，
 *      统一收口到这里。
 */

'use client';

import * as TablerIcons from '@tabler/icons-react';

type IconComp = React.ComponentType<{ size?: number; stroke?: number }>;

export function iconLookup(name: string): IconComp | undefined {
  const map = TablerIcons as unknown as Record<string, IconComp>;
  return map[name];
}

/** 等价写法：use 版本（如果将来需要 memo，扩展时改） */
export function useIconLookup(name: string): IconComp | undefined {
  return iconLookup(name);
}
