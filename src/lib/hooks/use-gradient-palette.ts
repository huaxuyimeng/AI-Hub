'use client';

/**
 * useGradientPalette — 用户级"氛围光晕"调色板选择
 *
 * 持久化策略：localStorage 即时 + window CustomEvent 同步（不依赖后端）
 * 因为这是纯 UI 氛围偏好，跨设备同步优先级低；后端 schema 不增加字段。
 *
 * 枚举：
 *   'auto'    随机（每 25s 切换）
 *   'glacier' 冰川    - 冷蓝紫
 *   'dusk'    黄昏    - 暖落日
 *   'moss'    苔藓    - 自然绿
 *   'aurora'  极光    - 青绿紫
 *   'velvet'  丝绒    - 浓郁紫红
 *   'mist'    晨雾    - 淡雅浅色
 */

import { useEffect, useState, useCallback } from 'react';

export const GRADIENT_PALETTE_NAMES = [
  'auto',
  'glacier',
  'dusk',
  'moss',
  'aurora',
  'velvet',
  'mist',
] as const;

export type GradientPaletteName = (typeof GRADIENT_PALETTE_NAMES)[number];

const STORAGE_KEY = 'aihub-gradient-palette';
const EVENT_NAME = 'aihub-gradient-palette-change';

function isValidPalette(value: unknown): value is GradientPaletteName {
  return typeof value === 'string' && (GRADIENT_PALETTE_NAMES as readonly string[]).includes(value);
}

function readStorage(): GradientPaletteName {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isValidPalette(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

function writeStorage(value: GradientPaletteName): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // quota / privacy mode：忽略
  }
}

/**
 * 当前用户选择 + setter
 *
 * 用法：
 *   const [palette, setPalette] = useGradientPalette();
 *   setPalette('aurora');   // 锁定极光
 *   setPalette('auto');     // 恢复随机
 */
export function useGradientPalette(): [
  GradientPaletteName,
  (next: GradientPaletteName) => void,
] {
  const [name, setName] = useState<GradientPaletteName>('auto');

  // 初次挂载 + 监听其他组件的修改（同步多实例）
  useEffect(() => {
    setName(readStorage());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<GradientPaletteName>).detail;
      if (isValidPalette(detail)) setName(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const set = useCallback((next: GradientPaletteName) => {
    setName(next);
    writeStorage(next);
    window.dispatchEvent(new CustomEvent<GradientPaletteName>(EVENT_NAME, { detail: next }));
  }, []);

  return [name, set];
}

/** 调色板的展示信息（名字 + 中文标签），给 UI 使用 */
export const GRADIENT_PALETTE_META: Record<GradientPaletteName, { label: string; emoji?: string }> = {
  auto: { label: '自动' },
  glacier: { label: '冰川' },
  dusk: { label: '黄昏' },
  moss: { label: '苔藓' },
  aurora: { label: '极光' },
  velvet: { label: '丝绒' },
  mist: { label: '晨雾' },
};
