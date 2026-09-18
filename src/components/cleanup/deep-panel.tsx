'use client';

// 深度清理面板：选盘 → 扫描深度项（pnpm store / Playwright / JetBrains 旧版本 / 空文件夹等）
// 每项带说明与风险提示，清理前需二次确认

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import type { TaskProgress, TargetItem } from '@/server/lib/cleanup-engine';
import { AdviceBadge, DriveSelector, fmtBytes, fmtTargetSize, TaskProgressBar, type DriveInfoLite } from './shared';

export function DeepPanel({
  drives,
  drive,
  onSelectDrive,
  task,
  onViewReport,
}: {
  drives: DriveInfoLite[];
  drive: string;
  onSelectDrive: (letter: string) => void;
  task: TaskProgress | null;
  onViewReport: (reportId: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [cleaned, setCleaned] = useState(false);

  const scanStart = trpc.cleanup.scanStart.useMutation();
  const cleanStart = trpc.cleanup.cleanStart.useMutation();

  const scanned = useMemo(() => {
    if (!task || task.kind !== 'scan' || task.status !== 'done' || task.drive !== drive) return null;
    return task.targets.filter((t) => t.tier === 'deep');
  }, [task, drive]);

  useEffect(() => {
    if (scanned) {
      setSelected(new Set());
      setCleaned(false);
    }
  }, [scanned]);

  const cleanTask = task && task.kind === 'clean' && task.status === 'done' ? task : null;
  useEffect(() => {
    if (cleanTask) setCleaned(true);
  }, [cleanTask]);

  const running = task?.status === 'running';
  const deepTargets = scanned ?? [];
  const totalSelected = deepTargets.filter((t) => selected.has(t.id)).reduce((s, t) => s + (t.sizeBytes ?? 0), 0);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold">选择盘符</h2>
        <DriveSelector drives={drives} selected={drive} onSelect={onSelectDrive} />
      </section>

      {running && task && (
        <TaskProgressBar
          phase={task.phase}
          progress={task.progress}
          completed={task.completedItems}
          total={task.totalItems}
          sub={
            task.kind === 'scan'
              ? `已扫描 ${fmtBytes(task.scannedBytes)}`
              : `已释放 ${fmtBytes(task.freedBytes)} · 中断后可从会话恢复继续清理`
          }
        />
      )}

      {!running && !scanned && !cleanTask && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            扫描 {drive}: 盘的深度清理项：包存储库、测试浏览器、索引缓存、空文件夹、空白文档等
          </p>
          <button
            type="button"
            disabled={scanStart.isPending}
            onClick={() => scanStart.mutate({ drive })}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {scanStart.isPending ? '正在启动扫描…' : `扫描 ${drive}: 盘深度项`}
          </button>
          {scanStart.error && <p className="text-xs text-destructive">{scanStart.error.message}</p>}
        </div>
      )}

      {cleanTask && !running && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-success">深度清理完成</h3>
            {cleanTask.reportId && (
              <button
                type="button"
                onClick={() => onViewReport(cleanTask.reportId!)}
                className="rounded-md border bg-background px-3 py-1 text-xs hover:bg-accent"
              >
                查看清理报告 →
              </button>
            )}
          </div>
          <p className="text-sm">
            共释放 <b className="text-success">{fmtBytes(cleanTask.freedBytes)}</b>
          </p>
          <div className="mt-3 space-y-1">
            {cleanTask.results.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-muted-foreground">
                  {r.label}（{r.software}）
                </span>
                <span className="ml-2 shrink-0 font-mono">{fmtBytes(r.freedBytes)}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCleaned(false)}
            className="mt-3 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
          >
            返回列表
          </button>
        </div>
      )}

      {scanned && !running && !cleanTask && (
        <>
          <section className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-semibold">
                深度清理项 <span className="ml-1 text-xs font-normal text-muted-foreground">（共 {deepTargets.length} 项，需确认）</span>
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                这些项目删除后不影响已安装软件，但新装包 / 打开项目时会重新下载或重建索引
              </p>
            </div>
            {deepTargets.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">本盘没有发现深度清理项</div>
            ) : (
              <ul className="divide-y">
                {deepTargets.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                      className="h-4 w-4 shrink-0 accent-[hsl(var(--accent))]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm">{t.label}</span>
                        <AdviceBadge advice={t.advice} />
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t.software} · {t.desc}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs">{fmtTargetSize(t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {deepTargets.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
              <div className="text-sm">
                已选 <b>{selected.size}</b> 项，预计释放 <b className="text-success">{fmtBytes(totalSelected)}</b>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={scanStart.isPending}
                  onClick={() => scanStart.mutate({ drive })}
                  className="rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
                >
                  重新扫描
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => setConfirming(true)}
                  className="rounded-md bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-fg hover:bg-destructive/90 disabled:opacity-50"
                >
                  开始深度清理
                </button>
              </div>
            </div>
          )}

          {/* 二次确认弹层 */}
          {confirming && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl">
                <h3 className="text-sm font-semibold">确认深度清理</h3>
                <p className="mt-2 text-xs text-muted-foreground">
                  即将清理以下 {selected.size} 项（约 {fmtBytes(totalSelected)}）。已安装的软件不会受影响，但相关的包需要重新下载、索引会重建：
                </p>
                <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
                  {deepTargets
                    .filter((t) => selected.has(t.id))
                    .map((t) => (
                      <li key={t.id} className="flex justify-between text-xs">
                        <span className="truncate">{t.label}</span>
                        <span className="ml-2 shrink-0 font-mono text-muted-foreground">{fmtTargetSize(t)}</span>
                      </li>
                    ))}
                </ul>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                      cleanStart.mutate({ itemIds: [...selected] });
                    }}
                    className="rounded-md bg-destructive px-4 py-1.5 text-xs font-medium text-destructive-fg hover:bg-destructive/90"
                  >
                    确认清理
                  </button>
                </div>
              </div>
            </div>
          )}
          {cleanStart.error && <p className="text-xs text-destructive">{cleanStart.error.message}</p>}
        </>
      )}
    </div>
  );
}
