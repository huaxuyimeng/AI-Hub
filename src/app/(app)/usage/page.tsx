'use client';

/**
 * 用量页面（整合 v3 §5.2）
 *
 * 数据来源：
 *   - trpc.usage.recent    → 按日聚合 + 总量卡 + 趋势图
 *   - trpc.usage.byModel   → 按模型拆分 + 实时重算成本
 *   - trpc.usage.pricing   → 实时模型价格（来自 rankings.list，覆盖 PRICING_TABLE）
 *
 * 改进：
 *   - SparkLine 抽到 components/ui/spark-line
 *   - 增加 "按模型" 区块，显示实时重算成本与价格更新时间
 *   - 价格表区块标注 source（FALLBACK/RANKINGS）与更新时间
 *   - 修正 X 轴分布 + 全 0 空态
 */

import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { IconChartBar, IconCoin, IconMessage, IconRobot, IconRefresh } from '@tabler/icons-react';
import { centsToCNY } from '@/lib/currency';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { SparkLine } from '@/components/ui/spark-line';

export default function UsagePage() {
  const { data, isLoading, error, refetch, isFetching } = trpc.usage.recent.useQuery({
    days: 30,
  });
  const byModelQ = trpc.usage.byModel.useQuery({ days: 30 });
  const pricingQ = trpc.usage.pricing.useQuery({ preferLive: true });

  // P-05 修复：d.date 是 Date 对象。String(date) 是 locale 字符串（如 "Tue Sep 01 2026..."），
  // 截前 10 位会得到 "Tue Sep 01"。改用 toISOString() + slice(0,10) 或 toLocaleDateString('zh-CN')。
  const dateLabels = useMemo(
    () =>
      data?.days.map((d) => {
        const date = d.date instanceof Date ? d.date : new Date(d.date);
        return date.toISOString().slice(0, 10);
      }) ?? [],
    [data],
  );

  const priceAsOf = pricingQ.data?.[0]?.updatedAt ?? null;
  const liveCostGap =
    byModelQ.data?.totals.liveCostCents != null &&
    byModelQ.data?.totals.costCents != null
      ? byModelQ.data.totals.liveCostCents - byModelQ.data.totals.costCents
      : 0;

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <PageHeader
        title="用量"
        subtitle={`最近 30 天的 token 与计费${priceAsOf ? ` · 价格快照于 ${formatDateTime(priceAsOf)}` : ''}`}
        action={
          <button
            type="button"
            onClick={() => {
              refetch();
              byModelQ.refetch();
              pricingQ.refetch();
            }}
            className="rounded-md border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={isFetching}
            aria-label="刷新用量"
          >
            <span className="inline-flex items-center gap-1">
              <IconRefresh size={12} className={isFetching ? 'animate-spin' : ''} />
              刷新
            </span>
          </button>
        }
      />

      <div className="mx-auto max-w-5xl px-8 py-8">
        {isLoading && <div className="text-sm text-muted-foreground">加载中…</div>}
        {error && <ErrorState message={error.message} className="my-4" />}

        {data && (
          <>
            {/* 总量卡 */}
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                icon={<IconMessage size={14} />}
                label="消息数"
                value={data.totals.messageCount.toLocaleString()}
                sub={`分析 ${data.totals.analysisCount} 次`}
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
                sub={
                  liveCostGap !== 0
                    ? `实时重算 ${centsToCNY(data.totals.costCents + liveCostGap)} (${liveCostGap > 0 ? '+' : ''}${centsToCNY(Math.abs(liveCostGap))})`
                    : `$${(data.totals.costCents / 100).toFixed(2)} USD · 实时价格已对齐`
                }
              />
            </div>

            {/* 趋势 */}
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
                  labels={dateLabels}
                />
              </div>
            </section>

            {/* 按模型拆分（整合 v3 §5.2） */}
            {byModelQ.data && byModelQ.data.items.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <IconRobot size={12} />
                  按模型拆分
                  <span className="text-[10px] normal-case opacity-70">
                    · 实时价格 = Model 表价格，未收录则回退 PRICING_TABLE
                  </span>
                </h2>
                <div className="overflow-x-auto rounded-lg border bg-card">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">模型</th>
                        <th className="px-4 py-2 text-right font-medium">消息</th>
                        <th className="px-4 py-2 text-right font-medium">输入</th>
                        <th className="px-4 py-2 text-right font-medium">输出</th>
                        <th className="px-4 py-2 text-right font-medium">原始成本</th>
                        <th className="px-4 py-2 text-right font-medium">实时重算</th>
                        <th className="px-4 py-2 text-right font-medium">价格源</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModelQ.data.items.map((m) => {
                        const diff = m.liveCostCents - m.costCents;
                        const diffColor =
                          diff === 0
                            ? 'text-muted-foreground'
                            : diff > 0
                              ? 'text-warning'
                              : 'text-success';
                        return (
                          <tr key={m.modelId} className="border-t hover:bg-accent/30">
                            <td className="px-4 py-2.5">
                              <div className="font-medium">{m.name}</div>
                              <div className="font-mono text-[10px] text-muted-foreground">
                                {m.modelId} · {m.provider}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right">{m.messageCount}</td>
                            <td className="px-4 py-2.5 text-right">
                              {m.inputTokens.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {m.outputTokens.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs">
                              ${(m.costCents / 100).toFixed(4)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs">
                              <div>${(m.liveCostCents / 100).toFixed(4)}</div>
                              {diff !== 0 && (
                                <div className={`text-[10px] ${diffColor}`}>
                                  {diff > 0 ? '+' : ''}
                                  {(diff / 100).toFixed(4)}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <PriceSourceBadge source={m.priceSource} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 每日明细 */}
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                每日明细
              </h2>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
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
                    {data.days.map((d) => {
                      // P-05 修复：保证日期是 Date 后用 toLocaleDateString('zh-CN') 渲染中文短日期
                      const date = d.date instanceof Date ? d.date : new Date(d.date);
                      const dateStr = date.toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      });
                      const iso = date.toISOString().slice(0, 10);
                      return (
                      <tr key={iso} className="border-t hover:bg-accent/30">
                        <td className="px-4 py-2.5 font-mono text-xs" title={iso}>{dateStr}</td>
                        <td className="px-4 py-2.5 text-right">{d.messageCount}</td>
                        <td className="px-4 py-2.5 text-right">{Number(d.inputTokens).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right">{Number(d.outputTokens).toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">${(d.costCents / 100).toFixed(4)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* 实时模型价格表 */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            模型定价 (USD / 1M tokens)
            {priceAsOf && (
              <span className="ml-2 text-[10px] normal-case opacity-70">
                · 来源 rankings.list，更新于 {formatDateTime(priceAsOf)}
              </span>
            )}
          </h2>
          {pricingQ.isLoading && (
            <div className="text-xs text-muted-foreground">加载中…</div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {pricingQ.data?.map((p) => (
              <div key={p.name} className="rounded-lg border bg-card p-3 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{p.displayName}</span>
                  {p.source === 'FALLBACK' && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                      兜底
                    </span>
                  )}
                  {'isPending' in p && p.isPending && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      待验证
                    </span>
                  )}
                </div>
                <div className="mb-2 truncate font-mono text-[10px] text-muted-foreground">
                  {p.name} · {p.provider}
                </div>
                <div className="space-y-0.5">
                  <Row label="Input" value={`$${p.inputPrice}`} />
                  <Row label="Output" value={`$${p.outputPrice}`} />
                  {'cacheReadPrice' in p && p.cacheReadPrice != null && (
                    <Row label="Cache read" value={`$${p.cacheReadPrice}`} />
                  )}
                  {'maxContextWindow' in p && p.maxContextWindow != null && (
                    <Row label="Context" value={`${(Number(p.maxContextWindow) / 1000).toFixed(0)}k`} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function PriceSourceBadge({ source }: { source: 'RANKINGS' | 'FALLBACK' | 'MISSING' }) {
  const config: Record<
    'RANKINGS' | 'FALLBACK' | 'MISSING',
    { label: string; cls: string }
  > = {
    RANKINGS: {
      label: '实时',
      cls: 'bg-success/15 text-success',
    },
    FALLBACK: {
      label: '回退',
      cls: 'bg-warning/15 text-warning',
    },
    MISSING: {
      label: '缺失',
      cls: 'bg-destructive/10 text-destructive',
    },
  };
  const c = config[source];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.cls}`}>{c.label}</span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
