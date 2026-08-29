// I-08: 通用错误状态组件（带重试按钮）
import { IconAlertCircle } from '@tabler/icons-react';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  message = '加载失败',
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center ${className}`}>
      <IconAlertCircle size={20} className="text-destructive" />
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs transition hover:bg-accent"
        >
          重试
        </button>
      )}
    </div>
  );
}
