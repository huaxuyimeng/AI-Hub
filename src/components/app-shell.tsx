'use client';

// 来源：.cursor/skills/workbench-ui-designer §5.2-5.4
// 三模式工作台壳：240px sidebar（可折叠 56px）+ 内容区
//
// v3 改进：
// - 折叠状态时主题切换器/退出按钮也用 icon-only 模式可见
// - Brand 区 padding-y 加大，留呼吸空间
// - "模式" 和 "页面" 之间加视觉分割（细线 + 间距）
// - 用户卡 / 退出按钮在折叠时只有 icon

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  IconHome,
  IconFolders,
  IconMessages,
  IconChartBar,
  IconPlug,
  IconSettings,
  IconLogout,
  IconKey,
  IconChevronLeft,
  IconChevronRight,
  IconPalette,
} from '@tabler/icons-react';
import type { TablerIconType } from '@/lib/icon-type';
import { ThemeSwitcher } from './theme/theme-switcher';
import { ThemeToggle } from './theme-toggle';
import { useToast } from './toast';
import { trpc } from '@/lib/trpc';

interface User {
  id: string;
  name: string | null;
  email: string | null;
  tenantId: string | null;
  role: 'ADMIN' | 'MEMBER';
  image?: string | null;  // C-06: 头像 URL
}

const NAV_MODES = [
  { href: '/workbench', label: '工作台', icon: IconHome, desc: '首页 / 仪表盘' },
];
const NAV_PAGES = [
  { href: '/projects', label: '项目', icon: IconFolders },
  { href: '/chat', label: '对话', icon: IconMessages },
  { href: '/usage', label: '用量', icon: IconChartBar },
  { href: '/plugins', label: '插件', icon: IconPlug },
  { href: '/settings', label: '设置', icon: IconSettings },
];

const COLLAPSE_KEY = 'aihub-sidebar-mode';

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const [collapsed, toggle] = useLocalCollapse(false);
  const toast = useToast();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside
        className={
          'shrink-0 flex flex-col border-r bg-card transition-[width] duration-200 ' +
          (collapsed ? 'w-16' : 'w-60')
        }
      >
        {/* Brand */}
        <div className={'flex h-16 items-center gap-2.5 border-b ' + (collapsed ? 'justify-center px-2' : 'px-4')}>
          {user.image ? (
            // C-06: 优先显示用户上传的头像
            <img
              src={user.image}
              alt={user.name ?? 'avatar'}
              className="h-9 w-9 shrink-0 rounded-md object-cover shadow-sm"
            />
          ) : (
            // fallback：首字母
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold shadow-sm">
              {(user.name ?? user.email ?? 'A')[0].toUpperCase()}
            </div>
          )}
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold">AIHub</span>
              <span className="truncate text-[10px] text-muted-foreground">
                {user.name ?? 'Workbench'}
              </span>
            </div>
          )}
        </div>

        {/* 模式 + 分割线 + 页面 */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {/* 模式 group */}
          {!collapsed && (
            <SectionLabel>模式</SectionLabel>
          )}
          <div className="space-y-0.5">
            {NAV_MODES.map(({ href, label, icon: Icon, desc }) => (
              <NavLink
                key={href}
                href={href}
                icon={Icon}
                label={label}
                desc={desc}
                active={pathname === href}
                collapsed={collapsed}
              />
            ))}
          </div>

          {/* Divider 视觉分组 */}
          <div className="my-3 border-t" />

          {/* 页面 group */}
          {!collapsed && <SectionLabel>页面</SectionLabel>}
          <div className="space-y-0.5">
            {NAV_PAGES.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/');
              return (
                <NavLink
                  key={href}
                  href={href}
                  icon={Icon}
                  label={label}
                  active={active}
                  collapsed={collapsed}
                />
              );
            })}
          </div>
        </nav>

        {/* Footer: 主题 + 折叠 + 用户 */}
        <div className="border-t p-2 space-y-1">
          {!collapsed ? (
            <>
              <div className="flex items-center justify-between gap-2 px-1 py-1">
                <ThemeToggle />
                <ThemeSwitcher />
                <button
                  type="button"
                  onClick={toggle}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="折叠侧栏"
                  aria-label="折叠侧栏"
                >
                  <IconChevronLeft size={14} />
                </button>
              </div>
              <div className="rounded-md border bg-background p-2 text-xs">
                <div className="mb-1 truncate font-medium">{user.name ?? user.email}</div>
                <div className="mb-1.5 flex items-center gap-1 text-[10px]">
                  <IconKey size={11} className="text-muted-foreground" />
                  <span className="font-mono text-muted-foreground">
                    {user.tenantId ? user.tenantId.slice(0, 8) + '…' : '—'}
                  </span>
                  <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-primary">{user.role}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    toast.info('已退出');
                    signOut({ callbackUrl: '/login' });
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <IconLogout size={12} />
                  退出登录
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <ThemeToggle />
              <ThemeSwitcher compact />
              <button
                type="button"
                onClick={toggle}
                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="展开侧栏"
                aria-label="展开侧栏"
              >
                <IconChevronRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  toast.info('已退出');
                  signOut({ callbackUrl: '/login' });
                }}
                className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="退出登录"
                aria-label="退出登录"
              >
                <IconLogout size={14} />
              </button>
            </div>
          )}

          {/* M-03: 快捷键提示（仅展开态） */}
          {!collapsed && (
            <div className="mt-2 px-3 py-1.5 text-center text-[10px] text-muted-foreground/70">
              <kbd className="rounded border border-border bg-background px-1 font-mono">⌘K</kbd>
              <span className="ml-1">命令面板</span>
            </div>
          )}
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  desc,
  active,
  collapsed,
}: {
  href: string;
  icon: TablerIconType;
  label: string;
  desc?: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={
        'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition ' +
        (active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-foreground/80 hover:bg-accent hover:text-foreground')
      }
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs">{label}</span>
          {desc && <span className="truncate text-[10px] text-muted-foreground">{desc}</span>}
        </div>
      )}
    </Link>
  );
}

// I-03: 双层持久化（localStorage + tRPC preferences.setSidebar）
// C-05: 注入 R-01 默认折叠逻辑（< 768px 默认 collapsed）
// R-01: 优先服务端偏好 > localStorage > 当前 viewport
function useLocalCollapse(mobileDefault = true): [boolean, () => void] {
  const { status } = useSession();
  const setSidebarMut = trpc.preferences.setSidebar.useMutation();
  const remotePrefs = trpc.preferences.get.useQuery(undefined, {
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
  const [v, setV] = useState(false); // SSR 一致：默认展开，避免首屏闪烁
  const hydrated = React.useRef(false);

  // 初次挂载：localStorage > 移动端默认
  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
    const stored = (() => {
      try {
        return localStorage.getItem(COLLAPSE_KEY);
      } catch {
        return null;
      }
    })();
    if (stored === '1') setV(true);
    else if (stored === '0') setV(false);
    else if (isMobile && mobileDefault) setV(true);
    hydrated.current = true;
  }, [mobileDefault]);

  // 已认证用户：服务端偏好覆盖 localStorage（仅一次）
  // I-03: preferences.get 已返回 sidebarMode，可以直接读取
  const hasSyncedRemoteRef = React.useRef(false);
  useEffect(() => {
    if (hasSyncedRemoteRef.current) return;
    if (status !== 'authenticated' || !remotePrefs.data || !hydrated.current) return;
    const remote = remotePrefs.data.sidebarMode;
    const collapsed = remote === 'collapsed';
    if (collapsed !== v) {
      setV(collapsed);
      try {
        localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
      } catch {}
    }
    hasSyncedRemoteRef.current = true;
  }, [status, remotePrefs.data, hydrated.current, v]);

  const toggle = React.useCallback(() => {
    setV((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {}
      // 服务端持久化（静默失败也行）
      if (status === 'authenticated') {
        setSidebarMut.mutate(
          { mode: next ? 'collapsed' : 'expanded' },
          {
            onError: () => {
              /* 静默：本地已保存 */
            },
          }
        );
      }
      return next;
    });
  }, [status, setSidebarMut]);

  return [v, toggle];
}