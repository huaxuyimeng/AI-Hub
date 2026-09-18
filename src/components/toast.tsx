'use client';

// 全局 Toast 系统 — 替代内联 error 框
// 用法：const toast = useToast(); toast.error('xxx'); toast.success('xxx');

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconInfoCircle,
} from '@tabler/icons-react';
import type { TablerIconType } from '@/lib/icon-type';

type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
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
  info: 'border-foreground/20 bg-foreground/5 text-foreground',
  warning: 'border-warning/40 bg-warning/10 text-warning',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // C-9 修复：用 ref 追踪所有未触发的定时器，Provider 卸载时统一清理，
  // 避免 callback 在已卸载组件上 setState（"setState on unmounted component"）
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Provider 卸载时清理所有未触发的 timer
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    // H-31 修复：crypto.randomUUID() 全局唯一，避免 Date.now()+Math.random() 在同一毫秒多次 push 时碰撞
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    setItems((prev) => [...prev, { id, kind, message }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, kind === 'error' ? 5500 : 3500);
    timersRef.current.add(timer);
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
                // P0: 缩短 slide-in 到 220ms；加 .gpu 类强制 GPU 提升
                'gpu pointer-events-auto flex w-80 items-start gap-2 rounded-md border px-3 py-2 shadow-lg animate-slide-in ' +
                KIND_STYLES[t.kind]
              }
              style={{ willChange: 'transform, opacity' }}
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