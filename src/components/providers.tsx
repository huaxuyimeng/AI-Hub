'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { TRPCProvider } from '@/lib/trpc-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/toast';
import { DEFAULT_THEME } from '@/lib/themes';

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
            {children}
            {/* 主题切换器统一在 AppShell footer 渲染，避免双按钮重复 */}
          </ThemeProvider>
        </ToastProvider>
      </TRPCProvider>
    </SessionProvider>
  );
}