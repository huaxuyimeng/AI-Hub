'use client';

import { trpc } from '@/lib/trpc';
import { IconChartBar, IconCoin, IconMessage } from '@tabler/icons-react';
import { useToast } from '@/components/toast';
import { centsToCNY } from '@/lib/currency';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';

export default function UsagePage() {
  const { data, isLoading, error } = trpc.usage.recent.useQuery({ days: 30 });
  const pricingQ = trpc.usage.pricing.useQuery();

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <PageHeader title="用量" subtitle="最近 30 天的 token 与计费" />

      <div className="mx-auto max-w-5xl px-8 py-8">
        {isLoading && <div className="text-sm text-muted-foreground">加载中…</div>}
        {error && (
          <ErrorState message={error.message} className="my-4" />
        )}

        {data && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                icon={<IconMessage size={14} />}
                label="消息数"
                value={data.totals.messageCount.toLocaleString()}
              />
              <MetricCard
                icon={<IconChartBar size={14} />}
                label="输入 token"
                value={data.totals.inputTokens.toLocaleString()}
              />
              <MetricCard
                icon={<IconChartBar size={14} />}
                label="输出 token"
                value={data.totals.outputTokens.toLocaleString()}
              />
              <MetricCard
                icon={<IconCoin size={14} />}
                label="本月费用"
                value={centsToCNY(data.totals.costCents)}
                sub={`$${(data.totals.costCents / 100).toFixed(2)} USD`}
              />
            </div>

            {/* 折线图 */}
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                趋势
              </h2>
              <div className="rounded-lg border bg-card p-4">
                <SparkLine
                  series={[
                    {
                      label: '输入 token',
                      color: 'oklch(72% 0.14 250)',
                      values: data.days.map((d) => Number(d.inputTokens)),
                    },
                    {
                      label: '输出 token',
                      color: 'oklch(72% 0.14 65)',
                      values: data.days.map((d) => Number(d.outputTokens)),
                    },
                  ]}
                  labels={data.days.map((d) => new Date(d.date.toString()).toISOString().slice(0, 10))}
                />
                {data.days.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    还没有用量数据
                  </div>
                )}
              </div>
            </section>

            {/* 每日明细 */}
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                每日明细
              </h2>
              <div className="overflow-hidden rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">日期</th>
                      <th className="px-4 py-2 text-right font-medium">消息</th>
                      <th className="px-4 py-2 text-right font-medium">输入</th>
                      <th className="px-4 py-2 text-right font-medium">输出</th>
                      <th className="px-4 py-2 text-right font-medium">费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                          还没有用量记录
                        </td>
                      </tr>
                    )}
                    {data.days.map((d) => (
                      <tr key={d.date.toString()} className="border-t hover:bg-accent/30">
                        <td className="px-4 py-2.5 font-mono text-xs">{d.date.toString().slice(0, 10)}</td>
                        <td className="px-4 py-2.5 text-right">{d.messageCount}</td>
                        <td className="px-4 py-2.5 text-right">{Number(d.inputTokens).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right">{Number(d.outputTokens).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">${(d.costCents / 100).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            模型定价 (USD / 1M tokens)
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {pricingQ.data?.map((p) => (
              <div key={p.name} className="rounded-lg border bg-card p-3 text-xs">
                <div className="mb-1 truncate text-sm font-medium">{p.displayName}</div>
                <div className="mb-2 truncate font-mono text-[10px] text-muted-foreground">{p.name}</div>
                <div className="space-y-0.5">
                  <Row label="Input" value={`$${p.inputPrice}`} />
                  <Row label="Output" value={`$${p.outputPrice}`} />
                  {p.cacheReadPrice != null && (
                    <Row label="Cache read" value={`$${p.cacheReadPrice}`} />
                  )}
                  <Row label="Context" value={`${(p.maxContextWindow / 1000).toFixed(0)}k`} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * 自绘 SVG 折线图（无第三方库）
 * series: 多条线，颜色 + 数据
 */
function SparkLine({
  series,
  labels,
}: {
  series: { label: string; color: string; values: number[] }[];
  labels: string[];
}) {
  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(...allValues, 1);
  const w = 800;
  const h = 200;
  const padX = 32;
  const padY = 20;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full" preserveAspectRatio="none">
        {/* grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={p}
            x1={padX}
            x2={w - padX}
            y1={padY + innerH * p}
            y2={padY + innerH * p}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeWidth={1}
          />
        ))}
        {/* lines */}
        {series.map((s) => {
          const points = s.values.map((v, i) => {
            const x = padX + (i / Math.max(1, s.values.length - 1)) * innerW;
            const y = padY + innerH - (v / max) * innerH;
            return `${x},${y}`;
          });
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
        {/* x-axis labels */}
        {labels.map((l, i) => {
          if (i % Math.ceil(labels.length / 6) !== 0 && i !== labels.length - 1) return null;
          const x = padX + (i / Math.max(1, labels.length - 1)) * innerW;
          return (
            <text
              key={i}
              x={x}
              y={h - 4}
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

// M-02 m: MetricCard 已迁移到 @/components/ui/metric-card

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}