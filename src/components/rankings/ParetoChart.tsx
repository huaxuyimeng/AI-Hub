/**
 * 帕累托图组件（SVG 原生实现）
 *
 * 来源：整合 plan §4.4
 * 功能：
 *   - 对数价格轴（横轴）
 *   - 线性能力分轴（纵轴）
 *   - 帕累托前沿高亮 + 连线
 *   - 点击散点跳转详情
 */

'use client';

import { useMemo } from 'react';

interface ParetoPoint {
  id: string;
  name: string;
  priceInput: number;
  intelligence: number;
}

interface ParetoChartProps {
  data: ParetoPoint[];
  onSelect: (id: string) => void;
}

const WIDTH = 700;
const HEIGHT = 380;
const PADDING = { top: 30, right: 30, bottom: 50, left: 60 };

export function ParetoChart({ data, onSelect }: ParetoChartProps) {
  const computed = useMemo(() => {
    // 过滤有效数据点：必须有价格 + 能力分
    const valid = data.filter((d) => d.priceInput > 0 && d.intelligence > 0);
    const hasPrice = data.some((d) => d.priceInput > 0);
    const hasIntel = data.some((d) => d.intelligence > 0);
    if (valid.length === 0) {
      return { kind: 'empty' as const, hasPrice, hasIntel };
    }

    // 对数价格轴范围
    const minPrice = Math.min(...valid.map((d) => d.priceInput));
    const maxPrice = Math.max(...valid.map((d) => d.priceInput));
    const minLog = Math.log10(Math.max(minPrice, 0.01));
    const maxLog = Math.log10(Math.max(maxPrice, 1));

    // 能力分范围
    const minIntel = 0;
    const maxIntel = Math.max(...valid.map((d) => d.intelligence), 100);

    // 坐标映射
    const xScale = (price: number) => {
      const log = Math.log10(Math.max(price, 0.01));
      return PADDING.left + ((log - minLog) / (maxLog - minLog || 1)) * (WIDTH - PADDING.left - PADDING.right);
    };
    const yScale = (intel: number) => {
      return PADDING.top + (1 - (intel - minIntel) / (maxIntel - minIntel)) * (HEIGHT - PADDING.top - PADDING.bottom);
    };

    // 计算帕累托前沿（按价格升序，每个价位能力最高点）
    const sorted = [...valid].sort((a, b) => a.priceInput - b.priceInput);
    const frontier: ParetoPoint[] = [];
    let maxAbility = 0;
    for (const p of sorted) {
      if (p.intelligence > maxAbility) {
        frontier.push(p);
        maxAbility = p.intelligence;
      }
    }
    const frontierIds = new Set(frontier.map((f) => f.id));

    // X 轴刻度
    const ticks = [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100];
    const visibleTicks = ticks.filter((t) => t >= minPrice && t <= maxPrice);

    // 引线 y 偏移（避让重名）：根据相邻前沿点的 x 距离决定引线方向
    const labelOffsets = new Map<string, number>();
    const sortedFrontier = [...frontier].sort((a, b) => a.priceInput - b.priceInput);
    sortedFrontier.forEach((p, i) => {
      const prev = sortedFrontier[i - 1];
      const dx = prev ? Math.abs(xScale(p.priceInput) - xScale(prev.priceInput)) : Infinity;
      labelOffsets.set(p.id, dx < 80 ? -16 : -10);
    });

    return { kind: 'ok' as const, valid, xScale, yScale, maxIntel, frontier, frontierIds, visibleTicks, labelOffsets };
  }, [data]);

  if (computed.kind === 'empty') {
    const reason = !computed.hasPrice
      ? '暂无可用价格数据（首次抓取后开始记录）'
      : !computed.hasIntel
      ? '暂无能力分数据（刷新数据后接入 AA 评分）'
      : '暂无有效的模型数据（需要同时具有价格和能力分）';
    return (
      <div className="mb-6 rounded-lg border bg-card p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">能力-价格 帕累托图</h3>
        </div>
        <div className="py-10 text-center text-sm text-muted-foreground">{reason}</div>
      </div>
    );
  }

  const { valid, xScale, yScale, maxIntel, frontier, frontierIds, visibleTicks, labelOffsets } = computed;

  return (
    <div className="mb-6 rounded-lg border bg-card p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">能力-价格 帕累托图</h3>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            帕累托前沿
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
            其他模型
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`能力-价格帕累托图，共 ${valid.length} 个模型`}
      >
        <title>AI 模型能力-价格帕累托前沿</title>
        <desc>
          横轴为输入价格（USD/百万 tokens，对数刻度），纵轴为能力分。前沿点为同价位下能力最高的模型。
          点击任意点查看详情；下方表格提供键盘可达的完整数据。
        </desc>
        {/* 网格线 — C-12 修复：Y 轴 tick 派生自 maxIntel，避免能力分 > 100 时网格超出可视区 */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={p}
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={yScale(maxIntel * p)}
            y2={yScale(maxIntel * p)}
            stroke="currentColor"
            strokeOpacity={0.1}
          />
        ))}

        {/* Y 轴标签 */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <text
            key={p}
            x={PADDING.left - 8}
            y={yScale(maxIntel * p) + 4}
            textAnchor="end"
            fontSize={10}
            fill="currentColor"
            opacity={0.6}
          >
            {Math.round(maxIntel * p)}
          </text>
        ))}
        <text
          x={15}
          y={HEIGHT / 2}
          transform={`rotate(-90, 15, ${HEIGHT / 2})`}
          textAnchor="middle"
          fontSize={11}
          fill="currentColor"
          opacity={0.8}
        >
          能力分
        </text>

        {/* X 轴 */}
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={HEIGHT - PADDING.bottom}
          y2={HEIGHT - PADDING.bottom}
          stroke="currentColor"
          strokeOpacity={0.3}
        />
        {/* X 轴标签（对数价格） */}
        {visibleTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={xScale(tick)}
              x2={xScale(tick)}
              y1={HEIGHT - PADDING.bottom}
              y2={HEIGHT - PADDING.bottom + 4}
              stroke="currentColor"
              strokeOpacity={0.4}
            />
            <text
              x={xScale(tick)}
              y={HEIGHT - PADDING.bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              ${tick}
            </text>
          </g>
        ))}
        <text
          x={WIDTH / 2}
          y={HEIGHT - 8}
          textAnchor="middle"
          fontSize={11}
          fill="currentColor"
          opacity={0.8}
        >
          价格 (USD/M tokens, 对数轴)
        </text>

        {/* 帕累托前沿线 */}
        {frontier.length > 1 && (
          <polyline
            points={frontier.map((p) => `${xScale(p.priceInput)},${yScale(p.intelligence)}`).join(' ')}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth={1.5}
            strokeDasharray="4,4"
            opacity={0.5}
          />
        )}

        {/* 散点 */}
        {valid.map((p) => {
          const isFrontier = frontierIds.has(p.id);
          const labelDy = labelOffsets.get(p.id) ?? -10;
          return (
            <g key={p.id} className="cursor-pointer" onClick={() => onSelect(p.id)}>
              <title>{`${p.name} · 输入 $${p.priceInput.toFixed(2)}/M · 能力 ${p.intelligence.toFixed(1)}`}</title>
              <circle
                cx={xScale(p.priceInput)}
                cy={yScale(p.intelligence)}
                r={isFrontier ? 6 : 4}
                fill={isFrontier ? 'hsl(var(--accent))' : 'var(--muted-foreground)'}
                opacity={isFrontier ? 1 : 0.6}
              />
              {isFrontier && (
                <text
                  x={xScale(p.priceInput)}
                  y={yScale(p.intelligence) + labelDy}
                  textAnchor="middle"
                  fontSize={10}
                  fill="currentColor"
                  className="pointer-events-none"
                >
                  {p.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* 键盘可达表格（屏幕阅读器 + 鼠标不可用场景） */}
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">查看可访问的表格版本</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="border-b text-[10px] uppercase tracking-wider">
              <th className="py-1 pr-2 font-medium">模型</th>
              <th className="py-1 pr-2 font-medium">价格 ($/M)</th>
              <th className="py-1 font-medium">能力分</th>
            </tr>
          </thead>
          <tbody>
            {valid.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-1 pr-2">
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    className="hover:underline focus:underline focus:outline-none"
                  >
                    {p.name}
                  </button>
                </td>
                <td className="py-1 pr-2 font-mono">${p.priceInput.toFixed(2)}</td>
                <td className="py-1 font-mono">{p.intelligence.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}