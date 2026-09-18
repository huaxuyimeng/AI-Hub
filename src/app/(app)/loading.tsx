// V-19: 路由级 loading——侧栏骨架 + 内容区通用骨架
// AppShell 布局始终可见，只给内容区一个流畅的骨架
import { SkeletonLine, SkeletonCard } from '@/components/ui/skeleton';

export default function AppGroupLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 内容区骨架 */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* 页面头部骨架 */}
          <div className="space-y-2">
            <SkeletonLine height="5" width="30%" />
            <SkeletonLine height="2" width="50%" />
          </div>

          {/* 通用卡片骨架 */}
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    </div>
  );
}
