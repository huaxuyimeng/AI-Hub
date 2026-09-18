/**
 * 几何模型契约（M5 与 M6 的共同基础）
 * PlacedSlide 是布局的唯一真相：lint 跑在它上面，pptx 与 web 两个渲染器都只翻译它
 * 约定：盒子矩形即内容可用区域，内边距由规划器在计算时先扣除
 */

import type { CapacityCheck } from './capacity';

export type Box = {
  /** pt，左上原点 */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BoxKind = 'text' | 'card' | 'badge' | 'bar' | 'table' | 'image' | 'divider';

export type TextMeta = {
  value: string;
  font: 'cn' | 'num';
  /** pt */
  size: number;
  weight: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  /** hex 带 # */
  color: string;
  /** 行数上限，L2 依据 */
  maxLines: number;
};

export type PlacedBox = {
  /** 页内唯一，lint 定位用 */
  id: string;
  /** 插槽名，如 header / bullet-1 / page-no */
  slot: string;
  kind: BoxKind;
  box: Box;
  z: number;
  /** 装饰性元素：允许被重叠、不参与安全区检查 */
  decorative?: boolean;
  /** 页脚等有意贴近边缘的元素：跳过安全区检查，但仍受画布边界约束 */
  allowUnsafe?: boolean;
  fill?: string;
  radius?: number;
  borderColor?: string;
  text?: TextMeta;
  /** kind 为 table 时的单元格文本 */
  cells?: TextMeta[][];
};

export type PlacedSlide = {
  pageNo: number;
  totalPages: number;
  pageType: string;
  boxes: PlacedBox[];
  /** 页型 capacity() 的结果，由管线装配时附上，L4 依据 */
  capacity?: CapacityCheck;
};
