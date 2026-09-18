/**
 * 页型定义契约（M1 + M3 + M7）
 * 页型只产出几何模型，不含任何渲染代码
 * 测量函数通过 PlanContext 注入，页型函数保持无状态、可独立调用与断言
 */

import type { ZodTypeAny } from 'zod';
import type { ThemeTokens } from './theme';
import type { PlacedSlide } from './geometry';
import type { CapacityCheck } from './capacity';

export type MeasureOpts = {
  weight?: number;
  font?: 'cn' | 'num';
};

/** 返回文本宽度（pt） */
export type MeasureWidthFn = (text: string, size: number, opts?: MeasureOpts) => number;

/** 返回文本在给定宽度内折行后的行数 */
export type MeasureLinesFn = (text: string, size: number, boxWidthPt: number, opts?: MeasureOpts) => number;

export type PlanContext = {
  theme: ThemeTokens;
  pageNo: number;
  totalPages: number;
  measureWidth: MeasureWidthFn;
  measureLines: MeasureLinesFn;
};

export type PageTypeDefinition = {
  /** 'cover' | 'overview' | ...，注册表 key */
  key: string;
  /** 人读名 */
  title: string;
  /** M1：该页型内容契约 */
  contentSchema: ZodTypeAny;
  /** M3：插槽声明，lint 定位与文档化用 */
  slots: string[];
  /** M4：内容对预算的校验结果 */
  capacity: (content: unknown, theme: ThemeTokens) => CapacityCheck;
  /** 布局唯一实现：content → 几何模型 */
  plan: (content: unknown, ctx: PlanContext) => PlacedSlide;
};
