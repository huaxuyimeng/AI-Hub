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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={'mt-0.5 ' + (mono ? 'font-mono text-[11px] break-all' : '')}>{value}</div>
    </div>
  );
}

export function AccountPanel() {
  const { data: session } = useSession();

  return (
    <Section title="账号信息" subtitle="你的个人资料与会话信息">
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-medium text-muted-foreground">
            {(session?.user?.name ?? session?.user?.email ?? '?')[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {session?.user?.name ?? '未命名'}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {session?.user?.email}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 text-xs sm:grid-cols-2">
          <Field label="Tenant ID" value={session?.user?.tenantId ?? '—'} mono />
          <Field label="角色" value={session?.user?.role ?? 'MEMBER'} />
          <Field label="用户 ID" value={session?.user?.id ?? '—'} mono />
          <Field label="登录方式" value={session?.user?.image ? 'GitHub OAuth' : '邮箱密码'} />
        </div>
      </div>
    </Section>
  );
}
