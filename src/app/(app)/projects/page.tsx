'use client';

// 来源：.cursor/skills/workbench-ui-designer §5.4 + §6.2
// 项目列表：搜索 + 排序 + tab 过滤 + 表格

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  IconPlus,
  IconArchive,
  IconEye,
  IconLock,
  IconSearch,
  IconArrowsSort,
  IconTrash,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';

type SortKey = 'updated' | 'score' | 'name' | 'created';
type FilterKey = 'all' | 'trashed' | 'public' | 'private';

export default function ProjectsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.project.list.useQuery({ take: 100 });
  const toast = useToast();
  const [askConfirm, ConfirmNode] = useConfirm();

  const trash = trpc.project.trash.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      toast.info('已移入回收站');
    },
    onError: (e) => toast.error(e.message),
  });
  const hardDelete = trpc.project.hardDelete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      toast.info('已永久删除');
    },
    onError: (e) => toast.error(e.message),
  });

  // 过滤 + 排序
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('updated');

  const items = useMemo(() => {
    let list = data?.items ?? [];
    if (q.trim()) {
      const k = q.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(k) ||
          p.slug.toLowerCase().includes(k) ||
          p.description?.toLowerCase().includes(k)
      );
    }
    if (filter === 'public') list = list.filter((p) => p.visibility === 'PUBLIC');
    else if (filter === 'private') list = list.filter((p) => p.visibility === 'PRIVATE');
    // trashed tab：list API 还没返 deletedAt；P5 阶段再加

    list = [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'score') return (b.latestScore ?? -1) - (a.latestScore ?? -1);
      if (sort === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }, [data, q, filter, sort]);

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <PageHeader
        title="项目"
        subtitle={`共 ${data?.count ?? items.length} 个${items.length < (data?.count ?? items.length) ? `（已过滤 ${items.length} 个）` : ''}`}
        action={
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            <IconPlus size={14} />
            新建项目
          </Link>
        }
      />

      <div className="mx-auto max-w-6xl px-8 py-6">
        {isLoading && <div className="text-sm text-muted-foreground">加载中…</div>}
        {error && (
          <ErrorState
            message={error.message}
            className="my-4"
          />
        )}

        {/* 工具栏：搜索 + 排序 + tab */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
            <IconSearch size={13} className="text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索名称 / slug / 描述…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconArrowsSort size={12} />
              排序
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="updated">最近修改</option>
              <option value="created">创建时间</option>
              <option value="score">评分</option>
              <option value="name">名称 A→Z</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex items-center gap-1 border-b">
          {(['all', 'public', 'private', 'trashed'] as FilterKey[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                'relative -mb-px px-3 py-2 text-xs font-medium transition ' +
                (filter === f
                  ? 'text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {f === 'all' ? '全部' : f === 'public' ? '公开' : f === 'private' ? '私密' : '回收站'}
            </button>
          ))}
        </div>

        {/* 表格 */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">名称</th>
                <th className="hidden px-4 py-2 text-left font-medium sm:table-cell">Slug</th>
                <th className="hidden px-4 py-2 text-left font-medium md:table-cell">可见性</th>
                <th className="px-4 py-2 text-right font-medium">评分</th>
                <th className="hidden px-4 py-2 text-right font-medium md:table-cell">更新时间</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="text-sm text-muted-foreground">
                      {q || filter !== 'all' ? '没有匹配的项目' : '还没有项目'}
                    </div>
                    {!q && filter === 'all' && (
                      <Link
                        href="/projects/new"
                        className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <IconPlus size={12} />
                        新建第一个项目
                      </Link>
                    )}
                  </td>
                </tr>
              )}
              {items.map((p) => (
                <tr key={p.id} className="border-t hover:bg-accent/30 transition">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:text-primary">
                      {p.name}
                    </Link>
                    {p.description && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                        {p.description}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">
                    /{p.slug}
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px]">
                      {p.visibility === 'PUBLIC' ? <IconEye size={10} /> : <IconLock size={10} />}
                      {p.visibility}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.latestScore != null ? (
                      <span
                        className={
                          'rounded px-1.5 font-mono text-xs ' +
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
                  <td className="hidden px-4 py-3 text-right text-xs text-muted-foreground md:table-cell">
                    {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: '移入回收站',
                            description: `把「${p.name ?? '未命名'}」移入回收站？项目数据保留，可在回收站恢复。`,
                            confirmText: '移入回收站',
                          });
                          if (ok) trash.mutate({ id: p.id });
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="移入回收站"
                        aria-label="移入回收站"
                      >
                        <IconArchive size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await askConfirm({
                            title: '永久删除',
                            description: `硬删除「${p.name ?? '未命名'}」？此操作不可恢复！`,
                            confirmText: '永久删除',
                            destructive: true,
                          });
                          if (ok) hardDelete.mutate({ id: p.id });
                        }}
                        className="rounded-md p-1.5 text-destructive opacity-60 hover:bg-destructive/10 hover:opacity-100"
                        title="永久删除"
                        aria-label="永久删除"
                      >
                        <IconTrash size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {ConfirmNode()}
    </div>
  );
}