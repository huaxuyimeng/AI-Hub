// V-19: 项目详情页骨架 loading
// 匹配 projects/[id]/page.tsx 的 UI 结构：三栏（文件树 + 预览 + 审查）
import { SkeletonLine } from '@/components/ui/skeleton';

export default function ProjectDetailLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏骨架 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="h-7 w-7 animate-pulse rounded-md bg-muted shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <SkeletonLine height="4" width="25%" />
            <SkeletonLine height="2" width="40%" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SkeletonLine height="6" width="80px" />
          <SkeletonLine height="6" width="100px" />
        </div>
      </div>

      {/* 三栏主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏：文件树 */}
        <div className="hidden w-64 shrink-0 overflow-y-auto border-r bg-card p-2 md:block">
          <div className="mb-2 flex items-center justify-between px-2">
            <SkeletonLine height="2" width="50px" />
            <div className="flex gap-1">
              <SkeletonLine height="5" width="20px" />
              <SkeletonLine height="5" width="20px" />
            </div>
          </div>
          {/* 假文件夹/文件条目 */}
          {[
            { indent: 0, name: 'w-60%', sub: 'w-40%' },
            { indent: 1, name: 'w-55%', sub: 'w-35%' },
            { indent: 1, name: 'w-50%', sub: 'w-30%' },
            { indent: 0, name: 'w-65%', sub: 'w-45%' },
            { indent: 1, name: 'w-52%', sub: 'w-32%' },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5" style={{ paddingLeft: `${8 + item.indent * 12}px` }}>
              <div className="h-3.5 w-3.5 animate-pulse rounded bg-muted shrink-0" />
              <div className="flex-1 space-y-1">
                <SkeletonLine height="2" width={item.name} />
                <SkeletonLine height="1.5" width={item.sub} />
              </div>
            </div>
          ))}
        </div>

        {/* 中+右栏：内容预览 + 审查按钮 */}
        <div className="flex flex-1 flex-col">
          {/* 预览区顶部 */}
          <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5">
            <SkeletonLine height="3" width="30%" />
            <SkeletonLine height="3" width="60px" />
          </div>
          {/* 代码内容骨架 */}
          <div className="flex-1 overflow-x-auto p-4 space-y-1.5">
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <SkeletonLine height="2.5" width="30px" className="shrink-0" />
                <SkeletonLine
                  height="2.5"
                  width={i % 3 === 0 ? '85%' : i % 2 === 0 ? '70%' : '90%'}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
