'use client';

// 统一的确认对话框（替换原生 confirm()）
// 支持：
// - 标题 + 描述
// - 危险按钮样式（destructive）
// - 确认 / 取消按钮文案自定义
// - ESC 关闭
// - Focus trap（焦点自动落在取消按钮，避免误触）

import { useEffect, useRef } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // 打开时焦点放取消按钮（防误触）
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
  }, [open]);

  // 简单 focus trap + Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Tab') {
        // 修复：扩展 selector 覆盖所有可聚焦元素（button/input/select/textarea/a/[tabindex]）
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      } else if (e.key === 'Enter' && document.activeElement === cancelRef.current) {
        // 取消按钮的 Enter 已经会触发 onClick，不需要额外处理
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-xl border surface-elevated p-5 shadow-2xl animate-slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          {destructive && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <IconAlertTriangle size={18} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-base font-semibold">
              {title}
            </h2>
            <p id="confirm-desc" className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border bg-background px-4 py-1.5 text-sm font-medium transition hover:bg-accent"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              'rounded-md px-4 py-1.5 text-sm font-medium transition ' +
              (destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90')
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook：返回 [confirm, ConfirmNode]
 * 用法：
 *   const [askConfirm, ConfirmNode] = useConfirm();
 *   <button onClick={() => askConfirm({...}).then(ok => ok && trash.mutate())} />
 *   {ConfirmNode}
 */
import { useCallback, useState } from 'react';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export function useConfirm(): [
  (opts: ConfirmOptions) => Promise<boolean>,
  () => React.ReactNode,
] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const node = useCallback(() => {
    if (!opts) return null;
    return (
      <ConfirmDialog
        open
        title={opts.title}
        description={opts.description}
        confirmText={opts.confirmText}
        cancelText={opts.cancelText}
        destructive={opts.destructive}
        onConfirm={() => {
          resolverRef.current?.(true);
          resolverRef.current = null;
          setOpts(null);
        }}
        onCancel={() => {
          resolverRef.current?.(false);
          resolverRef.current = null;
          setOpts(null);
        }}
      />
    );
  }, [opts]);

  return [ask, node];
}