'use client';

/**
 * 专家市场首页（v2 — 2026-09-17 接入用户自建 UI）
 *
 * 两个 Tab：
 *   - 市场：浏览预设专家、复制到我的
 *   - 我的：用户自建专家、编辑/删除
 *
 * 复用：
 *   - ExpertSelectorDrawer 子组件（market view）
 *   - ExpertEditDialog 子组件（my view 编辑）
 */

import { useMemo, useState } from 'react';
import * as TablerIcons from '@tabler/icons-react';
import {
  IconSearch,
  IconUsers,
  IconLoader2,
  IconCopy,
  IconSparkles,
  IconArrowRight,
  IconPencil,
  IconTrash,
  IconUserCircle,
  IconStar,
  IconStarFilled,
  IconTrophy,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { formatError } from '@/lib/format-error';
import { ExpertEditDialog } from '@/components/expert/expert-edit-dialog';
import { ExpertDetailDialog } from '@/components/expert/expert-detail-dialog';
import type { ExpertListItem } from '@/types/expert';

type TabKey = 'market' | 'mine' | 'score';
type SortKey = 'featured' | 'newest' | 'popular' | 'name';

function IconLookup(name: string): React.ComponentType<{ size?: number; stroke?: number }> | undefined {
  const map = TablerIcons as unknown as Record<string, React.ComponentType<{ size?: number; stroke?: number }>>;
  return map[name];
}

export default function ExpertMarketPage() {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('market');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // MVP2：排序（仅市场 Tab 生效）
  const [sort, setSort] = useState<SortKey>('featured');

  // 编辑弹窗状态
  const [editOpen, setEditOpen] = useState(false);
  const [editingExpert, setEditingExpert] = useState<ExpertListItem | null>(null);

  // v2 详情弹窗（2026-09-17）
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 收藏
  const favIdsQ = trpc.expert.listFavoriteIds.useQuery(undefined, { staleTime: 30_000 });
  const favoriteIds = useMemo(() => new Set(favIdsQ.data ?? []), [favIdsQ.data]);
  const utils = trpc.useUtils();
  const favoriteMut = trpc.expert.favorite.useMutation({
    onSuccess: () => utils.expert.listFavoriteIds.invalidate(),
  });
  const unfavoriteMut = trpc.expert.unfavorite.useMutation({
    onSuccess: () => utils.expert.listFavoriteIds.invalidate(),
  });
  function toggleFavorite(id: string) {
    if (favoriteIds.has(id)) unfavoriteMut.mutate({ id });
    else favoriteMut.mutate({ id });
  }

  // ── Market Tab 查询 ────────────────────────────────────────────────────────
  const listQ = trpc.expert.list.useQuery(
    {
      take: 50,
      category: category ?? undefined,
      search: search || undefined,
      sort,
    },
    { staleTime: 30_000, enabled: tab === 'market' },
  );

  const categoriesQ = trpc.expert.categories.useQuery(undefined, {
    staleTime: 60_000,
  });

  const duplicateMut = trpc.expert.duplicate.useMutation({
    onSuccess: () => toast.success('已复制到「我的专家」'),
    onError: (e) => toast.error(formatError(e)),
  });

  // ── My Tab 查询 ────────────────────────────────────────────────────────────
  const mineQ = trpc.expert.list.useQuery(
    { take: 50, isMine: true, search: search || undefined },
    { staleTime: 10_000, enabled: tab === 'mine' },
  );

  // 我的专家中再过滤一次内置（双重保险，router isMine 已过滤）
  const myExperts = mineQ.data?.experts ?? [];
  const allExperts = listQ.data?.experts ?? [];
  const totalCount = listQ.data?.total ?? 0;
  const categories = categoriesQ.data ?? [];

  return (
    <div className="mx-auto h-full max-w-7xl overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero */}
      <header className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <IconSparkles size={20} stroke={1.8} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">专家市场</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          20+ 预置专家，覆盖产品、工程、投资、法律等场景。点「复制」变成你的私有副本后可自由编辑。
        </p>
      </header>

      {/* Tab 切换 */}
      <div className="mb-4 flex items-center gap-2 border-b">
        <TabButton
          active={tab === 'market'}
          onClick={() => setTab('market')}
          icon={<IconSparkles size={14} />}
          label="市场"
          badge={totalCount}
        />
        <TabButton
          active={tab === 'mine'}
          onClick={() => setTab('mine')}
          icon={<IconUserCircle size={14} />}
          label="我的专家"
          badge={myExperts.length}
        />
        <TabButton
          active={tab === 'score'}
          onClick={() => setTab('score')}
          icon={<IconTrophy size={14} />}
          label="评分榜"
        />
        <div className="ml-auto py-2 text-[11px] text-muted-foreground">
          {tab === 'market' ? '浏览系统预置 · 复制即可拥有' : '你创建的副本 · 可自由编辑'}
        </div>
      </div>

      {/* 搜索 */}
      {tab === 'market' && (
        <section className="mb-4">
          <div className="relative mb-3">
            <IconSearch
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索专家名称、描述、标签…"
              className="w-full rounded-lg border bg-card py-2.5 pl-10 pr-3 text-[13px] outline-none transition-base input-focus focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="mb-2 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <CategoryTab
              active={category === null}
              onClick={() => setCategory(null)}
              label="全部"
              count={totalCount}
            />
            {categories.map((c) => (
              <CategoryTab
                key={c.category}
                active={category === c.category}
                onClick={() => setCategory(c.category)}
                label={c.category}
                count={c.count}
              />
            ))}
          </div>
          {/* 排序（v2 — 2026-09-17）*/}
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">排序：</span>
            <SortTab active={sort === 'featured'} onClick={() => setSort('featured')} label="精选" />
            <SortTab active={sort === 'newest'} onClick={() => setSort('newest')} label="最新" />
            <SortTab active={sort === 'popular'} onClick={() => setSort('popular')} label="最热" />
            <SortTab active={sort === 'name'} onClick={() => setSort('name')} label="名称 A-Z" />
          </div>
        </section>
      )}

      {/* Tab Content */}
      {tab === 'market' ? (
        <MarketView
          loading={listQ.isLoading}
          error={listQ.error}
          experts={allExperts}
          category={category}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          onDuplicate={(id) => duplicateMut.mutate({ id })}
          onViewDetail={(id) => {
            setDetailId(id);
            setDetailOpen(true);
          }}
          duplicatingId={duplicateMut.variables?.id}
          isDuplicating={duplicateMut.isPending}
        />
      ) : (
        <MyExpertsView
          loading={mineQ.isLoading}
          experts={myExperts}
          search={search}
          onSearchChange={setSearch}
          onEdit={(e) => {
            setEditingExpert(e);
            setEditOpen(true);
          }}
          onCreate={() => {
            setEditingExpert(null);
            setEditOpen(true);
          }}
          toast={toast}
        />
      )}

      {tab === 'score' && (
        <LeaderboardView
          allExperts={allExperts}
          loading={listQ.isLoading}
        />
      )}

      {/* 编辑弹窗 */}
      <ExpertEditDialog
        open={editOpen}
        expert={editingExpert}
        onClose={() => setEditOpen(false)}
        onAfterAction={() => {
          // 刷新所有相关 query
          listQ.refetch();
          mineQ.refetch();
          categoriesQ.refetch();
        }}
      />

      {/* v2 详情弹窗（2026-09-17）*/}
      <ExpertDetailDialog
        expertId={detailId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Market View（市场 Tab 内容）
// ───────────────────────────────────────────────────────────────────────────

function MarketView({
  loading,
  error,
  experts,
  category,
  favoriteIds,
  onToggleFavorite,
  onDuplicate,
  onViewDetail,
  duplicatingId,
  isDuplicating,
}: {
  loading: boolean;
  error: { message: string } | null;
  experts: ExpertListItem[];
  category: string | null;
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  onDuplicate: (id: string) => void;
  onViewDetail: (id: string) => void;
  duplicatingId?: string;
  isDuplicating: boolean;
}) {
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <IconLoader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
        加载失败：{error.message}
      </div>
    );
  }
  if (experts.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <IconUsers size={36} className="mb-2 text-muted-foreground/40" stroke={1.4} />
        <p className="text-[14px] text-muted-foreground">没找到符合条件的专家</p>
        <a
          href="/meeting/new"
          className="mt-3 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
        >
          去新建会议
          <IconArrowRight size={11} />
        </a>
      </div>
    );
  }

  // 按 category 分组
  const grouped = new Map<string, ExpertListItem[]>();
  for (const e of experts) {
    if (!grouped.has(e.category)) grouped.set(e.category, []);
    grouped.get(e.category)!.push(e);
  }

  if (category) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-[13px] font-semibold text-muted-foreground">
          {category} <span className="opacity-60">({experts.length})</span>
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {experts.map((e) => (
            <ExpertMarketCard
              key={e.id}
              expert={e}
              favorited={favoriteIds.has(e.id)}
              onToggleFavorite={() => onToggleFavorite(e.id)}
              onDuplicate={() => onDuplicate(e.id)}
              onViewDetail={() => onViewDetail(e.id)}
              isDuplicating={isDuplicating && duplicatingId === e.id}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      {Array.from(grouped.entries()).map(([catName, items]) => (
        <section key={catName}>
          <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-semibold text-muted-foreground">
            <span>{catName}</span>
            <span className="opacity-60">({items.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((e) => (
              <ExpertMarketCard
                key={e.id}
                expert={e}
                favorited={favoriteIds.has(e.id)}
                onToggleFavorite={() => onToggleFavorite(e.id)}
                onDuplicate={() => onDuplicate(e.id)}
                onViewDetail={() => onViewDetail(e.id)}
                isDuplicating={isDuplicating && duplicatingId === e.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MyExpertsView（我的专家 Tab 内容）
// ───────────────────────────────────────────────────────────────────────────

function MyExpertsView({
  loading,
  experts,
  search,
  onSearchChange,
  onEdit,
  onCreate,
  toast,
}: {
  loading: boolean;
  experts: ExpertListItem[];
  search: string;
  onSearchChange: (s: string) => void;
  onEdit: (e: ExpertListItem) => void;
  onCreate: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const trpcCtx = trpc.useUtils();

  const deleteMut = trpc.expert.delete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      trpcCtx.expert.list.invalidate();
    },
  });

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <IconLoader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {/* 搜索 + 新建按钮 */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索我的专家…"
            className="w-full rounded-lg border bg-card py-2.5 pl-10 pr-3 text-[13px] outline-none transition-base input-focus focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-[13px] font-medium text-primary-foreground transition-base hover:bg-primary/90"
        >
          <TablerIcons.IconPlus size={14} />
          新建专家
        </button>
      </div>

      {experts.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 text-center">
          <IconUserCircle size={36} className="mb-2 text-muted-foreground/40" stroke={1.4} />
          <p className="text-[14px] text-muted-foreground">还没有私有专家</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            点「新建专家」从零开始，或去「市场」Tab 复制预设专家
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-base hover:bg-primary/90"
            >
              <TablerIcons.IconPlus size={11} />
              新建专家
            </button>
            <span className="text-[11px] text-muted-foreground">或</span>
            <button
              type="button"
              onClick={() => trpcCtx.expert.list.invalidate()}
              className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              <IconSparkles size={11} />
              去市场复制
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {experts.map((e) => (
            <MyExpertCard
              key={e.id}
              expert={e}
              onEdit={() => onEdit(e)}
              onDelete={() => {
                deleteMut.mutate({ id: e.id });
              }}
              deleting={deleteMut.isPending && deleteMut.variables?.id === e.id}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MyExpertCard
// ───────────────────────────────────────────────────────────────────────────

function MyExpertCard({
  expert,
  onEdit,
  onDelete,
  deleting,
}: {
  expert: ExpertListItem;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const Icon = IconLookup(expert.icon);
  return (
    <div
      className="group relative overflow-hidden rounded-xl border bg-card transition-base gpu hover:-translate-y-0.5 hover:shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: expert.accentColor }}
    >
      <div className="flex gap-3 p-3.5">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${expert.accentColor}1A`, color: expert.accentColor }}
        >
          {Icon ? <Icon size={22} stroke={1.6} /> : <TablerIcons.IconSparkles size={22} stroke={1.6} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold">{expert.name}</h3>
          <p className="mb-1 truncate text-[11px] text-muted-foreground">
            {expert.category}
            {expert.recommendedModel && (
              <>
                <span className="mx-1">·</span>
                <span className="font-mono">{expert.recommendedModel}</span>
              </>
            )}
          </p>
          <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {expert.description}
          </p>
        </div>
      </div>

      {/* 底部操作：编辑 + 删除 */}
      <div className="flex items-center justify-between border-t bg-muted/20 px-3 py-1.5">
        <span className="text-[10px] text-muted-foreground">
          {expert.useCount > 0 ? `已被使用 ${expert.useCount} 次` : '未使用过'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-base hover:bg-primary/10"
          >
            <IconPencil size={11} />
            编辑
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-destructive transition-base hover:bg-destructive/10 disabled:opacity-50"
          >
            {deleting ? <IconLoader2 size={11} className="animate-spin" /> : <IconTrash size={11} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ExpertMarketCard（市场页卡 — 含「复制」按钮）
// ───────────────────────────────────────────────────────────────────────────

function ExpertMarketCard({
  expert,
  favorited,
  onToggleFavorite,
  onDuplicate,
  onViewDetail,
  isDuplicating,
}: {
  expert: ExpertListItem;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  onDuplicate: () => void;
  onViewDetail?: () => void;
  isDuplicating?: boolean;
}) {
  const Icon = IconLookup(expert.icon);
  return (
    <div
      className="group relative overflow-hidden rounded-xl border bg-card transition-base gpu hover:-translate-y-0.5 hover:shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: expert.accentColor }}
    >
      {/* 收藏按钮（右上角） */}
      {onToggleFavorite && (
        <button
          type="button"
          aria-label={favorited ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className={[
            'absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-base',
            favorited
              ? 'bg-rose-500/15 text-rose-500'
              : 'bg-muted/40 text-muted-foreground opacity-0 group-hover:opacity-100',
          ].join(' ')}
        >
          {favorited ? (
            <TablerIcons.IconHeartFilled size={12} />
          ) : (
            <TablerIcons.IconHeart size={12} />
          )}
        </button>
      )}

      <div className="flex gap-3 p-3.5">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${expert.accentColor}1A`, color: expert.accentColor }}
        >
          {Icon ? <Icon size={22} stroke={1.6} /> : <TablerIcons.IconSparkles size={22} stroke={1.6} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold">{expert.name}</h3>
          <p className="mb-1 truncate text-[11px] text-muted-foreground">
            {expert.category}
            {expert.recommendedModel && (
              <>
                <span className="mx-1">·</span>
                <span className="font-mono">{expert.recommendedModel}</span>
              </>
            )}
          </p>
          <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {expert.description}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t bg-muted/20 px-3 py-1.5">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>
            {expert.useCount > 0 ? `已被使用 ${expert.useCount} 次` : '新上线'}
          </span>
          <RatingBadge avg={expert.avgRating} count={expert.ratingCount} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetail?.();
            }}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-base hover:bg-muted hover:text-foreground"
            title="查看完整提示词 + 评分 + 评论"
          >
            <TablerIcons.IconEye size={11} />
            详情
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={isDuplicating}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary transition-base hover:bg-primary/10 disabled:opacity-50"
          >
            {isDuplicating ? (
              <IconLoader2 size={11} className="animate-spin" />
            ) : (
              <IconCopy size={11} />
            )}
            复制
          </button>
        </div>
      </div>
    </div>
  );
}

// 评分胶囊（市场卡片底部显示）
function RatingBadge({ avg, count }: { avg: number; count: number }) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground/60">
        <IconStar size={10} className="text-amber-400/60" />
        暂无评分
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-amber-500"
      title={`${count} 人评分，平均 ${avg.toFixed(1)} / 5`}
    >
      <IconStarFilled size={10} className="text-amber-500" />
      <span className="font-mono font-medium">{avg.toFixed(1)}</span>
      <span className="text-muted-foreground/60">({count})</span>
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 通用小组件
// ───────────────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-base',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
      ].join(' ')}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={[
          'rounded-full px-1.5 text-[10px]',
          active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        ].join(' ')}>
          {badge}
        </span>
      )}
    </button>
  );
}

function CategoryTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[12px] transition-base',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
      ].join(' ')}
    >
      <span className="font-medium">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={[
            'rounded-full px-1.5 text-[10px]',
            active ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
          ].join(' ')}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// MVP2：排序按钮（小尺寸，text-only）
function SortTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded px-1.5 py-0.5 transition-base',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// LeaderboardView（评分榜 Tab — 2026-09-17）
// ───────────────────────────────────────────────────────────────────────────

interface LeaderboardViewProps {
  allExperts: ExpertListItem[];
  loading: boolean;
}

function LeaderboardView({ allExperts, loading }: LeaderboardViewProps) {
  const utils = trpc.useUtils();
  const toast = useToast();

  // 只显示有评分的，按 avgRating 降序
  const ranked = [...allExperts]
    .filter((e) => e.ratingCount > 0)
    .sort((a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <IconLoader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (ranked.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <IconTrophy size={36} className="mb-2 text-muted-foreground/40" stroke={1.4} />
        <p className="text-[14px] text-muted-foreground">暂无评分数据</p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          去「市场」Tab 使用专家并评分，即可出现在这里
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="mb-4 text-sm text-muted-foreground">
        共 <strong>{ranked.length}</strong> 位专家有评分，按平均分排序
      </p>
      {ranked.map((e, idx) => (
        <LeaderboardRow key={e.id} rank={idx + 1} expert={e} />
      ))}
    </div>
  );
}

function LeaderboardRow({ rank, expert }: { rank: number; expert: ExpertListItem }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const myRatingQ = trpc.expert.myRating.useQuery(
    { agentId: expert.id },
    { staleTime: 30_000 },
  );
  const [hoverStar, setHoverStar] = useState(0);
  const [lastRated, setLastRated] = useState(0);

  const rateMut = trpc.expert.rate.useMutation({
    onSuccess: () => {
      const stars = '★'.repeat(Math.max(0, Math.min(5, lastRated)));
      toast.success(`已为「${expert.name}」评分 ${stars}`);
      // 刷新列表 + 我的评分
      utils.expert.list.invalidate();
      utils.expert.myRating.invalidate({ agentId: expert.id });
    },
  });

  const myRating = myRatingQ.data?.rating ?? 0;
  const displayRating = hoverStar || myRating;

  function handleRate(stars: number) {
    setLastRated(stars);
    rateMut.mutate({ agentId: expert.id, rating: stars });
  }

  const medals = ['🥇', '🥈', '🥉'];
  const medal = rank <= 3 ? medals[rank - 1] : `#${rank}`;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-base hover:border-primary/30">
      {/* 排名 */}
      <div className="w-10 text-center">
        {rank <= 3 ? (
          <span className="text-xl">{medal}</span>
        ) : (
          <span className="font-mono text-sm font-bold text-muted-foreground">#{rank}</span>
        )}
      </div>

      {/* 专家信息 */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${expert.accentColor}1A`, color: expert.accentColor }}
        >
          {(() => {
            const Icon = IconLookup(expert.icon);
            return Icon ? <Icon size={20} stroke={1.6} /> : <TablerIcons.IconSparkles size={20} stroke={1.6} />;
          })()}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-sm font-semibold">{expert.name}</h3>
            <span className="text-[10px] text-muted-foreground">{expert.category}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{expert.description}</p>
        </div>
      </div>

      {/* 评分 */}
      <div className="shrink-0 text-right">
        <div className="mb-1 text-lg font-bold">
          <span className="font-mono text-amber-500">{expert.avgRating.toFixed(1)}</span>
          <span className="text-[12px] text-muted-foreground"> / 5</span>
        </div>
        <div className="mb-1.5 text-[10px] text-muted-foreground">
          {expert.ratingCount} 人评分
        </div>

        {/* 交互式星星 */}
        <div className="flex items-center justify-end gap-0.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              disabled={rateMut.isPending}
              onMouseEnter={() => setHoverStar(s)}
              onMouseLeave={() => setHoverStar(0)}
              onClick={() => handleRate(s)}
              className="rounded p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
              title={s === 1 ? '很差' : s === 2 ? '较差' : s === 3 ? '一般' : s === 4 ? '较好' : '很好'}
            >
              {s <= displayRating ? (
                <IconStarFilled size={14} className="text-amber-400" />
              ) : (
                <IconStar size={14} className="text-muted-foreground/40" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
