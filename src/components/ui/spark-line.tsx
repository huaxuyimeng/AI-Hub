/**
 * 自绘 SVG 折线图（无第三方库）
 *
 * 来源：原 src/app/(app)/usage/page.tsx §SparkLine
 * 改进：
 *   - 修正 X 轴分布：用等距抽样，最多 6 个 label + 首尾必显
 *   - 修正 i==0 时 Math.ceil(labels.length/6) 的取模陷阱
 *   - 所有值都为 0 时显示空态，而非被压平在底部
 *   - 增加 Y 轴最大值的千分位/单位自适应（K/M）
 *   - 修 props 类型 & 注释
 */

import { useMemo } from 'react';

export interface SparkLineSeries {
  label: string;
  color: string;
  values: number[];
}

export interface SparkLineProps {
  series: SparkLineSeries[];
  labels: string[];
  /** 最大显示的 X 轴 label 数（含首尾） */
  maxLabels?: number;
}

const VIEW_W = 800;
const VIEW_H = 200;
const PAD_X = 36;
const PAD_Y = 24;
const GRID_STROKE_OPACITY = 0.1;

export function SparkLine({ series, labels, maxLabels = 6 }: SparkLineProps) {
  // 1. 计算 max
  const allValues = useMemo(() => series.flatMap((s) => s.values), [series]);
  const max = useMemo(() => Math.max(...allValues, 1), [allValues]);
  const allZero = allValues.every((v) => v === 0);

  // 2. 决定哪些 X 轴 label 要显示（等距抽样 + 首尾）
  const visibleLabelIdx = useMemo(() => {
    if (labels.length === 0) return new Set<number>();
    const set = new Set<number>([0, labels.length - 1]);
    const step = Math.max(1, Math.floor(labels.length / Math.max(1, maxLabels - 1)));
    for (let i = step; i < labels.length - 1; i += step) set.add(i);
    return set;
  }, [labels, maxLabels]);

  const innerW = VIEW_W - PAD_X * 2;
  const innerH = VIEW_H - PAD_Y * 2;

  const xFor = (i: number) =>
    labels.length <= 1
      ? PAD_X + innerW / 2
      : PAD_X + (i / (labels.length - 1)) * innerW;
  const yFor = (v: number) => PAD_Y + innerH - (v / max) * innerH;

  // H-13 修复：SVG chart 加 role="img" + aria-label，方便屏幕阅读器描述图表含义
  const ariaLabel = series.length > 0
    ? `${series.map((s) => `${s.label}: ${s.values.join(',')}`).join('; ')}，时间轴: ${labels.join(',')}`
    : '暂无数据';

  return (
    <div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-48 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        {/* 背景网格（5 条） */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={p}
            x1={PAD_X}
            x2={VIEW_W - PAD_X}
            y1={PAD_Y + innerH * p}
            y2={PAD_Y + innerH * p}
            stroke="currentColor"
            strokeOpacity={GRID_STROKE_OPACITY}
            strokeWidth={1}
          />
        ))}

        {/* Y 轴标签（最大 + 0） */}
        <text x={PAD_X - 4} y={PAD_Y + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.5}>
          {formatAxis(max)}
        </text>
        <text
          x={PAD_X - 4}
          y={PAD_Y + innerH}
          textAnchor="end"
          fontSize={10}
          fill="currentColor"
          opacity={0.5}
        >
          0
        </text>

        {/* 全 0 空态 */}
        {allZero && (
          <text
            x={VIEW_W / 2}
            y={VIEW_H / 2}
            textAnchor="middle"
            fontSize={12}
            fill="currentColor"
            opacity={0.4}
          >
            暂无数据
          </text>
        )}

        {/* 折线 + 数据点 */}
        {series.map((s) => {
          const points = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`);
          const pathD = points.length === 0 ? '' : `M ${points.join(' L ')}`;
          return (
            <g key={s.label}>
              <path d={pathD} fill="none" stroke={s.color} strokeWidth={2} />
              {points.map((p, i) => {
                const [x, y] = p.split(',').map(Number);
                return <circle key={i} cx={x} cy={y} r={3} fill={s.color} />;
              })}
            </g>
          );
        })}

        {/* X 轴 label */}
        {labels.map((l, i) => {
          if (!visibleLabelIdx.has(i)) return null;
          return (
            <text
              key={i}
              x={xFor(i)}
              y={VIEW_H - 6}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              opacity={0.5}
            >
              {l}
            </text>
          );
        })}
      </svg>

      {/* 图例 */}
      <div className="mt-2 flex items-center gap-4 text-[11px]">
        {series.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 把 1500 → "1.5K"，1500000 → "1.5M" */
function formatAxis(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
