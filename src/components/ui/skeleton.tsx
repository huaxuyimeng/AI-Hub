// V-19: 通用骨架屏组件（替代全屏 spinner，让路由切换更流畅）
import React from 'react';

// ─── 基础单元 ────────────────────────────────────────────────────────────────

/** 单行骨架（默认高度 16px） */
export function SkeletonLine({
  width = '100%',
  height = 16,
  className = '',
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-muted ${className}`}
      style={{ width, height: typeof height === 'number' ? `${height}px` : height }}
      aria-hidden="true"
    />
  );
}

/** 固定宽高的方块骨架 */
export function SkeletonBox({
  w = 'w-10',
  h = 'h-10',
  rounded = 'rounded-md',
  className = '',
}: {
  w?: string;
  h?: string;
  rounded?: string;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-muted ${w} ${h} ${rounded} ${className}`}
      aria-hidden="true"
    />
  );
}

/** 圆形骨架（适合头像） */
export function SkeletonCircle({
  size = 'size-10',
  className = '',
}: {
  size?: string;
  className?: string;
}) {
  return <SkeletonBox w={size} h={size} rounded="rounded-full" className={className} />;
}

// ─── 复合骨架 ───────────────────────────────────────────────────────────────

/** 通用内容行（模拟文字段落） */
export function SkeletonText({
  lines = 3,
  lastWidth = '60%',
  gap = 'gap-2',
}: {
  lines?: number;
  lastWidth?: string;
  gap?: string;
}) {
  return (
    <div className={`flex flex-col ${gap}`}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine
          key={i}
          width={i === lines - 1 ? lastWidth : 'full'}
        />
      ))}
    </div>
  );
}

/** 卡片骨架 */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-xl border bg-card p-5 space-y-3 ${className}`}>
      <div className="flex items-center gap-3">
        <SkeletonCircle size="size-9" />
        <div className="flex-1 space-y-1.5">
          <SkeletonLine height="3" width="40%" />
          <SkeletonLine height="2" width="25%" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  );
}

/** 表格行骨架 */
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 border-b border-border px-4 py-3">
      {Array.from({ length: cols }, (_, i) => (
        <SkeletonLine
          key={i}
          width={i === 0 ? '40%' : i === 1 ? '20%' : '15%'}
          height="3"
        />
      ))}
    </div>
  );
}

/** 列表项骨架 */
export function SkeletonListItem({ avatar = true }: { avatar?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {avatar && <SkeletonCircle size="size-8" />}
      <div className="flex-1 space-y-1.5">
        <SkeletonLine height="3" width="50%" />
        <SkeletonLine height="2" width="30%" />
      </div>
    </div>
  );
}
