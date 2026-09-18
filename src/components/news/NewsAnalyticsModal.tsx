'use client';

/**
 * 新闻统计图表 Modal（v4 重构，2026-09-01）
 *
 * 设计原则：
 * - 无 emoji、无渐变、无 box-shadow、无彩虹色
 * - 使用 token 系统颜色（currentColor / text-foreground / text-muted-foreground）
 * - 顶部 4 张 KPI 卡片（新增），突出"高质量占比"与"今日可信"
 * - 6 图 3×2 网格：趋势线 / 源头分布 / 分类柱 / 厂家榜 + 新增置信度饼图与源头质量榜
 * - 流畅动画：Modal 淡入缩放、图表入场 width 0→target、骨架屏
 */

import { useEffect, useState, type CSSProperties } from 'react';

// ── 类型定义 ──────────────────────────────────────────────
interface TrendPoint {
  date: string;
  count: number;
}

interface TrendByConfidencePoint {
  date: string;
  A: number;
  B: number;
  C: number;
  D: number;
}

interface DistributionPoint {
  name: string;
  count: number;
}

interface ConfidencePoint {
  grade: 'A' | 'B' | 'C' | 'D';
  label: string;
  count: number;
}

interface SourceQualityPoint {
  name: string;
  count: number;
  score: number;
}

interface AnalyticsData {
  total: number;
  today: number;
  sources: number;
  highQualityPct: number;
  reliableToday: number;
  confidenceDistribution: ConfidencePoint[];
  sourceQuality: SourceQualityPoint[];
  trendByConfidence: TrendByConfidencePoint[];
  trend: TrendPoint[];
  sourceDistribution: DistributionPoint[];
  categoryDistribution: DistributionPoint[];
  companyMentions: DistributionPoint[];
}

interface NewsAnalyticsModalProps {
  data: AnalyticsData | undefined;
  loading?: boolean;
  open: boolean;
  onClose: () => void;
}

// ── 置信度配色（语义映射，与后端 grade 字段一致）──────────
// 注意：SVG 用 fill-*（不是 bg-*），Tailwind 3 默认色板
const CONFIDENCE_FILL: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'fill-emerald-500 dark:fill-emerald-400',
  B: 'fill-sky-500 dark:fill-sky-400',
  C: 'fill-amber-500 dark:fill-amber-400',
  D: 'fill-rose-500 dark:fill-rose-400',
};

// 用于普通 HTML 元素的 text + dot 配色
const CONFIDENCE_TEXT: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'text-emerald-600 dark:text-emerald-400',
  B: 'text-sky-600 dark:text-sky-400',
  C: 'text-amber-600 dark:text-amber-400',
  D: 'text-rose-600 dark:text-rose-400',
};

const CONFIDENCE_BG: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'bg-emerald-500',
  B: 'bg-sky-500',
  C: 'bg-amber-500',
  D: 'bg-rose-500',
};

// ── 主组件 ────────────────────────────────────────────────
export function NewsAnalyticsModal({ data, loading, open, onClose }: NewsAnalyticsModalProps) {
  // ESC 关闭 + body 滚动锁定
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-[analytics-fadeIn_200ms_ease-out]"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-border bg-card animate-[analytics-modalIn_280ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-7 py-5">
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
              Analytics
            </p>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">新闻数据统计</h2>
            <p className="text-xs text-muted-foreground">
              总计 {data ? data.total.toLocaleString() : '—'} 条 · 今日 {data?.today ?? '—'} 条 · {data?.sources ?? '—'} 个启用源
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-background px-3.5 py-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            aria-label="关闭"
          >
            关闭
          </button>
        </div>

        {/* 主体 */}
        <div className="px-7 py-6">
          {loading || !data ? (
            <AnalyticsSkeleton />
          ) : (
            <>
              {/* 顶部 4 张统计卡 */}
              <KpiGrid data={data} />

              {/* 6 图 3×2 网格（移动端 1 列）*/}
              <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                <ChartShell title="30 天新闻量趋势" subtitle="按天汇总 · 含总量峰值">
                  <TrendLineChart data={data.trend} />
                </ChartShell>

                <ChartShell title="置信度分布" subtitle="全量 · A/B/C/D 占比">
                  <ConfidenceDonut data={data.confidenceDistribution} total={data.total} />
                </ChartShell>

                <ChartShell title="源头分布 · Top 10" subtitle="近 30 天 · 哪个源发得多">
                  <HorizontalBarList items={data.sourceDistribution} max={Math.max(...data.sourceDistribution.map(d => d.count), 1)} total={data.sourceDistribution.reduce((s, d) => s + d.count, 0)} rankOffset={1} />
                </ChartShell>

                <ChartShell title="源头质量榜 · Top 12" subtitle="加权分 A=4 / B=3 / C=2 / D=1">
                  <SourceQualityList data={data.sourceQuality} max={Math.max(...data.sourceQuality.map(d => d.count), 1)} />
                </ChartShell>

                <ChartShell title="热门分类" subtitle="近 30 天 · 按分类聚合">
                  <CategoryBarChart data={data.categoryDistribution} />
                </ChartShell>

                <ChartShell title="AI 厂家提及榜 · Top 15" subtitle="近 30 天 · 来自 companyTags">
                  <HorizontalBarList items={data.companyMentions} max={data.companyMentions[0]?.count ?? 1} total={data.companyMentions.reduce((s, d) => s + d.count, 0)} rankOffset={1} />
                </ChartShell>
              </div>

              {/* 30 天按置信度堆叠柱状图（独占一行，最强洞察） */}
              <div className="mt-5">
                <ChartShell title="30 天置信度趋势 · 堆叠视图" subtitle="每天 A/B/C/D 分级堆叠 · 直观看到噪音 vs 可信">
                  <TrendByConfidenceChart data={data.trendByConfidence} />
                </ChartShell>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-border px-7 py-3.5 text-center text-[11px] text-muted-foreground">
          数据范围：近 30 天 · 按 ESC 或点击空白处关闭
        </div>
      </div>

      {/* C-16 修复：keyframes 已统一移入 globals.css（避免 6 个 <style> 重复声明、
          关闭后不卸载导致 DOM 污染），此处不再注入 */}
    </div>
  );
}

// ── KPI 4 卡区 ─────────────────────────────────────────────
function KpiGrid({ data }: { data: AnalyticsData }) {
  const kpis = [
    {
      label: '数据库总数',
      value: data.total.toLocaleString(),
      sub: `今日 +${data.today}`,
      tone: 'neutral' as const,
    },
    {
      label: '启用源数',
      value: data.sources,
      sub: 'RSS + 爬虫 + B 站',
      tone: 'neutral' as const,
    },
    {
      label: '高质量占比',
      value: `${data.highQualityPct}%`,
      sub: (() => {
        const c = data.confidenceDistribution ?? [];
        const a = c[0]?.count ?? 0;
        const b = c[1]?.count ?? 0;
        return `A + B 共 ${a + b} 条`;
      })(),
      tone: 'success' as const,
    },
    {
      label: '今日可信',
      value: data.reliableToday,
      sub: 'A+B 且多源验证',
      tone: 'success' as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((k, i) => (
        <KpiCard key={k.label} {...k} delayMs={i * 60} />
      ))}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  delayMs,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone: 'neutral' | 'success';
  delayMs: number;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-4 opacity-0 animate-[analytics-kpiIn_400ms_cubic-bezier(0.16,1,0.3,1)_forwards]"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-semibold tabular-nums tracking-tight ${
            tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
          }`}
        >
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
      </div>
      {/* C-16 修复：kpiIn keyframes 已移入 globals.css */}
    </div>
  );
}

// ── Chart 卡片外壳 ─────────────────────────────────────────
function ChartShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 transition-colors duration-200 hover:bg-background">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// ── 1. 30 天趋势线（带入场动画） ────────────────────────────
function TrendLineChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyChart />;

  const width = 360;
  const height = 160;
  const padding = { top: 16, right: 12, bottom: 28, left: 32 };

  const maxCount = Math.max(...data.map(d => d.count), 1);
  const xStep = (width - padding.left - padding.right) / Math.max(1, data.length - 1);

  const points = data.map((d, i) => ({
    x: padding.left + i * xStep,
    y: padding.top + (height - padding.top - padding.bottom) * (1 - d.count / maxCount),
    ...d,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`;

  // 估算路径长度用于 dash 动画
  const approxPathLen = data.length * xStep * 1.1;

  const yTicks = [0, Math.round(maxCount / 2), maxCount];

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {/* 网格 */}
      {yTicks.map((tick, i) => {
        const y = padding.top + (height - padding.top - padding.bottom) * (1 - tick / maxCount);
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="currentColor" strokeOpacity={0.08} className="text-foreground" />
            <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill="currentColor" className="text-muted-foreground tabular-nums">
              {tick}
            </text>
          </g>
        );
      })}

      {/* 面积（淡入）*/}
      <path d={areaD} fill="currentColor" fillOpacity={0.05} className="text-foreground animate-[analytics-fadeIn_600ms_ease-out_200ms_both]" />

      {/* 趋势线（描边动画） */}
      <path
        d={pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-foreground"
        style={
          {
            strokeDasharray: approxPathLen,
            strokeDashoffset: approxPathLen,
            animation: `analytics-dashGrow 900ms cubic-bezier(0.16, 1, 0.3, 1) 100ms forwards`,
            '--path-l': approxPathLen,
          } as CSSProperties
        }
      />

      {/* 数据点（错开淡入）*/}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2}
          fill="currentColor"
          className="text-foreground animate-[analytics-fadeIn_300ms_ease-out_both]"
          style={{ animationDelay: `${500 + i * 12}ms` }}
        >
          <title>{p.date}: {p.count} 条</title>
        </circle>
      ))}

      {/* X 轴 */}
      {[0, Math.floor(points.length / 2), points.length - 1].map(i => {
        const p = points[i];
        if (!p) return null;
        return (
          <text key={i} x={p.x} y={height - padding.bottom + 14} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">
            {p.date?.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

// ── 2. 置信度分布（饼图，纯 SVG + 入场动画） ────────────────
function ConfidenceDonut({ data, total }: { data: ConfidencePoint[]; total: number }) {
  if (total === 0) return <EmptyChart />;

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 76;
  const innerR = 48;

  // 计算每个扇形的起始/结束角度
  let cumAngle = -Math.PI / 2; // 从 12 点钟方向开始
  const slices = data.map(d => {
    const angle = (d.count / total) * Math.PI * 2;
    const startAngle = cumAngle;
    const endAngle = cumAngle + angle;
    cumAngle = endAngle;
    return { ...d, startAngle, endAngle, midAngle: (startAngle + endAngle) / 2 };
  });

  function arcPath(startAngle: number, endAngle: number) {
    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
  }

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="shrink-0">
        {slices.map((s, i) => (
          <path
            key={s.grade}
            d={arcPath(s.startAngle, s.endAngle)}
            className={`${CONFIDENCE_FILL[s.grade]} opacity-0 animate-[analytics-fadeIn_500ms_ease-out_both]`}
            style={{ animationDelay: `${i * 80}ms`, transformOrigin: `${cx}px ${cy}px` }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="20" fontWeight="600" fill="currentColor" className="text-foreground tabular-nums">
          {total.toLocaleString()}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">
          总数 · 条
        </text>
      </svg>

      <div className="flex-1 space-y-1.5">
        {data.map((d, i) => {
          const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : '0.0';
          return (
            <div
              key={d.grade}
              className="flex items-center justify-between text-xs opacity-0 animate-[analytics-fadeIn_400ms_ease-out_both]"
              style={{ animationDelay: `${200 + i * 60}ms` }}
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-sm ${CONFIDENCE_BG[d.grade]}`} />
                <span className={`font-medium ${CONFIDENCE_TEXT[d.grade]}`}>{d.label}</span>
              </div>
              <div className="flex items-baseline gap-2 tabular-nums">
                <span className="font-semibold text-foreground">{d.count}</span>
                <span className="text-[10px] text-muted-foreground">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 3/4. 通用横向条形榜（源头分布 / 分类 / 厂家） ────────────
function HorizontalBarList({
  items,
  max,
  total,
  rankOffset = 1,
  limit = 15,
}: {
  items: DistributionPoint[];
  max: number;
  total: number;
  rankOffset?: number;
  limit?: number;
}) {
  if (items.length === 0) return <EmptyChart />;

  const top = items.slice(0, limit);

  return (
    <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 200 }}>
      {top.map((d, i) => {
        const widthPct = max > 0 ? (d.count / max) * 100 : 0;
        const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : '0.0';
        const isTop3 = i < 3;
        return (
          <div
            key={d.name}
            className="flex items-center gap-2.5 text-xs opacity-0 animate-[analytics-fadeIn_400ms_ease-out_both]"
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <span
              className={`w-5 shrink-0 text-right font-mono text-[10px] tabular-nums ${
                isTop3 ? 'font-semibold text-foreground' : 'text-muted-foreground'
              }`}
            >
              {i + rankOffset}
            </span>
            <span
              className={`w-24 min-w-0 shrink truncate ${isTop3 ? 'font-medium text-foreground' : 'text-foreground/85'}`}
              title={d.name}
            >
              {d.name}
            </span>
            <div className="relative h-4 min-w-[40px] flex-1 overflow-hidden rounded-sm bg-muted">
              <div
                className={`h-full ${isTop3 ? 'bg-foreground/85' : 'bg-foreground/55'} transition-[width] duration-700 ease-out`}
                style={{ width: `${widthPct}%`, animation: `analytics-barGrow 700ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 30 + 100}ms both`, '--bar-w': `${widthPct}%` } as CSSProperties}
                title={`${d.name}: ${d.count} 条 (${pct}%)`}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground/80">
              {d.count}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 5. 源头质量榜（带加权分色阶） ────────────────────────────
function SourceQualityList({ data, max }: { data: SourceQualityPoint[]; max: number }) {
  if (data.length === 0) return <EmptyChart />;

  const top = data.slice(0, 12);

  return (
    <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 240 }}>
      {top.map((d, i) => {
        const widthPct = (d.score / 4) * 100; // 满分 4
        const tone =
          d.score >= 3.5 ? 'bg-emerald-500' :
          d.score >= 2.5 ? 'bg-sky-500' :
          'bg-amber-500';
        return (
          <div
            key={d.name}
            className="flex items-center gap-2.5 text-xs opacity-0 animate-[analytics-fadeIn_400ms_ease-out_both]"
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <span className={`w-5 shrink-0 text-right font-mono text-[10px] tabular-nums ${i < 3 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
              {i + 1}
            </span>
            <span className={`w-24 min-w-0 shrink truncate ${i < 3 ? 'font-medium text-foreground' : 'text-foreground/85'}`} title={d.name}>
              {d.name}
            </span>
            <div className="relative h-4 min-w-[40px] flex-1 overflow-hidden rounded-sm bg-muted">
              <div
                className={`h-full ${tone} transition-[width] duration-700 ease-out`}
                style={{ width: `${widthPct}%`, animation: `analytics-barGrow 700ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 30 + 100}ms both`, '--bar-w': `${widthPct}%` } as CSSProperties}
                title={`${d.name}: 加权分 ${d.score.toFixed(1)} / 4.0`}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[10px] font-semibold tabular-nums text-foreground">
              {d.score.toFixed(1)}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {d.count} 条
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 6. 分类柱状图（垂直） ──────────────────────────────────
function CategoryBarChart({ data }: { data: DistributionPoint[] }) {
  if (data.length === 0) return <EmptyChart />;

  const width = 360;
  const barHeight = 18;
  const gap = 6;
  const padding = { top: 4, right: 36, bottom: 4, left: 88 };
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const height = padding.top + padding.bottom + data.length * (barHeight + gap);

  return (
    <div className="overflow-y-auto pr-1" style={{ maxHeight: 240 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        {data.map((d, i) => {
          const y = padding.top + i * (barHeight + gap);
          const barWidth = ((width - padding.left - padding.right) * d.count) / maxCount;
          return (
            <g key={i} className="opacity-0 animate-[analytics-fadeIn_400ms_ease-out_both]" style={{ animationDelay: `${i * 35}ms` }}>
              <text x={padding.left - 8} y={y + barHeight / 2 + 4} textAnchor="end" fontSize="10" fill="currentColor" className="text-foreground/85">
                {d.name}
              </text>
              <rect
                x={padding.left}
                y={y}
                width={barWidth}
                height={barHeight}
                fill="currentColor"
                className="text-foreground/70 transition-[width] duration-700 ease-out"
                rx={2}
              >
                <title>{d.name}: {d.count} 条</title>
              </rect>
              <text x={padding.left + barWidth + 6} y={y + barHeight / 2 + 4} fontSize="9" fill="currentColor" className="text-muted-foreground tabular-nums">
                {d.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── 7. 30 天置信度堆叠柱状图（最强洞察） ───────────────────
function TrendByConfidenceChart({ data }: { data: TrendByConfidencePoint[] }) {
  if (data.length === 0) return <EmptyChart />;

  const width = 880;
  const height = 200;
  const padding = { top: 16, right: 16, bottom: 28, left: 32 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const barGap = 2;

  const maxDay = Math.max(...data.map(d => d.A + d.B + d.C + d.D), 1);
  const barWidth = (chartWidth / data.length) - barGap;
  const yTicks = [0, Math.round(maxDay / 2), maxDay];

  // 抽样 X 轴标签（避免拥挤）
  const labelStride = Math.ceil(data.length / 8);

  return (
    <div className="overflow-x-auto">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible min-w-[600px]">
        {/* 网格 + Y 轴 */}
        {yTicks.map((tick, i) => {
          const y = padding.top + chartHeight * (1 - tick / maxDay);
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="currentColor" strokeOpacity={0.08} className="text-foreground" />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize="9" fill="currentColor" className="text-muted-foreground tabular-nums">
                {tick}
              </text>
            </g>
          );
        })}

        {/* 堆叠柱（每天 4 段：D/C/B/A 从底向上） */}
        {data.map((d, i) => {
          const x = padding.left + i * (barWidth + barGap);
          const total = d.A + d.B + d.C + d.D;
          if (total === 0) return null;
          const hTotal = (total / maxDay) * chartHeight;
          const hD = (d.D / total) * hTotal;
          const hC = (d.C / total) * hTotal;
          const hB = (d.B / total) * hTotal;
          const hA = (d.A / total) * hTotal;
          // 从下往上：D → C → B → A
          const yD = padding.top + chartHeight - hD;
          const yC = yD - hC;
          const yB = yC - hB;
          const yA = yB - hA;

          return (
            <g key={d.date} className="opacity-0 animate-[analytics-fadeIn_500ms_ease-out_both]" style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
              {/* D（底）*/}
              <rect x={x} y={yD} width={barWidth} height={hD} className={`${CONFIDENCE_FILL.D} transition-all duration-700`} rx={1} />
              {/* C */}
              <rect x={x} y={yC} width={barWidth} height={hC} className={`${CONFIDENCE_FILL.C} transition-all duration-700`} rx={1} />
              {/* B */}
              <rect x={x} y={yB} width={barWidth} height={hB} className={`${CONFIDENCE_FILL.B} transition-all duration-700`} rx={1} />
              {/* A（顶）*/}
              <rect x={x} y={yA} width={barWidth} height={hA} className={`${CONFIDENCE_FILL.A} transition-all duration-700`} rx={1} />
              <title>{d.date} · 总 {total} · A {d.A} / B {d.B} / C {d.C} / D {d.D}</title>
            </g>
          );
        })}

        {/* X 轴标签（抽样）*/}
        {data.map((d, i) => {
          if (i % labelStride !== 0 && i !== data.length - 1) return null;
          const x = padding.left + i * (barWidth + barGap) + barWidth / 2;
          return (
            <text key={`xl-${i}`} x={x} y={height - padding.bottom + 14} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">
              {d.date.slice(5)}
            </text>
          );
        })}
      </svg>

      {/* 图例 */}
      <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <LegendDot className={CONFIDENCE_BG.A} label="A 可信" />
        <LegendDot className={CONFIDENCE_BG.B} label="B 较可信" />
        <LegendDot className={CONFIDENCE_BG.C} label="C 存疑" />
        <LegendDot className={CONFIDENCE_BG.D} label="D 不可信" />
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`} />
      <span>{label}</span>
    </span>
  );
}

// ── 空态 ──────────────────────────────────────────────────
function EmptyChart() {
  return (
    <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
      暂无数据
    </div>
  );
}

// ── 骨架屏 ────────────────────────────────────────────────
function AnalyticsSkeleton() {
  return (
    <>
      {/* KPI 骨架 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <div className="space-y-2.5">
              <div className="h-3 w-16 rounded bg-muted animate-pulse" />
              <div className="h-7 w-24 rounded bg-muted animate-pulse" />
              <div className="h-3 w-20 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* 6 图骨架 */}
      <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 space-y-1.5">
              <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
              <div className="h-3 w-32 rounded bg-muted animate-pulse" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="flex items-center gap-2">
                  <div className="h-3 w-4 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-8 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}