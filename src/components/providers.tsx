'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { TRPCProvider } from '@/lib/trpc-provider';
import { ThemeProvider, useTheme } from '@/components/theme-provider';
import { ToastProvider } from '@/components/toast';
import { DEFAULT_THEME } from '@/lib/themes';
import { BgLayer } from '@/components/theme/bg-layer';

/**
 * ThemedShell — 在 ThemeProvider 内部消费 theme，
 *   把壁纸背景层和 children 一起渲染。
 */
function ThemedShell({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <>
      {/* 壁纸背景层（绝对定位铺满，z-index 低于所有内容） */}
      <BgLayer url={theme.bgUrl} opacity={theme.bgOpacity} />
      {children}
      {/* 主题切换器统一在 AppShell footer 渲染，避免双按钮重复 */}
    </>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  // 客户端 bootstrap：从 layout 注入的 window.__AIHUB_R2_READY 读取
  useEffect(() => {
    // placeholder — 真正的注入在 layout.tsx
  }, []);

  return (
    <SessionProvider>
      <TRPCProvider>
        <ToastProvider>
          <ThemeProvider defaultTheme={DEFAULT_THEME}>
            <ThemedShell>{children}</ThemedShell>
          </ThemeProvider>
        </ToastProvider>
      </TRPCProvider>
    </SessionProvider>
  );
}