'use client';

/**
 * AI 新闻页面（v5 - 累积加载 + 智能搜索）
 *
 * 设计原则（2026-08-31 v5）：
 * - 新闻是主体，其他是次要（视觉层次）
 * - 右上角实时时钟（年月日小 / 时分秒大）
 * - 「加载更多」累积追加下一页（不替换当前列表）
 * - 搜索经术语词典同义词展开（D-2 智能搜索）
 * - 次要元素（筛选、统计）默认收起
 * - 服务端分页：只有点「加载更多」才拉取更多数据
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { NewsCard } from '@/components/news/NewsCard';
import { NewsAnalyticsModal } from '@/components/news/NewsAnalyticsModal';
import { NewsBriefDashboard } from '@/components/news/NewsBriefDashboard';
import { BriefingPanel } from '@/features/daily-briefing/components/BriefingPanel';
import { BilibiliNewsTab } from '@/components/bilibili/BilibiliNewsTab';

const CATEGORIES = ['全部', 'AI Coding', 'AI IDE', '具身智能', 'AI政策'];
const PAGE_SIZE = 50;

type NewsItemData = Parameters<typeof NewsCard>[0]['item'];

/**
 * 实时时钟（右上角）
 * 年月日小，时分秒大
 * H-14/H-21 修复：tab 切到后台时暂停（visibilitychange + document.hidden），
 * 否则每秒 setState 浪费 CPU/电池；切回时立即刷新一次
 */
function LiveClock() {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => setTime(new Date());
    const start = () => {
      if (timer) return;
      tick();
      timer = setInterval(tick, 1000);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start(); // 切回前台立即刷一次
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // SSR 阶段不渲染（避免 hydration 警告）
  if (!time) {
    return (
      <div className="flex items-baseline gap-2 font-mono tabular-nums opacity-0">
        <span className="text-[11px]">0000-00-00</span>
        <span className="text-lg font-semibold">00:00:00</span>
      </div>
    );
  }

  const ymd = time.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const hms = time.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <div className="flex items-baseline gap-2 font-mono tabular-nums">
      <span className="text-[11px] text-muted-foreground">{ymd}</span>
      <span className="text-lg font-semibold text-foreground">{hms}</span>
    </div>
  );
}

/** 输入防抖 hook */
function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** 意图搜索结果（精简版，避免和 search.ts 类型耦合） */
interface IntentSearchResponse {
  query: string;
  intent: {
    query: string;
    filters?: {
      category?: string;
      companyTags?: string[];
      keywords?: string[];
      dateRange?: { preset?: string; start?: string; end?: string };
      hasCover?: boolean;
      hasMedia?: boolean;
    };
    sort?: string;
    expandSynonyms?: boolean;
  };
  degraded: boolean;
  degradeReason?: string;
  total: number;
  items: NewsItemData[];
  expandedKeywords?: string[];
  matchedTerms?: Array<{ canonical: string; displayName: string; type: string }>;
}

/** 扩展 NewsItemData 类型（intent 模式返回的 items 字段） */
type IntentNewsItem = NewsItemData & {
  crossSources?: string[];
  relatedModels?: string[];
  media?: NewsItemData['media'];
};

/**
 * 意图预览面板
 * 来源：33 报告 §1 待办 — 前端接入
 * 设计：仿照 rankings/page.tsx IntentPreviewPanel，简化（不提供"应用"按钮，自动随输入更新）
 */
function IntentPreviewPanel({
  result,
  onSwitchToLiteral,
}: {
  result: IntentSearchResponse;
  onSwitchToLiteral: () => void;
}) {
  const filters = result.intent.filters;
  const datePresetLabel: Record<string, string> = {
    today: '今天',
    yesterday: '昨天',
    'last-3-days': '近 3 天',
    'last-week': '近一周',
    'last-month': '近一月',
    'last-quarter': '近三月',
    custom: '自定义区间',
  };

  const hasAny = filters?.category || filters?.companyTags?.length || filters?.dateRange?.preset || filters?.hasCover !== undefined || filters?.hasMedia !== undefined;

  if (!hasAny) {
    return (
      <div className="mt-2 rounded border border-border bg-card/40 p-2 text-[11px] text-muted-foreground">
        未识别到具体过滤条件，将按关键词「{result.intent.query}」字面搜索
      </div>
    );
  }

  return (
    <div className="mt-2 rounded border border-primary/30 bg-primary/5 p-2 text-[11px]">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-primary">
        💡 智能搜索已解析
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters?.category && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">分类: {filters.category}</span>
        )}
        {filters?.companyTags?.length && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">
            厂家: {filters.companyTags.join(' / ')}
          </span>
        )}
        {filters?.dateRange?.preset && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">
            时间: {datePresetLabel[filters.dateRange.preset] ?? filters.dateRange.preset}
          </span>
        )}
        {filters?.hasCover === true && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">仅含封面</span>
        )}
        {filters?.hasCover === false && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">无封面</span>
        )}
        {filters?.hasMedia === true && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">含视频</span>
        )}
        {filters?.hasMedia === false && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">无视频</span>
        )}
        {result.intent.query && (
          <span className="rounded bg-muted px-2 py-0.5 font-mono">关键词: &quot;{result.intent.query}&quot;</span>
        )}
      </div>
      {result.degraded && (
        <div className="mt-1.5 flex items-center gap-1.5 text-yellow-600">
          ⚠️ LLM 不可用，已降级为字面搜索
          {result.degradeReason && <span className="opacity-60">（{result.degradeReason}）</span>}
        </div>
      )}
      <button
        type="button"
        onClick={onSwitchToLiteral}
        className="mt-1.5 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
      >
        改用关键词搜索
      </button>
    </div>
  );
}

export default function NewsPage() {
  const toast = useToast();
  const [date, setDate] = useState<string>();
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');  // 防抖用：区分输入框与查询
  const [intentMode, setIntentMode] = useState(false); // 智能搜索模式（自然语言）
  const [companyTag, setCompanyTag] = useState<string>();
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [activeView, setActiveView] = useState<'news' | 'bilibili'>('news');

  /** 已累积加载的新闻（跨分页追加） */
  const [items, setItems] = useState<NewsItemData[]>([]);

  const newsQuery = trpc.news.list.useQuery(
    {
      date,
      category: category === '全部' ? undefined : category,
      search: search.trim() || undefined,
      companyTag,
      limit: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    },
    {
      staleTime: 5 * 60 * 1000,
      // 换页时保留旧数据占位，避免列表闪烁
      placeholderData: (previousData) => previousData,
      refetchOnWindowFocus: false,
    }
  );

  // 数据到达后同步累积列表：第 0 页替换，后续页去重追加
  // 占位数据（旧 key 的缓存）不参与同步，避免筛选切换瞬间列表回跳
  useEffect(() => {
    const data = newsQuery.data;
    if (!data || newsQuery.isPlaceholderData) return;
    if (page === 0) {
      setItems(data.items);
    } else {
      setItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        const added = data.items.filter(i => !seen.has(i.id));
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    }
  }, [newsQuery.data, page, newsQuery.isPlaceholderData]);

  // 搜索防抖（300ms 后才真正查询）
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // 智能搜索（意图模式）：debounce 800ms 触发 LLM 解析
  const debouncedIntentInput = useDebounce(searchInput, 800);
  const intentQuery = trpc.news.intentSearch.useQuery(
    { query: debouncedIntentInput.trim() },
    {
      enabled: intentMode && debouncedIntentInput.trim().length >= 2,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const datesQuery = trpc.news.dates.useQuery();
  const statsQuery = trpc.news.stats.useQuery();
  const analyticsQuery = trpc.news.analytics.useQuery(undefined, {
    enabled: analyticsOpen,
    staleTime: 60 * 1000,
  });

  const refreshMutation = trpc.news.refresh.useMutation({
    onSuccess: (data: { totalItems: number }) => {
      toast.success(`抓取完成，共 ${data.totalItems} 条`);
      setPage(0);
      newsQuery.refetch();
      statsQuery.refetch();
      datesQuery.refetch();
    },
    onError: () => toast.error('抓取失败，请稍后重试'),
  });

  // H-15 修复：自动抓取独立 mutation，避免 useRef 追踪 + deps 警告
  const hasFilter = !!(date || category !== '全部' || search.trim() || companyTag);
  const autoRefreshMutation = trpc.news.refresh.useMutation({
    onSuccess: (data: { totalItems: number }) => {
      toast.success(`抓取完成，共 ${data.totalItems} 条`);
      setPage(0);
      newsQuery.refetch();
      statsQuery.refetch();
      datesQuery.refetch();
    },
    onError: () => toast.error('抓取失败，请稍后重试'),
  });

  // 挂载时一次：仅当无筛选 + 空数据时才触发
  useEffect(() => {
    if (!hasFilter && !newsQuery.isLoading && (newsQuery.data?.items.length ?? 0) < 5) {
      autoRefreshMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only：所有条件在 mount 时已确定

  const totalInDb = statsQuery.data?.total ?? 0;
  /** 当前筛选条件下的数据库总数（服务端返回） */
  const filteredTotal = newsQuery.data?.filteredTotal ?? 0;
  /** 服务端告诉我们是否还有更多 */
  const hasMore = newsQuery.data?.hasMore ?? false;
  const remaining = Math.max(0, filteredTotal - items.length);
  /** 同义词展开信息（D-2） */
  const searchMeta = newsQuery.data?.search ?? null;

  // 分类计数来自服务端全量统计（不再用当前页估算）
  const categoryCounts = statsQuery.data?.categoryCounts ?? {};

  // 已加载数据中的厂家标签（去重 + 计数）
  const companyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      for (const tag of item.companyTags ?? []) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [items]);

  const handleCompanyTagClick = useCallback((tag: string) => {
    setCompanyTag(prev => (prev === tag ? undefined : tag));
    setPage(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
    setPage(0);
  };

  /** 智能搜索模式下显示意图结果，否则显示关键词搜索结果 */
  const intentResult = intentQuery.data as IntentSearchResponse | undefined;
  const isIntentSearching = intentMode && searchInput.trim().length >= 2;
  // 意图模式时,显示意图结果覆盖 items
  const displayItems: NewsItemData[] = isIntentSearching && intentResult ? intentResult.items : items;
  const displayTotal: number = isIntentSearching && intentResult ? intentResult.total : filteredTotal;

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* ===== Header：标题 + 时钟 ===== */}
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
              News
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              AI 新闻聚合
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1">
            <LiveClock />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setBriefingOpen(true)}
                className="rounded border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:border-foreground/30"
              >
                AI 早报
              </button>
              <button
                type="button"
                onClick={() => setFilterExpanded(v => !v)}
                className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
              >
                {filterExpanded ? '收起筛选' : '展开筛选'}
              </button>
              <button
                type="button"
                onClick={() => setAnalyticsOpen(true)}
                className="rounded border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
              >
                数据统计
              </button>
              <button
                type="button"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {refreshMutation.isPending ? '抓取中…' : '抓取新闻'}
              </button>
            </div>
          </div>
        </header>

        {/* ===== 次要：筛选区（默认收起） ===== */}
        {filterExpanded && (
          <section className="mb-5 rounded-lg border border-border bg-card/60 p-4">
            <div className="flex flex-col gap-3">
              {/* 分类 */}
              <div>
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  分类
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map(cat => {
                    const count = cat === '全部' ? totalInDb : (categoryCounts[cat] ?? 0);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => { setCategory(cat); setPage(0); }}
                        className={
                          'rounded px-2.5 py-1 text-xs transition ' +
                          (category === cat
                            ? 'bg-foreground font-medium text-background'
                            : 'border border-border bg-background text-foreground/80 hover:bg-accent')
                        }
                      >
                        {cat}
                        <span className={`ml-1 font-mono text-[10px] ${category === cat ? 'text-background/60' : 'text-muted-foreground/60'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 厂家 */}
              {companyCounts.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                    AI 厂家（已加载范围内）
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {companyCounts.map(([tag, count]) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleCompanyTagClick(tag)}
                        className={
                          'rounded px-2 py-0.5 text-xs transition ' +
                          (companyTag === tag
                            ? 'bg-foreground font-medium text-background'
                            : 'border border-border bg-background text-foreground/80 hover:bg-accent')
                        }
                      >
                        {tag}
                        <span className={`ml-1 font-mono text-[10px] ${companyTag === tag ? 'text-background/60' : 'text-muted-foreground/60'}`}>
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 搜索 + 日期 */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  aria-label="搜索新闻标题或摘要"
                  placeholder={intentMode
                    ? "试试「具身智能最近一周」「OpenAI 和 Anthropic 吵架」…"
                    : "搜索标题或摘要（支持同义词展开）…"}
                  className="flex-1 min-w-[160px] rounded border border-border bg-background px-3 py-1.5 text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/30"
                />
                {/* 智能搜索模式开关（D-3 接入） */}
                <button
                  type="button"
                  onClick={() => setIntentMode(v => !v)}
                  title={intentMode ? '当前：智能搜索（自然语言）' : '当前：关键词搜索'}
                  className={
                    'rounded px-2 py-1.5 text-[11px] transition ' +
                    (intentMode
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'border border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground')
                  }
                >
                  🧠 智能
                </button>
                {datesQuery.data && datesQuery.data.length > 0 && (
                  <select
                    value={date ?? ''}
                    onChange={e => { setDate(e.target.value || undefined); setPage(0); }}
                    className="rounded border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="">所有日期</option>
                    {datesQuery.data.slice(0, 30).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* 智能搜索意图预览 */}
              {isIntentSearching && intentResult && (
                <IntentPreviewPanel
                  result={intentResult}
                  onSwitchToLiteral={() => setIntentMode(false)}
                />
              )}
              {isIntentSearching && intentQuery.isFetching && !intentResult && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                  正在解析意图…
                </div>
              )}
            </div>
          </section>
        )}

        {/* ===== 活跃筛选 + 同义词提示 ===== */}
        {(hasFilter || searchMeta?.matchedTerms.length) ? (
          <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px]">
            {date && (
              <ActiveChip label={`${date}`} onClear={() => { setDate(undefined); setPage(0); }} />
            )}
            {category !== '全部' && (
              <ActiveChip label={category} onClear={() => { setCategory('全部'); setPage(0); }} />
            )}
            {search.trim() && (
              <ActiveChip label={`"${search}"`} onClear={clearSearch} />
            )}
            {companyTag && (
              <ActiveChip label={companyTag} onClear={() => { setCompanyTag(undefined); setPage(0); }} />
            )}
            {searchMeta && searchMeta.matchedTerms.length > 0 && (
              <span
                className="inline-flex items-center rounded border border-border bg-muted px-2 py-0.5 text-muted-foreground"
                title={`已展开同义词：${searchMeta.expandedKeywords.join('、')}`}
              >
                智能搜索 · 已展开 {searchMeta.expandedKeywords.length} 个关键词
                （{searchMeta.matchedTerms.map(t => t.displayName).join('、')}）
              </span>
            )}
            <button
              type="button"
              onClick={() => { setDate(undefined); setCategory('全部'); clearSearch(); setCompanyTag(undefined); }}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              清除
            </button>
          </div>
        ) : null}

        {/* ===== 主视图切换（新闻 / B站资讯）===== */}
        <div className="mb-4 flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setActiveView('news')}
            className={
              'rounded px-3 py-1 text-xs font-medium transition ' +
              (activeView === 'news'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            AI 新闻
          </button>
          <button
            type="button"
            onClick={() => setActiveView('bilibili')}
            className={
              'rounded px-3 py-1 text-xs font-medium transition ' +
              (activeView === 'bilibili'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground')
            }
          >
            B站资讯
          </button>
        </div>

        {/* ===== B站资讯视图 ===== */}
        {activeView === 'bilibili' ? (
          <BilibiliNewsTab />
        ) : (
          <>
            {/* ===== 新闻简要看板（2026-09-01 新增）===== */}
            <NewsBriefDashboard defaultOpen={false} />
            {/* ===== 新闻数量 + 来源信息 ===== */}
            {displayItems.length > 0 && (
              <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {isIntentSearching ? '智能搜索命中 ' : '已加载 '}{displayItems.length} 条 · 匹配 {displayTotal} 条
                  {!hasFilter && !isIntentSearching && totalInDb > filteredTotal && ` · 数据库 ${totalInDb} 条`}
                </span>
                <span>按发布时间倒序 · 北京时间</span>
              </div>
            )}

            {/* ===== 新闻列表（主体）===== */}
            {newsQuery.isLoading && displayItems.length === 0 ? (
              <div className="rounded-lg border border-border bg-card py-20 text-center text-sm text-muted-foreground">
                加载中…
              </div>
            ) : displayItems.length === 0 ? (
              <div className="rounded-lg border border-border bg-card py-20 text-center">
                <p className="text-sm text-muted-foreground">
                  {totalInDb === 0
                    ? '暂无新闻数据，点击「抓取新闻」开始'
                    : isIntentSearching
                      ? '智能搜索未命中，试试改用关键词搜索'
                      : '当前筛选下没有匹配的新闻'}
                </p>
                {totalInDb === 0 && (
                  <button
                    type="button"
                    onClick={() => refreshMutation.mutate()}
                    className="mt-3 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    抓取新闻
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {displayItems.map(item => (
                    <NewsCard
                      key={item.id}
                      item={item}
                      highlight={search.trim()}
                      onCompanyTagClick={handleCompanyTagClick}
                    />
                  ))}
                </div>

                {/* ===== 更多新闻按钮（累积追加）===== */}
                {hasMore && !isIntentSearching && (
                  <div className="mt-6 flex flex-col items-center gap-3 py-4">
                    <div className="h-px w-full border-t border-border" />
                    <button
                      type="button"
                      onClick={() => setPage(p => p + 1)}
                      disabled={newsQuery.isFetching}
                      className="flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-2.5 text-sm text-foreground transition hover:border-foreground/40 hover:bg-accent disabled:opacity-50"
                    >
                      {newsQuery.isFetching ? (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border border-border border-t-foreground" />
                          加载中…
                        </>
                      ) : (
                        <>加载更多新闻（{remaining} 条剩余）</>
                      )}
                    </button>
                    {refreshMutation.isPending && (
                      <p className="text-[11px] text-muted-foreground">后台正在抓取新新闻…</p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ===== 统计 Modal ===== */}
      <NewsAnalyticsModal
        data={analyticsQuery.data}
        loading={analyticsQuery.isLoading}
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
      />

      {/* ===== AI 早报面板 ===== */}
      <BriefingPanel open={briefingOpen} onClose={() => setBriefingOpen(false)} />
    </div>
  );
}

/* ============ 内部组件 ============ */

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground"
        aria-label={`清除筛选 ${label}`}
      >
        x
      </button>
    </span>
  );
}
