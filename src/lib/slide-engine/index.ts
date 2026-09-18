/**
 * slide-engine 公共出口
 * 引擎不含任何业务字段；早报等模板包只允许从这里导入
 */

export type {
  ThemeTokens,
  TypeScaleKey,
  TypeStyle,
} from './contracts/theme';
export { PAGE_16_9 } from './contracts/theme';
export type {
  Box,
  BoxKind,
  TextMeta,
  PlacedBox,
  PlacedSlide,
} from './contracts/geometry';
export type {
  SlotBudget,
  CapacityOverflow,
  CapacityOverflowKind,
  CapacityCheck,
} from './contracts/capacity';
export type {
  LintRuleId,
  LintLevel,
  LintIssue,
  LintReport,
} from './contracts/lint';
export { SlideIRSchema, SlidePlanEntrySchema } from './contracts/slide-ir';
export type { SlideIR, SlidePlanEntry } from './contracts/slide-ir';
export type {
  MeasureOpts,
  MeasureWidthFn,
  MeasureLinesFn,
  PlanContext,
  PageTypeDefinition,
} from './contracts/page-type';
export {
  registerPageType,
  getPageType,
  hasPageType,
  listPageTypes,
  clearPageTypes,
} from './registry/registry';
export {
  measureWidth,
  measureLines,
  measureTextHeight,
} from './layout/measure';
export { passCapacity, checkCapacity } from './layout/capacity';
export type { SlotMeasured } from './layout/capacity';
export { nextSmallerSize, dropTail } from './layout/degrade';
export { lintSlide, lintDeck } from './qa/lint';
export type { LintOptions } from './qa/lint';
export {
  runQAGate,
  checkQA,
  checkSlide,
  isQAPassed,
  getErrorCount,
  getWarnCount,
  formatQAReport,
} from './qa/gate';
export type { QAGateOptions } from './qa/gate';

// 渲染器
export { renderDeckPptx, renderDeckToBuffer } from './render/pptx';
export { SlideCanvas, DeckPreview } from './render/web';
export type { SlideCanvasProps, DeckPreviewProps } from './render/web';
