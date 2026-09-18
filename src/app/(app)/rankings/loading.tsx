// V-19: 排行页骨架 loading
// 匹配 rankings/page.tsx 的 UI 结构：搜索 + 统计 + Top3 + 图表 + 表格
import { SkeletonLine } from '@/components/ui/skeleton';

function StatCardSkeleton({ w = 'w-28' }: { w?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-1.5">
      <SkeletonLine height="2" width="50%" />
      <SkeletonLine height="4" width="70%" />
    </div>
  );
}

export default function RankingsLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto page-enter">
        <div className="mx-auto max-w-6xl px-8 py-6 space-y-6">
          {/* 页面头部 */}
          <div className="space-y-1.5">
            <SkeletonLine height="5" width="30%" />
            <SkeletonLine height="2" width="50%" />
          </div>

          {/* 搜索框骨架 */}
          <SkeletonLine height="9" width="full" />

          {/* 统计概览骨架 */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>

          {/* Top3 + 图表区域 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Top3 骨架 */}
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <SkeletonLine height="3" width="40%" />
              {[
                { h: 'h-10', w: 'w-10', name: 'w-40%', sub: 'w-30%' },
                { h: 'h-9', w: 'w-9', name: 'w-36%', sub: 'w-28%' },
                { h: 'h-8', w: 'w-8', name: 'w-32%', sub: 'w-24%' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`animate-pulse rounded-full bg-muted ${item.h} ${item.w}`} />
                  <div className="flex-1 space-y-1">
                    <SkeletonLine height="3" width={item.name} />
                    <SkeletonLine height="2" width={item.sub} />
                  </div>
                </div>
              ))}
            </div>

            {/* 图表骨架 */}
            <div className="rounded-xl border bg-card p-5 lg:col-span-2">
              <SkeletonLine height="3" width="30%" className="mb-4" />
              <div className="flex items-end gap-2" style={{ height: '200px' }}>
                {Array.from({ length: 12 }, (_, i) => (
                  <div
                    key={i}
                    className="flex-1 animate-pulse rounded-t bg-muted"
                    style={{ height: `${30 + Math.random() * 60}%` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 表格骨架 */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="border-b px-4 py-3 space-y-1.5">
              <SkeletonLine height="2" width="100%" />
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0">
                <SkeletonLine height="3" width="5%" />
                <SkeletonLine height="3" width="30%" />
                <SkeletonLine height="3" width="15%" />
                <SkeletonLine height="3" width="12%" />
                <SkeletonLine height="3" width="12%" />
                <SkeletonLine height="3" width="10%" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
