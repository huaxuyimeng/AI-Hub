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
  IconNews,
  IconChartBar,
  IconRobot,
  IconLock,
} from '@tabler/icons-react';
import { ThemeSettingsPanel } from '@/components/theme-settings-panel';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import { ChatStylePanel } from '@/components/settings/ChatStylePanel';
import { AiKeysPanel } from '@/components/settings/AiKeysPanel';
import type { TablerIconType } from '@/lib/icon-type';

type SectionId =
  | 'account'
  | 'appearance'
  | 'notifications'
  | 'ai-style'
  | 'news'
  | 'rankings'
  | 'team'
  | 'billing'
  | 'ai-keys'
  | 'rest-api'
  | 'data-cache';

const SECTIONS: { id: SectionId; label: string; icon: TablerIconType }[] = [
  { id: 'account', label: '账号', icon: IconUser },
  { id: 'appearance', label: '外观', icon: IconPalette },
  { id: 'notifications', label: '通知', icon: IconBell },
  { id: 'ai-style', label: 'AI 对话风格', icon: IconRobot },
  { id: 'news', label: '新闻', icon: IconNews },
  { id: 'rankings', label: '排行', icon: IconChartBar },
  { id: 'team', label: '团队', icon: IconUsers },
  { id: 'billing', label: '计费', icon: IconCreditCard },
  { id: 'ai-keys', label: 'AI 模型 Key', icon: IconKey },
  { id: 'rest-api', label: 'REST API Key', icon: IconCopy },
  { id: 'data-cache', label: '数据与缓存', icon: IconLock },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('account');

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top header（固定高度，不参与 flex-grow） */}
      <div className="shrink-0 border-b bg-card px-8 py-4">
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">账号 / 外观 / 团队 / 计费 / API</p>
      </div>

      {/* 整个 tab 栏固定在页面最顶端（fixed），无论 header 多高 */}
      {/* 移动端：select 替代 */}
      <div className="sticky top-0 z-50 shrink-0 border-b bg-background/95 backdrop-blur-sm md:hidden">
        <div className="px-4 py-2">
          <select
            id="settings-section"
            value={section}
            onChange={(e) => setSection(e.target.value as SectionId)}
            className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
          >
            {SECTIONS.map(({ id, label }) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Desktop: 顶部水平 tab 固定在页面最顶端 */}
      <div className="sticky top-0 z-50 shrink-0 border-b bg-background/95 backdrop-blur-sm hidden md:block">
        <div className="mx-auto max-w-5xl px-8">
          <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-thin" aria-label="设置分类">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={
                  'group inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition ' +
                  (section === id
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-foreground/70 hover:border-foreground/30 hover:text-foreground')
                }
              >
                <Icon
                  size={16}
                  className={
                    'shrink-0 transition ' +
                    (section === id ? 'text-primary' : 'text-foreground/60 group-hover:text-foreground')
                  }
                />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* 内容区可滚动 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
          <main className="min-w-0">
            {section === 'account' && <AccountPanel />}
          {section === 'appearance' && <AppearancePanel />}
          {section === 'notifications' && <NotificationsPanel />}
          {section === 'ai-style' && <ChatStylePanel />}
          {section === 'news' && <NewsSettingsPanel />}
          {section === 'rankings' && <RankingsSettingsPanel />}
          {section === 'team' && <TeamPanel />}
          {section === 'billing' && <BillingPanel />}
          {section === 'ai-keys' && <AiKeysPanel />}
          {section === 'rest-api' && <ApiKeysPanel />}
          {section === 'data-cache' && (
            <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
              本模块尚未启用。如需 PPT 锁定清理 / 90 天快照归档 / R2 孤儿扫描，请先实现
              <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">src/server/routers/cache.ts</code>
              的 5 个 procedure。
            </div>
          )}
        </main>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
 * Data & Cache（Phase 4 占位，BUG-019 暂未实现）
 * ========================================================================= */

function DataCachePanel() {
  return (
    <Section
      title="数据与缓存"
      subtitle="PPT 缓存清理、价格快照归档、R2 孤儿扫描（Phase 4 待启用）"
    >
      <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        <div className="mb-2 text-sm font-medium text-foreground">待启用</div>
        本模块尚未启用。如需 PPT 锁定清理 / 90 天快照归档 / R2 孤儿扫描，请先实现
        <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">src/server/routers/cache.ts</code>
        的 5 个 procedure（<code className="font-mono text-xs">stats</code> /{' '}
        <code className="font-mono text-xs">getCleanupLog</code> /{' '}
        <code className="font-mono text-xs">cleanPptCache</code> /{' '}
        <code className="font-mono text-xs">cleanSnapshots</code> /{' '}
        <code className="font-mono text-xs">scanOrphanR2</code>
        ），然后在 <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">_app.ts</code>{' '}
        挂载 cacheRouter。
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
          <li>
            进度参见：<code className="font-mono">docs/实施记录/46-第二轮回扫与深层漏洞修复_2026.09.03.md</code>{' '}
            §四
          </li>
          <li>与本次新闻聚合 / 早报目标无任何关系，独立模块</li>
        </ul>
      </div>
    </Section>
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
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
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
        <div className="mb-1 text-2xl font-semibold tracking-tight">FREE</div>
        <div className="mb-4 text-xs text-muted-foreground">100K tokens / 月 · 单租户 · 单成员</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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

/* =========================================================================
 * 新闻设置
 * 来源：整合 plan §3.4
 * ========================================================================= */

function NewsSettingsPanel() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data: settings, isLoading } = trpc.preferences.getNewsSettings.useQuery();
  const { data: stats } = trpc.news.stats.useQuery();
  const refreshMutation = trpc.news.refresh.useMutation({
    onSuccess: (data: { totalItems: number }) => {
      toast.success(`抓取完成，共 ${data.totalItems} 条`);
      utils.news.stats.invalidate();
    },
  });
  const updateMutation = trpc.preferences.updateNewsSettings.useMutation({
    onSuccess: () => {
      toast.success('设置已保存');
      utils.preferences.getNewsSettings.invalidate();
    },
  });

  const REFRESH_OPTIONS = [
    { value: 1, label: '每 1 小时' },
    { value: 3, label: '每 3 小时' },
    { value: 6, label: '每 6 小时' },
    { value: 12, label: '每 12 小时' },
    { value: 24, label: '每天一次' },
  ];

  const CATEGORIES = ['AI Coding', '具身智能', 'AI政策'];

  if (isLoading) {
    return <Section title="新闻设置"><div className="py-8 text-center text-sm text-muted-foreground">加载中…</div></Section>;
  }

  return (
    <Section title="新闻设置" subtitle="控制新闻聚合的频率和关注范围">
      {/* 统计概览 */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">总新闻数</div>
          <div className="mt-1 text-2xl font-semibold">{stats?.total ?? 0}</div>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">今日新增</div>
          <div className="mt-1 text-2xl font-semibold">{stats?.today ?? 0}</div>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">活跃源</div>
          <div className="mt-1 text-2xl font-semibold">{stats?.sources ?? 0}</div>
        </div>
      </div>

      {/* 刷新频率 */}
      <div className="mb-4 rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">自动刷新频率</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              通过 Vercel Cron 定时抓取；过短的频率会增加 API 限额风险
            </p>
          </div>
          <select
            value={settings?.newsRefreshInterval ?? 3}
            onChange={(e) =>
              updateMutation.mutate({ newsRefreshInterval: parseInt(e.target.value) })
            }
            className="rounded-md border bg-card px-3 py-1.5 text-sm"
          >
            {REFRESH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* AI 早报提示 */}
      <div className="mb-4 rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">AI 早报提示</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              每天 7:00 自动生成 AI 早报；当天首次打开时右上角提示。关闭后仍可在新闻页手动查看
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.briefingToast ?? true}
            onClick={() =>
              updateMutation.mutate({ briefingToast: !(settings?.briefingToast ?? true) })
            }
            className={
              'relative h-5 w-9 rounded-full transition ' +
              ((settings?.briefingToast ?? true) ? 'bg-primary' : 'bg-muted')
            }
          >
            <span
              className={
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ' +
                ((settings?.briefingToast ?? true) ? 'left-[18px]' : 'left-0.5')
              }
            />
          </button>
        </div>

        {/* 早报/晚报时间窗口 */}
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <div>
            <div className="text-sm font-medium">晨报/晚报分割时间</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              每日此时间之前生成晨报，之后生成晚报；可设为整点钟点
            </p>
          </div>
          <select
            value={settings?.briefingWindowHour ?? 8}
            onChange={(e) =>
              updateMutation.mutate({ briefingWindowHour: parseInt(e.target.value) })
            }
            className="rounded-md border bg-card px-3 py-1.5 text-sm"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {h.toString().padStart(2, '0')}:00（{h < 12 ? '晨报' : '晚报'}）
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 关注分类 */}
      <div className="mb-4 rounded-lg border bg-card p-5">
        <div className="text-sm font-medium mb-3">关注的分类</div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const checked = settings?.newsCategories?.includes(cat) ?? false;
            return (
              <label
                key={cat}
                className={
                  'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs cursor-pointer transition ' +
                  (checked ? 'border-primary bg-primary/10' : 'hover:bg-accent')
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const list = e.target.checked
                      ? [...(settings?.newsCategories ?? []), cat]
                      : (settings?.newsCategories ?? []).filter((c) => c !== cat);
                    updateMutation.mutate({ newsCategories: list });
                  }}
                  className="h-3 w-3"
                />
                {cat}
              </label>
            );
          })}
        </div>
      </div>

      {/* 手动抓取 */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">手动立即抓取</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              立即从所有新闻源拉取最新数据（约 5-15 秒）
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {refreshMutation.isPending ? '抓取中…' : '立即抓取'}
          </button>
        </div>
      </div>
    </Section>
  );
}

/* =========================================================================
 * 排行设置
 * 来源：整合 plan §4 关联设置
 * ========================================================================= */

function RankingsSettingsPanel() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data: settings, isLoading } = trpc.preferences.getNewsSettings.useQuery();
  const updateMutation = trpc.preferences.updateNewsSettings.useMutation({
    onSuccess: () => {
      toast.success('设置已保存');
      utils.preferences.getNewsSettings.invalidate();
    },
  });

  if (isLoading) {
    return <Section title="排行设置"><div className="py-8 text-center text-sm text-muted-foreground">加载中…</div></Section>;
  }

  const followedModels = settings?.followedModels ?? [];
  const threshold = settings?.priceAlertThreshold ?? null;

  return (
    <Section title="排行设置" subtitle="关注特定模型并设置价格预警">
      {/* 关注模型 */}
      <div className="mb-4 rounded-lg border bg-card p-5">
        <div className="text-sm font-medium mb-2">关注的模型</div>
        <p className="mb-3 text-xs text-muted-foreground">
          用逗号分隔多个模型 ID（如 gpt-4o, claude-fable-5）
        </p>
        <textarea
          value={followedModels.join(', ')}
          onChange={(e) => {
            const list = e.target.value
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean);
            updateMutation.mutate({ followedModels: list });
          }}
          placeholder="gpt-4o, claude-fable-5"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
          rows={2}
        />
      </div>

      {/* 价格预警 */}
      <div className="rounded-lg border bg-card p-5">
        <div className="text-sm font-medium mb-2">价格预警阈值</div>
        <p className="mb-3 text-xs text-muted-foreground">
          模型价格变动超过此百分比时通知（0 = 关闭）
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={threshold ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseFloat(e.target.value) : null;
              updateMutation.mutate({ priceAlertThreshold: v });
            }}
            placeholder="例如 10"
            className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm font-mono"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>
    </Section>
  );
}