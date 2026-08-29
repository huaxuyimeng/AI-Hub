'use client';

// 全局 Toast 系统 — 替代内联 error 框
// 用法：const toast = useToast(); toast.error('xxx'); toast.success('xxx');

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconInfoCircle,
} from '@tabler/icons-react';
import type { TablerIconType } from '@/lib/icon-type';

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
  warning: (msg: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICON_MAP: Record<ToastKind, TablerIconType> = {
  success: IconCheck,
  error: IconAlertTriangle,
  info: IconInfoCircle,
  warning: IconAlertTriangle,
};

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  info: 'border-blue-400 bg-blue-50/10 text-blue-500 dark:text-blue-300',
  warning: 'border-warning/40 bg-warning/10 text-warning',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, kind === 'error' ? 5500 : 3500);
  }, []);

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
    warning: (m) => push('warning', m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {items.map((t) => {
          const Icon = ICON_MAP[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={
                'pointer-events-auto flex w-80 items-start gap-2 rounded-md border px-3 py-2 shadow-lg animate-slide-in ' +
                KIND_STYLES[t.kind]
              }
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <div className="flex-1 text-xs">{t.message}</div>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((i) => i.id !== t.id))}
                className="rounded p-0.5 opacity-60 hover:bg-black/10 hover:opacity-100"
              >
                <IconX size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? {
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {},
  };
}