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
    <div className={action ? 'flex items-center justify-between border-b bg-card px-8 py-4' : 'border-b bg-card px-8 py-4'}>
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
