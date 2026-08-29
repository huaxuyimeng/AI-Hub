import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { CommandPalette } from '@/components/layout/command-palette';

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
      {children}
      <CommandPalette />
    </AppShell>
  );
}