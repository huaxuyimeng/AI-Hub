/**
 * 降级阶梯工具（M4）：压缩由 LLM 管线负责，这里提供字号降档与条目裁剪
 * 顺序不可颠倒：LLM 压缩 → 字号降档 → 截断兜底
 */

import type { ThemeTokens } from '../contracts/theme';

/** 在主题字号档位中取比 size 更小的最近一档；没有更小档返回 null */
export function nextSmallerSize(theme: ThemeTokens, size: number): number | null {
  const sizes = Array.from(new Set(Object.values(theme.type).map((t) => t.size)))
    .sort((a, b) => b - a);
  for (const s of sizes) {
    if (s < size) return s;
  }
  return null;
}

/** 条目级截断（整条去掉），被裁条数供 lint 记警告 */
export function dropTail<T>(items: T[], maxCount: number): { items: T[]; dropped: number } {
  if (items.length <= maxCount) return { items, dropped: 0 };
  return { items: items.slice(0, maxCount), dropped: items.length - maxCount };
}
