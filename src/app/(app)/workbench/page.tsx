'use client';

// 来源：.cursor/skills/workbench-ui-designer §5.2
// 工作台首页：欢迎区 + 4 快捷入口 + 4 数据卡 + 最近项目 + 工具区

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  IconFolders,
  IconMessages,
  IconChartBar,
  IconArrowRight,
  IconPlug,
  IconSettings,
  IconSparkles,
  IconClock,
  IconRun,
  IconRocket,
  IconNews,
  IconTrendingUp,
} from '@tabler/icons-react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc';
import { centsToCNY } from '@/lib/currency';
import { ErrorState } from '@/components/ui/error-state';
import { DiscoveryPanel } from '@/components/discovery/discovery-panel';
import { useRouter } from 'next/navigation';

export default function WorkbenchHome() {
  const projects = trpc.project.list.useQuery({ take: 8 });
  const conversations = trpc.chat.list.useQuery({ take: 5 });
  const usage = trpc.usage.recent.useQuery({ days: 30 });
  const { data: session } = useSession();
  const router = useRouter();

  const firstName = session?.user?.name?.split(' ')[0] ?? session?.user?.email?.split('@')[0] ?? '朋友';

  // H-16 修复：hour 在组件顶层调用，在 SSR/CSR 边界会产生 hydration mismatch。
  // 修复：用 useState 预设一个"中午好"默认值（SSR/CSR 一致），在 useEffect 中补全实际时间。
  const [greeting, setGreeting] = useState('下午好');

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好');
  }, []);

  const [discoveryIntent, setDiscoveryIntent] = useState<string>('');

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <div className="mx-auto max-w-6xl px-8 py-10">
        {/* 欢迎区 */}
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Workbench</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {greeting}，<span className="text-primary">{firstName}</span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              多租户 AI 代码分析平台 · 项目 / 对话 / 评分 / 插件 全在一处。
            </p>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            <IconRocket size={14} />
            新建项目
            <IconArrowRight size={14} />
          </Link>
        </header>

        {/* 需求探索向导（用户约定 2026-08-30：默认追问模式） */}
        <section className="mb-10">
          <DiscoveryPanel
            scope="workbench"
            defaultIntent={discoveryIntent}
            onOpenChat={(prompt) => {
              setDiscoveryIntent('');
              router.push(`/chat?prefill=${encodeURIComponent(prompt)}`);
            }}
            onStartTask={(prompt, brief) => {
              setDiscoveryIntent('');
              if (brief.domain === 'project' || brief.scenario === 'create') {
                // 跳转到新建项目，预填 intent
                sessionStorage.setItem('aihub-prefill-project', JSON.stringify({ name: prompt.split('\n')[0]?.slice(0, 50) ?? '', brief }));
                router.push('/projects/new');
              } else if (brief.domain === 'analysis') {
                router.push('/projects');
              } else if (brief.domain === 'research') {
                router.push('/news');
              } else {
                router.push(`/chat?prefill=${encodeURIComponent(prompt)}`);
              }
            }}
          />
        </section>

        {/* 4 快捷入口（skill §5.2） */}
        <section className="mb-12 grid grid-cols-2 gap-3 md:grid-cols-4">
          <QuickAction
            href="/chat"
            icon={<IconMessages size={18} />}
            label="新对话"
            desc="AI 多轮对话"
          />
          <QuickAction
            href="/usage"
            icon={<IconRun size={18} />}
            label="运行 AI 代码评测"
            desc="查看 token 消耗明细"
          />
          <QuickAction
            href="/plugins"
            icon={<IconSparkles size={18} />}
            label="插件市场"
            desc="扩展分析能力"
          />
          <QuickAction
            href="/settings"
            icon={<IconSettings size={18} />}
            label="设置"
            desc="账号 / 主题 / API Key"
          />
        </section>

        {/* 数据卡 */}
        <section className="mb-12 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="项目"
            value={projects.data?.count ?? projects.data?.items.length}
            loading={projects.isLoading}
            href="/projects"
          />
          <StatCard
            label="对话"
            value={conversations.data?.items.length}
            loading={conversations.isLoading}
            href="/chat"
          />
          <StatCard
            label="本月消息"
            value={usage.data?.totals.messageCount}
            loading={usage.isLoading}
            href="/usage"
          />
          <StatCard
            label="本月费用"
            value={
              usage.data?.totals.costCents
                ? centsToCNY(usage.data.totals.costCents)
                : undefined
            }
            loading={usage.isLoading}
            href="/usage"
          />
        </section>

        {/* 最近项目表格 */}
        <section className="mb-12">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="flex items-center gap-1.5 text-base font-semibold">
                <IconClock size={16} className="text-muted-foreground" />
                最近项目
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">按更新时间倒序</p>
            </div>
            <Link
              href="/projects"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              查看全部 →
            </Link>
          </div>

          <div className="rounded-lg border bg-card">
            {projects.isLoading && (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">加载中…</div>
            )}
            {projects.error && (
              <ErrorState
                message={projects.error.message}
                onRetry={() => projects.refetch()}
                className="m-3"
              />
            )}
            {projects.data?.items.length === 0 && (
              <div className="px-6 py-12 text-center">
                <div className="mb-1 text-sm font-medium">还没有项目</div>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  创建一个项目开始 AI 代码分析
                </p>
                <Link
                  href="/projects/new"
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <IconFolders size={12} />
                  新建第一个项目
                </Link>
              </div>
            )}
            {projects.data && projects.data.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">名称</th>
                      <th className="hidden px-4 py-2 text-left font-medium sm:table-cell">Slug</th>
                      <th className="hidden px-4 py-2 text-left font-medium md:table-cell">可见性</th>
                      <th className="px-4 py-2 text-right font-medium">评分</th>
                      <th className="px-4 py-2 text-right font-medium">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                  {projects.data.items.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b last:border-b-0 hover:bg-accent/50 transition"
                    >
                      <td className="px-4 py-3">
                        <Link href={`/projects/${p.id}`} className="font-medium hover:text-primary">
                          {p.name}
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">
                        /{p.slug}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">
                          {p.visibility}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {p.latestScore != null ? (
                          <span
                            className={
                              'rounded px-1.5 ' +
                              (p.latestScore >= 80
                                ? 'bg-success/15 text-success'
                                : p.latestScore >= 60
                                ? 'bg-warning/15 text-warning'
                                : 'bg-destructive/15 text-destructive')
                            }
                          >
                            {p.latestScore.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {new Date(p.updatedAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </section>

        {/* 工具区 */}
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ToolCard
            icon={<IconChartBar size={16} />}
            label="本月用量"
            body={
              usage.data
                ? `已消耗 ${usage.data.totals.inputTokens.toLocaleString()} 输入 / ${usage.data.totals.outputTokens.toLocaleString()} 输出 token`
                : '加载中…'
            }
            href="/usage"
          />
          <ToolCard
            icon={<IconPlug size={16} />}
            label="插件市场"
            body="ESLint / Dependency Audit / Auto Doc"
            href="/plugins"
          />
          <ToolCard
            icon={<IconSettings size={16} />}
            label="账号 & API Key"
            body="管理团队 / 创建 API Key / 修改主题"
            href="/settings"
          />
        </section>

        {/* 内容入口：AI 新闻 + 模型排行（暂为入口卡，后期迁入左导航） */}
        <section className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <NewsEntryCard />
          <Link
            href="/rankings"
            className="block rounded-lg border bg-card p-4 transition hover:border-primary"
          >
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <span className="text-muted-foreground">
                <IconTrendingUp size={16} />
              </span>
              AI 模型性价比排行
            </div>
            <div className="text-xs text-muted-foreground">
              性价比算法 + 帕累托前沿 · 点击模型获取官方 API Key
            </div>
          </Link>
        </section>
      </div>
    </div>
  );
}

/** AI 新闻入口卡：通过 tRPC 读取实时统计（不再探测独立的本地 Node 服务） */
function NewsEntryCard() {
  const statsQ = trpc.news.stats.useQuery(undefined, { staleTime: 60_000 });
  const status = statsQ.isLoading ? 'checking' : statsQ.error ? 'down' : 'up';
  const total = statsQ.data?.today ?? null;

  return (
    <Link
      href="/news"
      className="block rounded-lg border bg-card p-4 transition hover:border-primary"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-sm font-medium">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">
            <IconNews size={16} />
          </span>
          AI 新闻推送
        </span>
        <span
          className={
            'rounded px-1.5 py-0.5 text-[10px] ' +
            (status === 'up'
              ? 'bg-success/15 text-success'
              : status === 'down'
              ? 'bg-warning/15 text-warning'
              : 'bg-muted text-muted-foreground')
          }
        >
          {status === 'up'
            ? `今日 ${total ?? 0} 条`
            : status === 'down'
            ? '数据暂不可用'
            : '加载中…'}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        每日多源聚合 + 交叉验证 · 历史日历 / PPT 导出见完整版
      </div>
    </Link>
  );
}

function QuickAction({
  href,
  icon,
  label,
  desc,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-lg border bg-card p-4 transition hover:border-primary hover:shadow-sm"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
      </div>
    </Link>
  );
}

// C-08: StatCard 已迁移到 @/components/ui/stat-card
import { StatCard } from '@/components/ui/stat-card';

function ToolCard({
  icon,
  label,
  body,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  body: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-4 transition hover:border-primary"
    >
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <div className="text-xs text-muted-foreground">{body}</div>
    </Link>
  );
}