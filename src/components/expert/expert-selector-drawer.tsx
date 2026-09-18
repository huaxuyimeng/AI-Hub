'use client';

/**
 * ExpertSelectorDrawer — 选专家 Drawer（会议上游选人面板）
 *
 * 设计规格：
 *   - 桌面：右侧 520px 全宽 Drawer
 *   - 移动：底部 Sheet (100vw)
 *   - 顶部：搜索框 + 关闭按钮
 *   - 中间：分类 Tabs + 卡片网格
 *   - 底部：固定"已选 N 位" + 「召唤专家开会」按钮
 *
 * 来源：腾讯元宝 WorkBuddy 选人体验 + AIHub Workbench 配色
 *
 * MVP1：单选/多选（2~5 位）→ 返回 expertIds[]
 */

import { useMemo, useState } from 'react';
import * as TablerIcons from '@tabler/icons-react';
import {
  IconSearch,
  IconX,
  IconUsers,
  IconCheck,
  IconLoader2,
  IconArrowRight,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { formatError } from '@/lib/format-error';
import { ExpertCard } from './expert-card';
import type { ExpertListItem } from '@/types/expert';

interface ExpertSelectorDrawerProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 选好后的回调（接收 expertIds + expert list） */
  onConfirm: (selectedExperts: ExpertListItem[]) => void;
  /** 最多可选数量（默认 5） */
  max?: number;
  /** 最少可选数量（默认 2） */
  min?: number;
}

/**
 * 安全查表：根据 icon 名从 @tabler/icons-react 查组件
 * 找不到时返回 undefined（fallback IconSparkles）
 */
function IconLookup(name: string): React.ComponentType<{ size?: number; stroke?: number }> | undefined {
  const map = TablerIcons as unknown as Record<string, React.ComponentType<{ size?: number; stroke?: number }>>;
  return map[name];
}

export function ExpertSelectorDrawer({
  open,
  onClose,
  onConfirm,
  max = 5,
  min = 2,
}: ExpertSelectorDrawerProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 收藏
  const favIdsQ = trpc.expert.listFavoriteIds.useQuery(undefined, {
    enabled: open,
    staleTime: 30_000,
  });
  const favoriteIds = useMemo(() => new Set(favIdsQ.data ?? []), [favIdsQ.data]);
  const utils = trpc.useUtils();
  const favoriteMut = trpc.expert.favorite.useMutation({
    onSuccess: () => utils.expert.listFavoriteIds.invalidate(),
  });
  const unfavoriteMut = trpc.expert.unfavorite.useMutation({
    onSuccess: () => utils.expert.listFavoriteIds.invalidate(),
  });
  function toggleFavorite(id: string) {
    if (favoriteIds.has(id)) {
      unfavoriteMut.mutate({ id });
    } else {
      favoriteMut.mutate({ id });
    }
  }

  // 列表查询
  const listQ = trpc.expert.list.useQuery(
    { take: 50, category: category ?? undefined, search: search || undefined },
    { enabled: open, staleTime: 30_000 },
  );

  // 分类查询
  const categoriesQ = trpc.expert.categories.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  });

  const expertsData = listQ.data;
  const categoriesData = categoriesQ.data;
  const experts = useMemo(() => expertsData?.experts ?? [], [expertsData]);
  const categories = useMemo(() => categoriesData ?? [], [categoriesData]);

  const selectedExperts = useMemo(
    () => experts.filter((e) => selectedIds.has(e.id)),
    [experts, selectedIds],
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= max) {
          toast.warning(`最多只能选 ${max} 位专家`);
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    if (selectedExperts.length < min) {
      toast.warning(`至少需要 ${min} 位专家才能开会`);
      return;
    }
    onConfirm(selectedExperts);
    // 关闭 + 重置
    setSelectedIds(new Set());
    setExpandedId(null);
    onClose();
  }

  function handleClose() {
    setSelectedIds(new Set());
    setExpandedId(null);
    setSearch('');
    setCategory(null);
    onClose();
  }

  if (!open) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div
        onClick={handleClose}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
        aria-hidden
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="选择专家"
        className={[
          'fixed z-50 flex flex-col bg-background shadow-2xl',
          'transition-base gpu',
          // 桌面右侧滑出 / 移动底部 sheet
          'inset-y-0 right-0 w-full max-w-[520px] sm:max-w-[520px]',
          'md:w-[520px] md:rounded-l-2xl',
          // 移动：固定在底部
          'max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:h-[90vh] max-md:rounded-t-2xl',
        ].join(' ')}
      >
        {/* 顶部 Header */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconUsers size={18} stroke={1.8} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold leading-tight">选择专家</h2>
              <p className="text-[11px] text-muted-foreground">
                选 {min}~{max} 位专家组成会议团队
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <IconX size={18} />
          </button>
        </header>

        {/* 搜索 + Tab */}
        <div className="shrink-0 border-b px-5 py-3">
          <div className="relative mb-2.5">
            <IconSearch
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索专家名称、描述或标签…"
              className="w-full rounded-lg border bg-card py-2 pl-9 pr-3 text-[13px] outline-none transition-base input-focus focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* 分类 Tab 横向滚动 */}
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <CategoryTab
              active={category === null}
              onClick={() => setCategory(null)}
              label="全部"
              count={listQ.data?.total}
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
        </div>

        {/* 卡片网格 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {listQ.isLoading ? (
            <div className="flex h-full items-center justify-center py-12">
              <IconLoader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : listQ.isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-[13px] text-destructive">
              加载失败：{formatError(listQ.error)}
            </div>
          ) : experts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <TablerIcons.IconSearchOff
                size={36}
                stroke={1.4}
                className="mb-2 text-muted-foreground/50"
              />
              <p className="text-[13px] text-muted-foreground">
                {search || category ? '没找到符合条件的专家' : '暂无专家'}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                试试调整搜索词或切换分类
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {experts.map((expert) => (
                <ExpertCard
                  key={expert.id}
                  expert={expert}
                  selected={selectedIds.has(expert.id)}
                  expanded={expandedId === expert.id}
                  favorited={favoriteIds.has(expert.id)}
                  onSelect={() => toggleSelect(expert.id)}
                  onExpand={() =>
                    setExpandedId((prev) => (prev === expert.id ? null : expert.id))
                  }
                  onToggleFavorite={() => toggleFavorite(expert.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 底部固定 CTA */}
        <footer className="shrink-0 border-t bg-background px-5 py-3">
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="text-muted-foreground">
              已选{' '}
              <span
                className={[
                  'font-semibold',
                  selectedExperts.length >= min ? 'text-primary' : 'text-destructive',
                ].join(' ')}
              >
                {selectedExperts.length}
              </span>{' '}
              / {max} 位
              {selectedExperts.length < min && (
                <span className="ml-1 text-destructive">
                  （至少 {min} 位）
                </span>
              )}
            </span>
            {selectedExperts.length > 0 && (
              <div className="flex -space-x-1.5">
              {selectedExperts.slice(0, 5).map((e) => {
                const Icon = IconLookup(e.icon);
                return (
                  <div
                    key={e.id}
                    className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background"
                    style={{ backgroundColor: `${e.accentColor}22`, color: e.accentColor }}
                    title={e.name}
                  >
                    {Icon ? <Icon size={12} stroke={2} /> : <TablerIcons.IconSparkles size={12} />}
                  </div>
                );
              })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedExperts.length < min}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selectedExperts.length >= min ? (
              <>
                <IconCheck size={14} />
                确认选 {selectedExperts.length} 位专家
                <IconArrowRight size={14} />
              </>
            ) : (
              <>至少选择 {min} 位专家</>
            )}
          </button>
        </footer>
      </aside>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 分类 Tab 子组件
// ───────────────────────────────────────────────────────────────────────────

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
