'use client';

// 统一的确认对话框（替换原生 confirm()）
// 支持：
// - 标题 + 描述
// - 危险按钮样式（destructive）
// - 确认 / 取消按钮文案自定义
// - ESC 关闭
// - Focus trap（焦点自动落在取消按钮，避免误触）
// - H-33 修复：用 createPortal 渲染到 document.body，绕过祖先 transform/filter 包含块
//          （之前 fixed inset-0 被 sidebar 的 transform 锚定，弹窗跑到左下角）

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

  // H-33: portal 只在 client mount 后才挂载，避免 SSR 报 document is not defined
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      // P0 流畅度：把背景层动画做成 GPU 友好的 fade + will-change
      className="gpu fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      style={{
        animation: 'analytics-fadeIn 140ms ease-out both',
        willChange: 'opacity',
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="gpu w-full max-w-md rounded-xl border surface-elevated p-5 shadow-2xl"
        style={{
          animation: 'analytics-modalIn 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
          willChange: 'transform, opacity',
        }}
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
            // P0: 加 transition-colors，让 hover 反馈即时
            className="gpu rounded-md border bg-background px-4 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-accent"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              'gpu rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-150 ' +
              (destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90')
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Hook：返回 [confirm, ConfirmNode]
 * 用法：
 *   const [askConfirm, ConfirmNode] = useConfirm();
 *   <button onClick={() => askConfirm({...}).then(ok => ok && trash.mutate())} />
 *   {ConfirmNode}
 */
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