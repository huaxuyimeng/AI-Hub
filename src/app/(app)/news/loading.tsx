// V-19: 新闻页骨架 loading
// 匹配 news/page.tsx 的 UI 结构：header + 分类 + 卡片列表
import { SkeletonLine, SkeletonCard } from '@/components/ui/skeleton';

function NewsCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      {/* 头部：来源 + 时间 */}
      <div className="flex items-center justify-between">
        <SkeletonLine height="2" width="20%" />
        <SkeletonLine height="2" width="15%" />
      </div>
      {/* 标题 */}
      <SkeletonLine height="3" width="90%" />
      <SkeletonLine height="3" width="65%" />
      {/* 摘要 */}
      <SkeletonLine height="2" width="full" />
      <SkeletonLine height="2" width="80%" />
      {/* 标签 */}
      <div className="flex gap-1.5 pt-1">
        <SkeletonLine height="2" width="15%" />
        <SkeletonLine height="2" width="10%" />
      </div>
    </div>
  );
}

export default function NewsLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto page-enter">
        <div className="mx-auto max-w-4xl px-8 py-6">
          {/* 顶部：标题 + 时钟占位 + 分类 */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <SkeletonLine height="4" width="25%" />
              <SkeletonLine height="2" width="40%" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <SkeletonLine height="4" width="80px" />
              <SkeletonLine height="2" width="50px" />
            </div>
          </div>

          {/* 分类 tab 骨架 */}
          <div className="mb-5 flex gap-2">
            {[60, 70, 80, 60, 50].map((w, i) => (
              <SkeletonLine key={i} height="5" width={`${w}px`} />
            ))}
          </div>

          {/* 搜索框骨架 */}
          <div className="mb-5">
            <SkeletonLine height="8" width="full" />
          </div>

          {/* 新闻卡片列表 */}
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <NewsCardSkeleton key={i} />
            ))}
          </div>

          {/* 加载更多骨架 */}
          <div className="mt-6 flex justify-center">
            <SkeletonLine height="8" width="120px" />
          </div>
        </div>
      </div>
    </div>
  );
}
