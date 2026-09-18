/**
 * 容量预算契约（M4）
 * 每个页型在 capacity() 中声明各插槽预算，生成管线在成稿阶段校验
 * 超限处理顺序不可颠倒：LLM 压缩 → 字号降档 → 截断兜底 → 报警
 */

export type SlotBudget = {
  slot: string;
  maxChars?: number;
  maxLines?: number;
  maxItems?: number;
};

export type CapacityOverflowKind = 'chars' | 'lines' | 'items';

export type CapacityOverflow = {
  slot: string;
  kind: CapacityOverflowKind;
  actual: number;
  budget: number;
  /** compress = 该回炉压缩；truncate = 条目级截断即可 */
  action: 'compress' | 'truncate';
};

export type CapacityCheck = {
  ok: boolean;
  overflows: CapacityOverflow[];
};
