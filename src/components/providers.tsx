'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { TRPCProvider } from '@/lib/trpc-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
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
            <div className="fixed bottom-4 right-4 z-50">
              <ThemeToggle />
            </div>
          </ThemeProvider>
        </ToastProvider>
      </TRPCProvider>
    </SessionProvider>
  );
}