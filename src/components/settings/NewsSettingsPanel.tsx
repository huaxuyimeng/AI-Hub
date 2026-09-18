/**
 * 新闻设置面板（含源级调度）
 * 设置页 → 新闻 section → 此组件
 *
 * 功能：
 * - 全局刷新频率设置（1h/3h/6h/12h/1d）
 * - 各源独立调度状态列表（下次刷新时间、间隔覆盖）
 * - 源级间隔设置（跟随全局或覆盖）
 * - 手动全量刷新
 * - AI 早报提示 / 晨报/晚报时间窗口
 * - 关注分类
 */

'use client';

import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { DEFAULT_CATEGORIES } from '@/lib/analysis/categories';

// 刷新频率选项（分钟）
const REFRESH_OPTIONS = [
  { value: 60,  label: '每 1 小时' },
  { value: 180, label: '每 3 小时' },
  { value: 360, label: '每 6 小时' },
  { value: 720, label: '每 12 小时' },
  { value: 1440, label: '每天一次' },
];

// 源级间隔选项
const SOURCE_INTERVAL_OPTIONS = [
  { value: null,  label: '跟随全局' },
  { value: 30,   label: '30 分钟' },
  { value: 60,   label: '1 小时' },
  { value: 180,  label: '3 小时' },
  { value: 360,  label: '6 小时' },
  { value: 720,  label: '12 小时' },
  { value: 1440, label: '1 天' },
];

function formatTimeUntil(dateStr: string | null): string {
  if (!dateStr) return '未排期';
  const next = new Date(dateStr);
  const now = new Date();
  if (next <= now) return '立即可抓';
  const mins = Math.round((next.getTime() - now.getTime()) / 60_000);
  if (mins < 60) return `${mins}分钟后`;
  const hrs = Math.round(mins / 60);
  return `${hrs}小时后`;
}

function formatLastFetch(dateStr: string | null): string {
  if (!dateStr) return '从未';
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function NewsSettingsPanel() {
  const utils = trpc.useUtils();
  const toast = useToast();

  const { data: settings, isLoading: settingsLoading } = trpc.preferences.getNewsSettings.useQuery();
  const { data: stats } = trpc.news.stats.useQuery();
  const { data: schedule, isLoading: scheduleLoading, refetch: refetchSchedule } =
    trpc.news.schedule.useQuery();

  const refreshAllMutation = trpc.news.refreshAll.useMutation({
    onSuccess: (res) => {
      toast.success(`全量刷新完成：${res.totalItems} 条`);
      refetchSchedule();
      utils.news.stats.invalidate();
    },
    onError: (e) => toast.error(`刷新失败：${e.message}`),
  });

  const setSourceIntervalMutation = trpc.news.setSourceInterval.useMutation({
    onSuccess: () => {
      toast.success('间隔已更新');
      refetchSchedule();
    },
    onError: (e) => toast.error(`设置失败：${e.message}`),
  });

  const updateMutation = trpc.preferences.updateNewsSettings.useMutation({
    onSuccess: () => {
      toast.success('设置已保存');
      utils.preferences.getNewsSettings.invalidate();
      refetchSchedule();
    },
  });

  if (settingsLoading || scheduleLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded border bg-muted" />
      </div>
    );
  }

  const globalMinutes = schedule?.globalIntervalMinutes ?? 180;

  return (
    <div className="space-y-6">

      {/* 统计概览 */}
      <Section title="统计概览">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">活跃源</div>
            <div className="mt-1 text-2xl font-semibold">
              {schedule?.sources.filter(s => s.enabled).length ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">总新闻数</div>
            <div className="mt-1 text-2xl font-semibold">{stats?.total ?? 0}</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">今日新增</div>
            <div className="mt-1 text-2xl font-semibold">{stats?.today ?? 0}</div>
          </div>
        </div>
      </Section>

      {/* 全局刷新频率 */}
      <Section title="全局刷新频率" subtitle="所有源默认按此间隔刷新；可单独为某源设置覆盖值">
        <div className="flex items-center justify-between rounded-lg border bg-card p-4">
          <span className="text-sm">自动刷新间隔</span>
          <select
            value={settings?.newsRefreshInterval ?? 180}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (isNaN(val)) return;
              updateMutation.mutate({ newsRefreshInterval: val });
            }}
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          >
            {REFRESH_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </Section>

      {/* 数据源调度列表 */}
      <Section title="数据源调度" subtitle="各源独立计时；绿色=到期，灰色=等待中，红色=异常">
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="max-h-[380px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">数据源</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">下次刷新</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">上次抓取</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">最近条数</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">刷新间隔</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">状态</th>
                </tr>
              </thead>
              <tbody>
                {(schedule?.sources ?? []).map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-accent/30">
                    <td className="px-4 py-2">
                      <div className="font-medium leading-tight">{s.name}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{s.type}</div>
                    </td>
                    <td className="px-3 py-2 text-center text-muted-foreground">
                      {formatTimeUntil(s.nextFetchAt)}
                    </td>
                    <td className="px-3 py-2 text-center text-muted-foreground">
                      {formatLastFetch(s.lastFetchAt)}
                    </td>
                    <td className="px-3 py-2 text-center">{s.lastCount ?? 0}</td>
                    <td className="px-3 py-2 text-center">
                      <select
                        value={String(s.fetchIntervalMinutes ?? '')}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            setSourceIntervalMutation.mutate({ sourceId: s.id, intervalMinutes: null });
                            return;
                          }
                          const num = parseInt(val, 10);
                          if (isNaN(num)) return;
                          setSourceIntervalMutation.mutate({ sourceId: s.id, intervalMinutes: num });
                        }}
                        disabled={setSourceIntervalMutation.isPending}
                        className="rounded border bg-background px-1 py-0.5 text-[11px] disabled:opacity-50"
                      >
                        {SOURCE_INTERVAL_OPTIONS.map(o => (
                          <option
                            key={String(o.value)}
                            value={o.value === null ? '' : String(o.value)}
                          >
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {s.unhealthy ? (
                        <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">异常</span>
                      ) : s.enabled ? (
                        <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] text-success">正常</span>
                      ) : (
                        <span className="text-muted-foreground">已停用</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* 手动全量刷新 */}
      <Section title="手动刷新" subtitle="从所有源强制拉取，不修改各源的计划时间">
        <div className="flex items-center justify-between rounded-lg border bg-card p-4">
          <span className="text-sm text-muted-foreground">全量刷新（约 5-15 秒）</span>
          <button
            type="button"
            onClick={() => refreshAllMutation.mutate()}
            disabled={refreshAllMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {refreshAllMutation.isPending ? '刷新中…' : '全量刷新'}
          </button>
        </div>
      </Section>

      {/* AI 早报 */}
      <Section title="AI 早报" subtitle="每天自动生成，早报/晚报按时间窗口分割">
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">早报提示</div>
              <p className="mt-0.5 text-xs text-muted-foreground">首次打开时右上角提示</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.briefingToast ?? true}
              onClick={() => updateMutation.mutate({ briefingToast: !(settings?.briefingToast ?? true) })}
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

          <div className="flex items-center justify-between border-t border-border pt-3">
            <div>
              <div className="text-sm font-medium">晨报/晚报分割</div>
              <p className="mt-0.5 text-xs text-muted-foreground">此前为晨报，此后为晚报</p>
            </div>
            <select
              value={settings?.briefingWindowHour ?? 8}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (isNaN(val)) return;
                updateMutation.mutate({ briefingWindowHour: val });
              }}
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00（{h < 12 ? '晨报' : '晚报'}）
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      {/* 关注分类 */}
      <Section title="关注分类" subtitle="只入库命中分类的新闻">
        <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-4">
          {DEFAULT_CATEGORIES.map((cat) => {
            const checked = settings?.newsCategories?.includes(cat.key) ?? false;
            return (
              <label
                key={cat.key}
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
                      ? [...(settings?.newsCategories ?? []), cat.key]
                      : (settings?.newsCategories ?? []).filter((c: string) => c !== cat.key);
                    updateMutation.mutate({ newsCategories: list });
                  }}
                  className="h-3 w-3"
                />
                {cat.name}
              </label>
            );
          })}
        </div>
      </Section>

    </div>
  );
}
