// C-08: StatCard 归并（workbench + usage 共用）
import Link from 'next/link';

export function StatCard({
  label,
  value,
  loading,
  href,
}: {
  label: string;
  value: number | string | undefined;
  loading: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border bg-card p-4 transition hover:border-primary"
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">
        {loading ? '—' : value ?? '—'}
      </div>
    </Link>
  );
}
