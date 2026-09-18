'use client';

// 扫描清理面板：选盘 → 渐进扫描 → 勾选安全项 → 清理（进度条）→ 完成跳报告

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import type { TaskProgress, TargetItem } from '@/server/lib/cleanup-engine';
import { AdviceBadge, DriveSelector, fmtBytes, fmtTargetSize, TaskProgressBar, type DriveInfoLite } from './shared';

export function ScanPanel({
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
  const [cleaned, setCleaned] = useState(false);

  const scanStart = trpc.cleanup.scanStart.useMutation();
  const cleanStart = trpc.cleanup.cleanStart.useMutation();

  // 扫描结果：任务完成后 targets 已带大小
  const scanned = useMemo(() => {
    if (!task || task.kind !== 'scan' || task.status !== 'done' || task.drive !== drive) return null;
    return task.targets;
  }, [task, drive]);

  // 扫描完成 → 默认勾选所有"建议清理"项
  useEffect(() => {
    if (scanned) {
      setSelected(new Set(scanned.filter((t) => t.advice === 'clean').map((t) => t.id)));
      setCleaned(false);
    }
  }, [scanned]);

  // 清理任务完成 → 展示结果
  const cleanTask = task && task.kind === 'clean' && task.status === 'done' ? task : null;

  useEffect(() => {
    if (cleanTask) setCleaned(true);
  }, [cleanTask]);

  const running = task?.status === 'running';

  const safeTargets = useMemo(() => scanned?.filter((t) => t.tier === 'safe') ?? [], [scanned]);
  const totalSelected = useMemo(
    () => safeTargets.filter((t) => selected.has(t.id)).reduce((s, t) => s + (t.sizeBytes ?? 0), 0),
    [safeTargets, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === safeTargets.length) setSelected(new Set());
    else setSelected(new Set(safeTargets.map((t) => t.id)));
  };

  return (
    <div className="space-y-5">
      {/* 选盘 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">选择盘符</h2>
        <DriveSelector drives={drives} selected={drive} onSelect={onSelectDrive} />
      </section>

      {/* 任务进行中：进度条 */}
      {running && task && (
        <TaskProgressBar
          phase={task.phase}
          progress={task.progress}
          completed={task.completedItems}
          total={task.totalItems}
          sub={
            task.kind === 'scan'
              ? `已扫描 ${fmtBytes(task.scannedBytes)} · 扫描中关闭本页不影响任务，回来可继续查看`
              : `已释放 ${fmtBytes(task.freedBytes)} · 中断后可从会话恢复继续清理`
          }
        />
      )}

      {/* 扫描入口 */}
      {!running && !scanned && !cleanTask && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            扫描 {drive}: 盘的缓存、日志、临时文件等安全清理项，估算可释放空间
          </p>
          <button
            type="button"
            disabled={scanStart.isPending}
            onClick={() => scanStart.mutate({ drive })}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {scanStart.isPending ? '正在启动扫描…' : `开始扫描 ${drive}: 盘`}
          </button>
          {scanStart.error && <p className="text-xs text-destructive">{scanStart.error.message}</p>}
        </div>
      )}

      {/* 清理完成摘要 */}
      {cleanTask && (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-success">清理完成</h3>
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
            {cleanTask.failedCount > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">（{cleanTask.failedCount} 项文件被占用，已跳过）</span>
            )}
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
            返回列表（重新扫描）
          </button>
        </div>
      )}

      {/* 扫描结果 */}
      {scanned && !running && !cleanTask && (
        <>
          <section className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">
                  安全清理项 <span className="ml-1 text-xs font-normal text-muted-foreground">（共 {safeTargets.length} 项）</span>
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  全部为缓存 / 日志 / 临时文件，删除后软件可自动重建
                </p>
              </div>
              <button
                type="button"
                onClick={toggleAll}
                className="rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
              >
                {selected.size === safeTargets.length ? '取消全选' : '全选'}
              </button>
            </div>
            <ul className="divide-y">
              {safeTargets.map((t) => (
                <TargetRow key={t.id} item={t} checked={selected.has(t.id)} onToggle={() => toggle(t.id)} />
              ))}
            </ul>
          </section>

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
                disabled={selected.size === 0 || cleanStart.isPending}
                onClick={() => cleanStart.mutate({ itemIds: [...selected] })}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {cleanStart.isPending ? '正在启动…' : '开始清理'}
              </button>
            </div>
          </div>
          {cleanStart.error && <p className="text-xs text-destructive">{cleanStart.error.message}</p>}
        </>
      )}
    </div>
  );
}

function TargetRow({
  item,
  checked,
  onToggle,
}: {
  item: TargetItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0 accent-[hsl(var(--accent))]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{item.label}</span>
          <AdviceBadge advice={item.advice} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {item.software} · {item.desc}
        </div>
      </div>
      <span className="shrink-0 font-mono text-xs">{fmtTargetSize(item)}</span>
    </li>
  );
}
