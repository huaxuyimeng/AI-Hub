'use client';

// 来源：.cursor/skills/workbench-ui-designer §5.4 + §6.5
// Settings 重做：左侧 section 导航 + 右侧面板
// Sections: 账号 / 外观 / 通知 / 团队 / 计费 / API Key

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc';
import {
  IconUser,
  IconPalette,
  IconBell,
  IconUsers,
  IconCreditCard,
  IconKey,
  IconCopy,
  IconRefresh,
  IconCheck,
} from '@tabler/icons-react';
import { ThemeSettingsPanel } from '@/components/theme-settings-panel';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import type { TablerIconType } from '@/lib/icon-type';

type SectionId = 'account' | 'appearance' | 'notifications' | 'team' | 'billing' | 'api';

const SECTIONS: { id: SectionId; label: string; icon: TablerIconType }[] = [
  { id: 'account', label: '账号', icon: IconUser },
  { id: 'appearance', label: '外观', icon: IconPalette },
  { id: 'notifications', label: '通知', icon: IconBell },
  { id: 'team', label: '团队', icon: IconUsers },
  { id: 'billing', label: '计费', icon: IconCreditCard },
  { id: 'api', label: 'API Key', icon: IconKey },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('account');

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      {/* Top header */}
      <div className="border-b bg-card px-8 py-4">
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">账号 / 外观 / 团队 / 计费 / API</p>
      </div>

      <div className="mx-auto flex max-w-5xl gap-6 px-8 py-6">
        {/* Section nav */}
        <aside className="w-48 shrink-0">
          <nav className="space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition ' +
                  (section === id
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-foreground/80 hover:bg-accent hover:text-foreground')
                }
              >
                <Icon size={14} className="shrink-0" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Panel */}
        <main className="min-w-0 flex-1">
          {section === 'account' && <AccountPanel />}
          {section === 'appearance' && <AppearancePanel />}
          {section === 'notifications' && <NotificationsPanel />}
          {section === 'team' && <TeamPanel />}
          {section === 'billing' && <BillingPanel />}
          {section === 'api' && <ApiKeysPanel />}
        </main>
      </div>
    </div>
  );
}

/* =========================================================================
 * Account
 * ========================================================================= */

function AccountPanel() {
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
        <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
          <Field label="Tenant ID" value={session?.user?.tenantId ?? '—'} mono />
          <Field label="角色" value={session?.user?.role ?? 'MEMBER'} />
          <Field label="用户 ID" value={session?.user?.id ?? '—'} mono />
          <Field label="登录方式" value={session?.user?.image ? 'GitHub OAuth' : '邮箱密码'} />
        </div>
      </div>
    </Section>
  );
}

/* =========================================================================
 * Appearance
 * ========================================================================= */

function AppearancePanel() {
  return (
    <Section title="外观" subtitle="主题、强调色、自定义背景">
      <ThemeSettingsPanel />
      <div className="mt-4 rounded-lg border bg-card p-4 text-xs text-muted-foreground">
        <div className="mb-1 text-sm font-medium text-foreground">提示</div>
        主题会即时同步到所有设备。背景图上传到 Cloudflare R2 后会在所有设备共享。
      </div>
    </Section>
  );
}

/* =========================================================================
 * Notifications
 * ========================================================================= */

function NotificationsPanel() {
  const [emailAnalysisDone, setEmailAnalysisDone] = useState(true);
  const [emailWeekly, setEmailWeekly] = useState(true);
  const [emailQuotaWarn, setEmailQuotaWarn] = useState(true);
  const toast = useToast();

  function persist(label: string) {
    // 写 tRPC preferences.updateTheme 不可，扩一个 prefs 字段；现在用本地 state + toast
    // P5 阶段：扩 preferences router
    toast.info(`「${label}」偏好已更新`);
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
            persist('代码分析完成通知');
          }}
        />
        <NotifRow
          label="周报"
          desc="每周一发送用量摘要"
          checked={emailWeekly}
          onChange={(v) => {
            setEmailWeekly(v);
            persist('周报通知');
          }}
        />
        <NotifRow
          label="配额预警"
          desc="月用量达到 80% 时告警"
          checked={emailQuotaWarn}
          onChange={(v) => {
            setEmailQuotaWarn(v);
            persist('配额预警通知');
          }}
        />
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        通知偏好仅保存在本地。P5 阶段会同步到服务器。
      </p>
    </Section>
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
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ' +
          (checked ? 'bg-primary' : 'bg-muted')
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

/* =========================================================================
 * Team
 * ========================================================================= */

function TeamPanel() {
  const { data: session } = useSession();
  const tenantId = session?.user?.tenantId;

  return (
    <Section
      title="团队"
      subtitle="你的工作空间"
    >
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 text-xs text-muted-foreground">Tenant ID</div>
        <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-[11px]">
          {tenantId ?? '—'}
        </code>
        <p className="mt-3 text-[11px] text-muted-foreground">
          当前为单租户计划。P5 阶段会上线团队成员邀请 / 角色管理（Owner / Admin / Member）。
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <PlanCard label="当前计划" value="FREE" sub="个人开发者" />
        <PlanCard label="本月用量" value="0 / 100K tokens" sub="用量告警阈值 80%" />
      </div>
    </Section>
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

/* =========================================================================
 * Billing
 * ========================================================================= */

function BillingPanel() {
  return (
    <Section title="计费" subtitle="订阅计划与发票">
      <div className="rounded-lg border bg-card p-5">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          当前计划
        </div>
        <div className="mb-1 text-2xl font-bold">FREE</div>
        <div className="mb-4 text-xs text-muted-foreground">100K tokens / 月 · 单租户 · 单成员</div>
        <div className="grid grid-cols-3 gap-2">
          <PlanBadge label="FREE" price="¥0" current />
          <PlanBadge label="PRO" price="¥299" sub="/ 月 · 5M tokens" />
          <PlanBadge label="TEAM" price="¥999" sub="/ 月 · 20M tokens" />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        P5 阶段接入 Stripe；届时升级套餐立即生效并开发票。
      </p>
    </Section>
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

/* =========================================================================
 * API Keys
 * ========================================================================= */

function ApiKeysPanel() {
  const utils = trpc.useUtils();
  const listApiKeys = trpc.project.listApiKeys.useQuery();
  const toast = useToast();
  const [askConfirm, ConfirmNode] = useConfirm();
  const createKey = trpc.project.createApiKey.useMutation({
    onSuccess: () => utils.project.listApiKeys.invalidate(),
  });
  const revokeKey = trpc.project.revokeApiKey.useMutation({
    onSuccess: () => utils.project.listApiKeys.invalidate(),
  });

  const [newName, setNewName] = useState('');
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleCreate() {
    if (!newName.trim()) return;
    createKey.mutate(
      { name: newName },
      {
        onSuccess: (data) => {
          setJustCreated(data.plainKey);
          setNewName('');
          toast.success('API Key 已创建');
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  function handleCopy(key: string) {
    navigator.clipboard.writeText(key);
    setCopied(true);
    toast.success('已复制到剪贴板');
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleRevoke(id: string, label: string) {
    const ok = await askConfirm({
      title: '撤销 API Key',
      description: `撤销 Key「${label}」？该 Key 立即失效，使用它的应用会得到 401 错误。`,
      confirmText: '撤销',
      destructive: true,
    });
    if (ok) {
      revokeKey.mutate(
        { id },
        {
          onSuccess: () => toast.info('已撤销'),
          onError: (e) => toast.error(e.message),
        }
      );
    }
  }

  return (
    <Section
      title="API Key"
      subtitle="用于调用 REST API（如 /api/v1/projects）。仅在创建时显示明文一次。"
    >
      <div className="mb-4 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Key 名称（如：本地开发）"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!newName.trim() || createKey.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          <IconKey size={14} />
          {createKey.isPending ? '创建中…' : '创建'}
        </button>
      </div>

      {justCreated && (
        <div className="mb-4 animate-fade-in rounded-md border border-success/30 bg-success/10 p-3">
          <div className="mb-1.5 text-xs font-medium text-success">
            新 Key 已创建（仅显示一次）：
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-[11px]">
              {justCreated}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(justCreated)}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent"
            >
              {copied ? (
                <>
                  <IconCheck size={12} className="text-success" />
                  已复制
                </>
              ) : (
                <>
                  <IconCopy size={12} />
                  复制
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">名称</th>
              <th className="px-4 py-2 text-left font-medium">前缀</th>
              <th className="px-4 py-2 text-left font-medium">创建时间</th>
              <th className="px-4 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {listApiKeys.data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  还没有 API Key
                </td>
              </tr>
            )}
            {listApiKeys.data?.items.map((k) => (
              <tr key={k.id} className="border-t hover:bg-accent/30 transition">
                <td className="px-4 py-2.5">{k.label ?? '未命名'}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">…{k.keyLast4}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {new Date(k.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id, k.label ?? '未命名')}
                    className="inline-flex items-center gap-1 rounded-md p-1.5 text-destructive opacity-70 hover:bg-destructive/10 hover:opacity-100"
                    title="撤销"
                  >
                    <IconRefresh size={12} />
                    撤销
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ConfirmNode()}
    </Section>
  );
}

/* =========================================================================
 * 公共组件
 * ========================================================================= */

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