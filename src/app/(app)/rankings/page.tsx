'use client';

/**
 * AI 模型性价比排行页面（升级版）
 *
 * 来源：整合 plan §4.3
 * 功能：
 *   - 从 tRPC API 读取数据库中的模型数据
 *   - 计算性价比（混合价 + 能力分 + 速度）
 *   - 显示帕累托前沿 + 完整排行表
 *   - 支持厂商筛选和搜索
 *
 * 升级：原版本基于静态 public/lvr 文件，现改为动态 tRPC API
 *
 * D-3 意图搜索：
 *   - 智能搜索框：输入时实时解析自然语言为结构化过滤条件
 *   - 意图预览：展示「我们理解你的意图是…」，用户可确认或修改
 *   - 降级：LLM 不可用时自动回退为字面搜索
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { ParetoChart } from '@/components/rankings/ParetoChart';
import { Top3Podium } from '@/components/rankings/Top3Podium';
import { RankingsTable } from '@/components/rankings/RankingsTable';
import { StatsOverview } from '@/components/rankings/StatsOverview';
import { useToast } from '@/components/toast';

// ---------------------------------------------------------------------------
// Types (mirroring intent-search.ts for UI consumption)
// ---------------------------------------------------------------------------

interface IntentFilter {
  provider?: string[];
  priceRange?: [number, number];
  priceField?: 'input' | 'output';
  minIntelligence?: number;
  minSpeed?: number;
  family?: string[];
  origin?: string[];
}

interface IntentPreview {
  query: string;
  filters?: IntentFilter;
  sort?: string;
}

interface SearchResult {
  query: string;
  intent: IntentPreview;
  degraded: boolean;
  degradeReason?: string;
  total: number;
  models: Array<{
    id: string;
    externalId: string;
    name: string;
    provider: string;
    family: string | null;
    priceInput: number;
    priceOutput: number;
    intelligence: number | null;
    speed: number | null;
    contextWindow: number | null; // Batch 6
    description: string | null;
    isPending: boolean;
    valueScore: number;
    blendPrice: number;
    isExcluded: boolean;
    excludeReason: string | null;
    rank: number;
  }>;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  // C-7 修复：必须用 useEffect，useMemo 的工厂返回函数不会被 React 当作 cleanup 调用，
  // 会导致 clearTimeout 永不执行、定时器雪崩
  useEffect(() => {
    const id = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debouncedValue;
}

// ---------------------------------------------------------------------------
// Intent Preview Panel
// ---------------------------------------------------------------------------

function IntentPreviewPanel({ result, onSearch, onClear }: {
  result: SearchResult;
  onSearch: () => void;
  onClear: () => void;
}) {
  const { intent, degraded, degradeReason } = result;
  const filters = intent.filters;

  const sortLabel: Record<string, string> = {
    'value-asc': '性价比升序（便宜优先）',
    'value-desc': '性价比降序（贵强优先）',
    'price-asc': '价格升序',
    'price-desc': '价格降序',
    'intelligence-desc': '能力分降序',
    'speed-desc': '速度降序',
    'recent': '最新更新',
    'relevance': '相关性',
  };

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">💡</span>
          <span className="font-medium text-primary">我们理解你的意图是：</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            清空
          </button>
          <button
            type="button"
            onClick={onSearch}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            搜索 {result.total} 条
          </button>
        </div>
      </div>

      {/* Query */}
      {intent.query && (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">查询</span>
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">&quot;{intent.query}&quot;</span>
        </div>
      )}

      {/* Filters */}
      {(filters?.provider?.length || filters?.priceRange || filters?.minIntelligence != null || filters?.minSpeed != null || filters?.origin?.length || filters?.family?.length) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">过滤</span>
          {filters.provider?.map((p) => (
            <span key={p} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {p}
            </span>
          ))}
          {filters.origin?.map((o) => (
            <span key={o} className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              {o}来源
            </span>
          ))}
          {filters.family?.map((f) => (
            <span key={f} className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
              {f}
            </span>
          ))}
          {filters.priceRange && (
            <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
              {filters.priceField === 'output' ? '输出' : '输入'}价 ${filters.priceRange[0]}–${filters.priceRange[1]}/M
            </span>
          )}
          {filters.minIntelligence != null && (
            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
              能力分 ≥ {filters.minIntelligence}
            </span>
          )}
          {filters.minSpeed != null && (
            <span className="rounded bg-pink-100 px-2 py-0.5 text-xs text-pink-700 dark:bg-pink-900/30 dark:text-pink-300">
              速度 ≥ {filters.minSpeed}
            </span>
          )}
        </div>
      )}

      {/* Sort */}
      {intent.sort && (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">排序</span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs">{sortLabel[intent.sort] ?? intent.sort}</span>
        </div>
      )}

      {/* Degraded warning */}
      {degraded && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
          ⚠️ LLM 不可用，已降级为字面搜索
          {degradeReason && <span className="opacity-60">（{degradeReason}）</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function RankingsPage() {
  const toast = useToast();
  const router = useRouter(); // H-10 修复：用 router.push 替代 window.location.href，避免整页强刷

  // 原有筛选状态
  const [provider, setProvider] = useState<string>();
  const [sort, setSort] = useState<'all' | 'value-asc' | 'price-asc'>('all');

  // D-3 意图搜索状态
  const [intentQuery, setIntentQuery] = useState('');
  const [confirmedQuery, setConfirmedQuery] = useState<string | null>(null);

  // 输入防抖（800ms 后触发意图解析）
  const debouncedQuery = useDebounce(intentQuery, 800);

  // 意图搜索 query（debounced）
  const intentSearchQuery = trpc.rankings.search.useQuery(
    { query: debouncedQuery },
    {
      enabled: debouncedQuery.trim().length > 0,
      // 每次新输入都重新请求（不缓存中间态）
      refetchOnWindowFocus: false,
    }
  );

  // 列表查询（confirmed 搜索时用 confirmedQuery；否则用 provider 筛选）
  const modelsQuery = trpc.rankings.list.useQuery(
    confirmedQuery ? undefined : { provider },
    { enabled: !confirmedQuery }
  );
  const providersQuery = trpc.rankings.providers.useQuery();
  const refreshMutation = trpc.rankings.refresh.useMutation({
    onSuccess: (data: { discovered?: number; updated?: number }) => {
      toast.success(`刷新完成：发现 ${data.discovered ?? 0} 个新模型，更新 ${data.updated ?? 0} 个`);
      modelsQuery.refetch();
      providersQuery.refetch();
    },
    onError: () => toast.error('刷新失败，请稍后重试'),
  });

  // 合并结果：意图搜索结果 > 列表结果
  const intentResult = intentSearchQuery.data as SearchResult | undefined;
  const isSearching = !!confirmedQuery;
  // 用 useMemo 稳定引用，避免每次渲染都生成新数组导致下方 useMemo 失效（lint）
  const displayModels = useMemo(
    () => (isSearching && intentResult ? intentResult.models : (modelsQuery.data ?? [])),
    [isSearching, intentResult, modelsQuery.data]
  );

  // 前端过滤（品牌/搜索）
  const filteredModels = useMemo(() => {
    if (!confirmedQuery && !sort) return displayModels;
    // 复制并按需排序（用宽口径类型避免 union 推断问题）
    const result = [...displayModels] as Array<typeof displayModels[number]>;
    if (sort === 'value-asc') {
      result.sort((a, b) => a.valueScore - b.valueScore);
    } else if (sort === 'price-asc') {
      result.sort((a, b) => a.priceInput - b.priceInput);
    }

    // ★ 修复：无论用户选什么 sort，被排除的（isExcluded）模型永远在末尾
    //   - 避免"价格升序"或"性价比升序"把 priceInput=0 / intel=null 的脏数据推到 Top
    return [...result].sort((a, b) => {
      if (a.isExcluded !== b.isExcluded) return a.isExcluded ? 1 : -1;
      return 0; // 已由后端排序好的 valueScore 顺序保持
    });
  }, [displayModels, confirmedQuery, sort]);

  // Top 3 候选：仅未被排除的
  const top3Candidates = useMemo(
    () => filteredModels.filter((m) => !m.isExcluded),
    [filteredModels]
  );

  // 点击搜索确认
  const handleConfirmSearch = useCallback(() => {
    setConfirmedQuery(debouncedQuery);
    setProvider(undefined); // 清空原有 provider 筛选，由意图接管
  }, [debouncedQuery]);

  // 清空意图搜索
  const handleClearIntent = useCallback(() => {
    setIntentQuery('');
    setConfirmedQuery(null);
  }, []);

  // 输入变化时实时预览意图（不需要用户确认）
  const showPreview = intentQuery.trim().length > 0 && !isSearching;

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <div className="mx-auto max-w-6xl px-8 py-10">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Rankings</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">AI 模型性价比排行</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              性价比 = f(能力) × 速度<sup>0.8</sup> / 混合价 · 共 {displayModels.length} 个模型
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {refreshMutation.isPending ? '刷新中…' : '刷新数据'}
          </button>
        </header>

        {/* 统计概览（仅非意图搜索时展示） */}
        {!isSearching && <StatsOverview models={filteredModels} />}

        {/* ========== D-3 智能搜索框 ========== */}
        <div className="mb-4">
          {/* 搜索输入 */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <span className="text-muted-foreground">
                {intentSearchQuery.isFetching ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                ) : (
                  '🔍'
                )}
              </span>
            </div>
            <input
              type="search"
              placeholder="搜索模型，试试「性价比高的中文模型」或「GPT-5」…"
              value={intentQuery}
              onChange={(e) => setIntentQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmSearch();
                if (e.key === 'Escape') handleClearIntent();
              }}
              className="w-full rounded-md border bg-card py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* 意图预览（debounce 后展示） */}
          {showPreview && intentSearchQuery.isFetching && (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-primary" />
              正在解析意图…
            </div>
          )}
          {showPreview && intentSearchQuery.isError && (
            <div className="mt-2 rounded bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              解析失败，已降级为字面搜索
            </div>
          )}
          {showPreview && !intentSearchQuery.isFetching && !intentSearchQuery.isError && intentResult && (
            <IntentPreviewPanel
              result={intentResult}
              onSearch={handleConfirmSearch}
              onClear={handleClearIntent}
            />
          )}
        </div>

        {/* ========== 传统筛选（意图搜索关闭时可见） ========== */}
        {!isSearching && (
          <div className="mb-6 flex flex-wrap gap-3">
            <select
              value={provider ?? ''}
              onChange={(e) => setProvider(e.target.value || undefined)}
              className="rounded-md border bg-card px-4 py-2 text-sm"
            >
              <option value="">全部厂商</option>
              {providersQuery.data?.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'all' | 'value-asc' | 'price-asc')}
              className="rounded-md border bg-card px-4 py-2 text-sm"
            >
              <option value="all">综合排序</option>
              <option value="value-asc">性价比升序</option>
              <option value="price-asc">价格升序</option>
            </select>
          </div>
        )}

        {/* ========== 搜索结果提示 ========== */}
        {isSearching && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span>🔍</span>
              <span>
                意图搜索：<strong>&quot;{confirmedQuery}&quot;</strong>
                {intentResult && (
                  <span className="ml-2 text-muted-foreground">找到 {intentResult.total} 条</span>
                )}
                {intentResult?.degraded && (
                  <span className="ml-1 text-yellow-600">（降级）</span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearIntent}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              返回列表
            </button>
          </div>
        )}

        {/* 领奖台 Top 3（仅展示未被排除的） */}
        {top3Candidates.length >= 3 && !isSearching && (
          <Top3Podium models={top3Candidates.slice(0, 3)} />
        )}

        {/* 帕累托图（意图搜索时隐藏图表，减少认知负担） */}
        {filteredModels.length > 0 && !isSearching && (
          <ParetoChart
            data={filteredModels.map((m) => ({
              id: m.id,
              name: m.name,
              priceInput: m.priceInput,
              intelligence: m.intelligence ?? 0,
            }))}
            onSelect={(id) => router.push(`/rankings/${id}`)}
          />
        )}

        {/* 完整排行表 */}
        <RankingsTable
          models={filteredModels}
          loading={modelsQuery.isLoading || (isSearching && intentSearchQuery.isFetching)}
        />

        {/* 跳转链接 */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          查看 AI 新闻中提到的模型 →
          <Link href="/news" className="ml-2 text-primary hover:underline">前往新闻页</Link>
        </div>
      </div>
    </div>
  );
}
