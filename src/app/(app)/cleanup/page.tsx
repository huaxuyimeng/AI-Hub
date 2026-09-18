'use client';

// 清理页面：顶部子导航（扫描清理 / 深度清理 / 清理报告）
//
// 任务模型：
//   - 服务端全局单任务（scan / clean 共用），页面统一 1s 轮询
//   - 页面刷新不影响运行中任务（状态存服务端），回到页面自动续上看进度
//   - 进程重启导致的任务中断 → session 文件恢复，本页顶部显示恢复条

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { ScanPanel } from '@/components/cleanup/scan-panel';
import { DeepPanel } from '@/components/cleanup/deep-panel';
import { ReportPanel } from '@/components/cleanup/report-panel';
import { fmtBytes } from '@/components/cleanup/shared';
import { IconRefresh, IconTrash, IconDatabase, IconFileAnalytics } from '@tabler/icons-react';

type TabId = 'scan' | 'deep' | 'report';

const TABS: { id: TabId; label: string; desc: string }[] = [
  { id: 'scan', label: '扫描清理', desc: '盘符扫描 / 安全清理' },
  { id: 'deep', label: '深度清理', desc: '包存储 / 索引 / 空文件夹' },
  { id: 'report', label: '清理报告', desc: '释放量 / 后续建议' },
];

export default function CleanupPage() {
  const [tab, setTab] = useState<TabId>('scan');
  const [drive, setDrive] = useState('C');
  const [reportId, setReportId] = useState<string | null>(null);

  const drivesQ = trpc.cleanup.listDrives.useQuery(undefined, { refetchOnWindowFocus: false });
  const sessionQ = trpc.cleanup.sessionState.useQuery(undefined, { refetchOnWindowFocus: false });
  const resumeMut = trpc.cleanup.resumeSession.useMutation();
  const discardMut = trpc.cleanup.discardSession.useMutation();

  // 统一任务轮询：running 时 1s 一次
  const taskQ = trpc.cleanup.task.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : false),
  });
  const task = taskQ.data ?? null;
  const running = task?.status === 'running';

  // 任务结束（清理类）→ 会话已消亡，刷新 session 状态
  const session = sessionQ.data ?? null;

  const openReport = (id: string) => {
    setReportId(id);
    setTab('report');
  };

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      {/* 页头 */}
      <div className="border-b bg-card px-8 py-4">
        <h1 className="text-lg font-semibold tracking-tight">清理</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">磁盘扫描 / 缓存清理 / 中断可恢复 / 自动生成报告</p>
      </div>

      <div className="mx-auto max-w-5xl px-8 py-6">
        {/* 中断会话恢复条 */}
        {session && !running && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
            <div className="text-xs">
              <div className="font-medium text-warning-fg">检测到未完成的清理任务（{session.drive}: 盘）</div>
              <div className="mt-0.5 text-muted-foreground">
                已完成 {session.completedCount} 项、释放 {fmtBytes(session.freedBytes)}，剩余 {session.pendingCount} 项
                {session.pendingLabels.length > 0 && `：${session.pendingLabels.join('、')}${session.pendingCount > session.pendingLabels.length ? ' 等' : ''}`}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={resumeMut.isPending}
                onClick={() =>
                  resumeMut.mutate(undefined, {
                    onSuccess: () => sessionQ.refetch(),
                  })
                }
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {resumeMut.isPending ? '恢复中…' : '恢复清理'}
              </button>
              <button
                type="button"
                onClick={() => discardMut.mutate(undefined, { onSuccess: () => sessionQ.refetch() })}
                className="rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
              >
                丢弃
              </button>
            </div>
          </div>
        )}

        {/* 功能页顶部子导航栏 */}
        <div className="mb-5 flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.id === 'scan' ? IconRefresh : t.id === 'deep' ? IconDatabase : IconFileAnalytics;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  'flex items-center gap-2 rounded-md px-3.5 py-2 text-sm transition ' +
                  (active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')
                }
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex flex-col leading-tight text-left">
                  <span>{t.label}</span>
                  <span className="text-[10px] opacity-70">{t.desc}</span>
                </span>
              </button>
            );
          })}
          {/* 右侧：运行状态指示 */}
          <div className="ml-auto flex items-center gap-2 pr-2">
            {running ? (
              <span className="flex items-center gap-1.5 text-xs text-primary">
                <IconTrash size={12} className="animate-pulse" />
                任务进行中 · {task?.phase}
              </span>
            ) : (
              drivesQ.data && (
                <span className="text-xs text-muted-foreground">
                  {drivesQ.data.length} 个盘符 · 共 {fmtBytes(drivesQ.data.reduce((s, d) => s + d.freeBytes, 0))} 可用
                </span>
              )
            )}
          </div>
        </div>

        {/* 面板 */}
        {tab === 'scan' && (
          <ScanPanel
            drives={drivesQ.data ?? []}
            drive={drive}
            onSelectDrive={setDrive}
            task={task}
            onViewReport={openReport}
          />
        )}
        {tab === 'deep' && (
          <DeepPanel
            drives={drivesQ.data ?? []}
            drive={drive}
            onSelectDrive={setDrive}
            task={task}
            onViewReport={openReport}
          />
        )}
        {tab === 'report' && <ReportPanel activeId={reportId} onOpen={setReportId} />}
      </div>
    </div>
  );
}
