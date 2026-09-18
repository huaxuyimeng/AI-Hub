'use client';

// 清理功能共用：大小格式化 / 进度条 / 建议徽章 / 盘符选择器

import type { TargetItem } from '@/server/lib/cleanup-engine';

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/** 特殊项（空文件夹/空文件）以数量展示 */
export function fmtTargetSize(t: Pick<TargetItem, 'kind' | 'sizeBytes'>): string {
  if (t.kind === 'emptyFolders') {
    return t.sizeBytes === null || t.sizeBytes === undefined ? '—' : `${t.sizeBytes} 个`;
  }
  if (t.kind === 'emptyFiles') {
    return t.sizeBytes === null || t.sizeBytes === undefined ? '—' : `${t.sizeBytes} 个`;
  }
  if (t.kind === 'recycleBin') return '清空前未知';
  return fmtBytes(t.sizeBytes);
}

export function fmtProgressBytes(bytes: number): string {
  return fmtBytes(bytes);
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={'h-2 w-full overflow-hidden rounded-full bg-muted ' + (className ?? '')}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

const ADVICE_STYLE: Record<TargetItem['advice'], { text: string; cls: string }> = {
  clean: { text: '建议清理', cls: 'bg-success/10 text-success' },
  optional: { text: '可选', cls: 'bg-warning/10 text-warning-fg' },
  caution: { text: '谨慎', cls: 'bg-destructive/10 text-destructive' },
};

export function AdviceBadge({ advice }: { advice: TargetItem['advice'] }) {
  const s = ADVICE_STYLE[advice];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>
      {s.text}
    </span>
  );
}

const STATUS_TEXT: Record<string, string> = {
  ok: '已清理',
  partial: '部分清理',
  failed: '失败',
  skipped: '跳过',
};

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'ok'
      ? 'bg-success/10 text-success'
      : status === 'partial'
        ? 'bg-warning/10 text-warning-fg'
        : status === 'failed'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {STATUS_TEXT[status] ?? status}
    </span>
  );
}

export interface DriveInfoLite {
  letter: string;
  totalBytes: number;
  freeBytes: number;
  label: string;
}

/** 盘符选择器：卡片 + 容量条 */
export function DriveSelector({
  drives,
  selected,
  onSelect,
}: {
  drives: DriveInfoLite[];
  selected: string;
  onSelect: (letter: string) => void;
}) {
  if (drives.length === 0) {
    return <div className="text-sm text-muted-foreground">未检测到可用盘符（仅支持 Windows）</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {drives.map((d) => {
        const usedPct = Math.round(((d.totalBytes - d.freeBytes) / d.totalBytes) * 100);
        const active = d.letter === selected;
        return (
          <button
            key={d.letter}
            type="button"
            onClick={() => onSelect(d.letter)}
            className={
              'rounded-lg border p-3 text-left transition ' +
              (active
                ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                : 'bg-card hover:border-ring/40 hover:bg-accent/50')
            }
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-sm font-semibold">{d.letter}: 盘</span>
              <span className="text-[10px] text-muted-foreground">{d.label}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={
                  'h-full rounded-full ' + (usedPct > 90 ? 'bg-destructive' : usedPct > 75 ? 'bg-warning' : 'bg-primary')
                }
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              剩余 {fmtBytes(d.freeBytes)} / 共 {fmtBytes(d.totalBytes)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 任务进行中的进度面板（扫描 / 清理共用） */
export function TaskProgressBar({
  phase,
  progress,
  completed,
  total,
  sub,
}: {
  phase: string;
  progress: number;
  completed: number;
  total: number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="animate-pulse font-medium">{phase}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {completed}/{total} 项 · {progress}%
        </span>
      </div>
      <ProgressBar value={progress} />
      {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
