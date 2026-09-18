import { IconLoader2 } from '@tabler/icons-react';

// P-10 修复：/ 页面 redirect 时显示 loading，避免空白闪烁
// Next.js App Router 约定：app/loading.tsx 在路由切换时自动渲染
export default function RootLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <IconLoader2 size={28} className="animate-spin text-primary" />
        <div className="text-xs tracking-wide">加载中…</div>
      </div>
    </div>
  );
}
