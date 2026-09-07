// M-01 m: 统一 PageHeader 组件（projects 扩展版 + 基础版共用）
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={action ? 'flex items-center justify-between gap-4 border-b bg-card px-4 py-4 sm:px-8' : 'border-b bg-card px-4 py-4 sm:px-8'}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
