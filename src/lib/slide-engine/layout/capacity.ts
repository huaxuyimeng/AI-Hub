/**
 * 容量检查（M4）：实测值对预算的纯函数校验
 */

import type { CapacityCheck, CapacityOverflow, SlotBudget } from '../contracts/capacity';

export type SlotMeasured = {
  slot: string;
  chars?: number;
  lines?: number;
  items?: number;
};

export function passCapacity(): CapacityCheck {
  return { ok: true, overflows: [] };
}

export function checkCapacity(measured: SlotMeasured[], budgets: SlotBudget[]): CapacityCheck {
  const overflows: CapacityOverflow[] = [];
  for (const m of measured) {
    const budget = budgets.find((b) => b.slot === m.slot);
    if (!budget) continue;
    if (budget.maxChars != null && m.chars != null && m.chars > budget.maxChars) {
      overflows.push({ slot: m.slot, kind: 'chars', actual: m.chars, budget: budget.maxChars, action: 'compress' });
    }
    if (budget.maxLines != null && m.lines != null && m.lines > budget.maxLines) {
      overflows.push({ slot: m.slot, kind: 'lines', actual: m.lines, budget: budget.maxLines, action: 'compress' });
    }
    if (budget.maxItems != null && m.items != null && m.items > budget.maxItems) {
      overflows.push({ slot: m.slot, kind: 'items', actual: m.items, budget: budget.maxItems, action: 'truncate' });
    }
  }
  return { ok: overflows.length === 0, overflows };
}
