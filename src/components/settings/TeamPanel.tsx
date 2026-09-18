'use client';

import { useSession } from 'next-auth/react';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function PlanCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export function TeamPanel() {
  const { data: session } = useSession();
  const tenantId = session?.user?.tenantId;

  return (
    <Section title="团队" subtitle="你的工作空间">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 text-xs text-muted-foreground">Tenant ID</div>
        <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-[11px]">
          {tenantId ?? '—'}
        </code>
        <p className="mt-3 text-[11px] text-muted-foreground">
          当前为单租户计划。P5 阶段会上线团队成员管理（Owner / Admin / Member）。
        </p>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <PlanCard label="当前计划" value="FREE" sub="个人开发版" />
        <PlanCard label="本月用量" value="0 / 100K tokens" sub="用量达到 80% 时预警" />
      </div>
    </Section>
  );
}
