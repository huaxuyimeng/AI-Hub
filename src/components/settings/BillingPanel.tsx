'use client';

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

function PlanBadge({ label, price, sub, current }: { label: string; price: string; sub?: string; current?: boolean }) {
  return (
    <div
      className={
        'rounded-md border p-3 text-center ' +
        (current ? 'border-primary bg-primary/10' : 'bg-card')
      }
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold">{price}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function BillingPanel() {
  return (
    <Section title="计费" subtitle="订阅计划与发票">
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          当前计划
        </div>
        <div className="mb-1 text-2xl font-semibold tracking-tight">FREE</div>
        <div className="mb-4 text-xs text-muted-foreground">100K tokens / 月 · 单租用 · 单成员</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <PlanBadge label="FREE" price="¥0" current />
          <PlanBadge label="PRO" price="¥299" sub="/ 月 · 5M tokens" />
          <PlanBadge label="TEAM" price="¥999" sub="/ 月 · 20M tokens" />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        P5 阶段接入 Stripe；届时升级套餐立刻生效并开具发票。
      </p>
    </Section>
  );
}
