/**
 * 页型注册表（M3）
 * 新增页型 = 注册一个新定义，零核心改动
 */

import type { PageTypeDefinition } from '../contracts/page-type';

const registry = new Map<string, PageTypeDefinition>();

export function registerPageType(def: PageTypeDefinition): void {
  if (registry.has(def.key)) {
    throw new Error(`页型重复注册：${def.key}`);
  }
  registry.set(def.key, def);
}

export function getPageType(key: string): PageTypeDefinition {
  const def = registry.get(key);
  if (!def) {
    throw new Error(`页型未注册：${key}`);
  }
  return def;
}

export function hasPageType(key: string): boolean {
  return registry.has(key);
}

export function listPageTypes(): PageTypeDefinition[] {
  return Array.from(registry.values());
}

/** 测试与模板包重载场景用 */
export function clearPageTypes(): void {
  registry.clear();
}
