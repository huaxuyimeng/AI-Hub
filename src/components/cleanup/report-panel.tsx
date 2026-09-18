'use client';

// 清理报告面板：历史报告列表 + 详情
// 详情四要素：清理了什么（明细）/ 清理了多少（总量）/ 还能再清理多少 / 建议清理什么

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { fmtBytes, StatusBadge } from './shared';
import { IconAlertTriangle } from '@tabler/icons-react';
import { SkeletonBox } from '@/components/ui/skeleton';

export function ReportPanel({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string | null) => void }) {
  const reportsQ = trpc.cleanup.reports.useQuery(undefined, { refetchOnWindowFocus: false });
  const reportQ = trpc.cleanup.report.useQuery({ id: activeId ?? '' }, { enabled: !!activeId });

  if (activeId) {
    if (reportQ.isLoading) {
      return (
        <div className="space-y-3">
          <SkeletonBox className="h-8 w-24" />
          <SkeletonBox className="h-20 w-full" />
          <SkeletonBox className="h-40 w-full" />
          <SkeletonBox className="h-32 w-full" />
        </div>
      );
    }
    if (reportQ.isError) {
      return (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <IconAlertTriangle size={16} className="shrink-0" />
          <span>加载失败：{reportQ.error.message}</span>
        </div>
      );
    }
    if (reportQ.data) {
      const r = reportQ.data;
      return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => onOpen(null)}
          className="rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
        >
          ← 返回报告列表
        </button>

        {/* 总览卡 */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground">本次共释放</div>
            <div className="mt-1 text-xl font-bold text-success">{fmtBytes(r.totalFreed)}</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground">清理项目</div>
            <div className="mt-1 text-xl font-bold">{r.items.length} 项</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground">还能再清理</div>
            <div className="mt-1 text-xl font-bold text-warning-fg">{fmtBytes(r.remainingTotal)}</div>
            <div className="text-[10px] text-muted-foreground">{r.remaining.length} 项待选</div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs text-muted-foreground">目标盘</div>
            <div className="mt-1 text-xl font-bold font-mono">{r.drive}:</div>
            <div className="text-[10px] text-muted-foreground">
              {r.mode === 'safe' ? '安全清理' : '深度清理'} · {new Date(r.endedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        </div>

        {/* 清理了什么 */}
        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">清理明细</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">本次实际删除了什么、每项释放多少</p>
          </div>
          <ul className="divide-y">
            {r.items.map((item, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm">{item.label}</span>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.software}
                    {item.path ? ` · ${item.path}` : ''}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs">{fmtBytes(item.freedBytes)}</span>
              </li>
            ))}
          </ul>
          {r.failedCount > 0 && (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              共 {r.failedCount} 个文件因被占用跳过，关闭对应软件后再次清理即可
            </div>
          )}
        </section>

        {/* 还能再清理多少 + 建议 */}
        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">还能再清理什么</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              白名单中剩余可清理项，共 {fmtBytes(r.remainingTotal)}；按大小排序
            </p>
          </div>
          {r.remaining.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">白名单内已无可清理项</div>
          ) : (
            <ul className="divide-y">
              {r.remaining.map((item, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{item.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.software} · {item.advice}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs">{fmtBytes(item.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 建议清理什么 */}
        <section className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h3 className="text-sm font-semibold">清理建议</h3>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-muted-foreground">
            {r.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ol>
        </section>
      </div>
    );
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">历史报告</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">每次清理完成后自动生成，含释放量与后续建议</p>
      </div>
      {reportsQ.isLoading ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中…</div>
      ) : !reportsQ.data || reportsQ.data.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          还没有清理报告，先去「扫描清理」跑一次吧
        </div>
      ) : (
        <ul className="divide-y">
          {reportsQ.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{r.drive}: 盘</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {r.mode === 'safe' ? '安全清理' : '深度清理'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(r.endedAt).toLocaleString('zh-CN')} · {r.itemCount} 项
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-success">+{fmtBytes(r.totalFreed)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
