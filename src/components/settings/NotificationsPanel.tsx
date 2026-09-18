'use client';

import { useState } from 'react';
import { useToast } from '@/components/toast';

const NOTIF_KEYS = ['emailAnalysisDone', 'emailWeekly', 'emailQuotaWarn'] as const;
type NotifKey = typeof NOTIF_KEYS[number];

function loadNotif(key: NotifKey, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(`aihub:notif:${key}`);
  return stored !== null ? stored === 'true' : fallback;
}

function saveNotif(key: NotifKey, value: boolean): void {
  localStorage.setItem(`aihub:notif:${key}`, String(value));
}

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

function NotifRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between border-b px-4 py-3 last:border-b-0 hover:bg-accent/30 transition">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ' +
          (checked ? 'bg-primary' : 'bg-foreground/20 dark:bg-foreground/25')
        }
      >
        <span
          className={
            'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition ' +
            (checked ? 'translate-x-5' : 'translate-x-0.5')
          }
        />
      </button>
    </label>
  );
}

export function NotificationsPanel() {
  const [emailAnalysisDone, setEmailAnalysisDone] = useState(() => loadNotif('emailAnalysisDone', true));
  const [emailWeekly, setEmailWeekly] = useState(() => loadNotif('emailWeekly', true));
  const [emailQuotaWarn, setEmailQuotaWarn] = useState(() => loadNotif('emailQuotaWarn', true));
  const toast = useToast();

  function persist(key: NotifKey, value: boolean, label: string) {
    saveNotif(key, value);
    toast.success(`「${label}」设置已保存`);
  }

  return (
    <Section title="通知" subtitle="选择要接收的邮件通知">
      <div className="rounded-lg border bg-card">
        <NotifRow
          label="代码分析完成"
          desc="分析运行结束（成功或失败）发邮件通知"
          checked={emailAnalysisDone}
          onChange={(v) => {
            setEmailAnalysisDone(v);
            persist('emailAnalysisDone', v, '代码分析完成通知');
          }}
        />
        <NotifRow
          label="周报"
          desc="每周一发送用量摘要"
          checked={emailWeekly}
          onChange={(v) => {
            setEmailWeekly(v);
            persist('emailWeekly', v, '周报通知');
          }}
        />
        <NotifRow
          label="配额预警"
          desc="月用量达到 80% 时告警"
          checked={emailQuotaWarn}
          onChange={(v) => {
            setEmailQuotaWarn(v);
            persist('emailQuotaWarn', v, '配额预警通知');
          }}
        />
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        通知偏好保存在本地浏览器中，重置浏览器会恢复默认。
      </p>
    </Section>
  );
}
