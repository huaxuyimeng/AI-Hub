/**
 * lint 报告契约（M5）
 * 规则定义见重构设计方案 6.1：
 * L1 越界 / L2 溢出 / L3 重叠 / L4 容量 / L5 页数一致 / L6 密度 / L7 字号栅格
 */

export type LintRuleId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7';

export type LintLevel = 'error' | 'warn';

export type LintIssue = {
  rule: LintRuleId;
  pageNo: number;
  boxId?: string;
  level: LintLevel;
  /** 人读说明，含预算数值 */
  detail: string;
};

export type LintReport = {
  issues: LintIssue[];
  /** 无 error 级问题即为通过（warn 不阻塞） */
  passed: boolean;
};
