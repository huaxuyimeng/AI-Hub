import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { CommandPalette } from '@/components/layout/command-palette';
import { PageGradient } from '@/components/news/PageGradient';

// 所有需要登录的页面都走 (app) route group，统一鉴权
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/login');
  }
  return (
    <AppShell
      user={{
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        tenantId: session.user.tenantId ?? null,
        role: session.user.role ?? 'MEMBER',
      }}
    >
      {/* 全局柔光 blob（鼠标跟随）—— 渲染在所有 children 之后之前，
          position: fixed 不占布局；z-0 + 内容 z-10 保证内容盖在上面 */}
      <PageGradient />
      {children}
      <CommandPalette />
    </AppShell>
  );
}