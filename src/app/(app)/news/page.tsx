'use client';

// AI 新闻薄页：读取本地新闻服务（127.0.0.1:8787）的已存档数据，不在页面加载时触发抓取。
// 服务未启动时给出明确指引：cd AI新闻/ai-news-daily && npm run serve

import { useCallback, useEffect, useMemo, useState } from 'react';

const API = 'http://127.0.0.1:8787';

interface NewsItem {
  id: string;
  title: string;
  summary?: string;
  url: string;
  sourceLabel: string;
  category: string;
  publishedAt: number | null;
  relatedSources?: string[];
}

interface NewsPayload {
  ok: boolean;
  date: string;
  total: number;
  byCategory: Record<string, number>;
  items: NewsItem[];
  warnings?: string[] | null;
}

function fmtTime(ts: number | null) {
  if (!ts) return '时间未知';
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NewsPage() {
  const [state, setState] = useState<'loading' | 'ready' | 'down'>('loading');
  const [data, setData] = useState<NewsPayload | null>(null);
  const [category, setCategory] = useState('全部');
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`${API}/api/news`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as NewsPayload;
      setData(json);
      setState('ready');
    } catch {
      setState('down');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API}/api/refresh`, { method: 'POST', signal: AbortSignal.timeout(600000) });
      await load();
    } catch {
      setState('down');
    } finally {
      setRefreshing(false);
    }
  };

  const items = useMemo(() => {
    if (!data) return [];
    const kw = q.trim().toLowerCase();
    return data.items.filter((it) => {
      if (category !== '全部' && it.category !== category) return false;
      if (kw && !`${it.title} ${it.summary ?? ''} ${it.sourceLabel}`.toLowerCase().includes(kw))
        return false;
      return true;
    });
  }, [data, category, q]);

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">News</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">AI 新闻推送</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {data
                ? `${data.date} · 共 ${data.total} 条 · 多源聚合 + 交叉验证`
                : '每日多源聚合（本地存档，不在加载时重抓）'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing || state !== 'ready'}
              className="whitespace-nowrap rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {refreshing ? '抓取中…' : '立即抓取'}
            </button>
            <a
              href={`${API}/advanced.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="whitespace-nowrap rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              完整版（日历 / PPT）↗
            </a>
          </div>
        </header>

        {state === 'down' && (
          <div className="rounded-lg border border-warning/40 bg-card px-6 py-10 text-center">
            <div className="text-sm font-medium">新闻服务未启动</div>
            <p className="mt-2 text-xs text-muted-foreground">请先启动新闻服务：</p>
            <code className="mt-2 block max-w-full overflow-x-auto whitespace-nowrap rounded-md border bg-background px-3 py-2 text-left font-mono text-[11px]">
              cd AI新闻/ai-news-daily &amp;&amp; npm run serve
            </code>
            <button
              type="button"
              onClick={load}
              className="mt-4 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              重试连接
            </button>
          </div>
        )}

        {state === 'loading' && (
          <div className="rounded-lg border bg-card py-16 text-center text-sm text-muted-foreground">
            读取本地存档…
          </div>
        )}

        {state === 'ready' && data && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {['全部', ...Object.keys(data.byCategory || {})].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={
                    'rounded-md px-2.5 py-1 text-xs transition ' +
                    (category === c
                      ? 'bg-primary font-medium text-primary-foreground'
                      : 'border bg-card text-muted-foreground hover:bg-accent')
                  }
                >
                  {c}
                  {c !== '全部' && data.byCategory[c] ? ` ${data.byCategory[c]}` : ''}
                </button>
              ))}
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索标题 / 摘要 / 来源…"
                aria-label="搜索新闻"
                className="ml-auto w-56 rounded-md border bg-card px-3 py-1.5 text-xs focus:border-primary focus:outline-none"
              />
            </div>

            {data.warnings?.length ? (
              <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
                降级警告：{data.warnings.join('；')}
              </p>
            ) : null}

            <div className="space-y-2">
              {items.length === 0 && (
                <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
                  没有匹配的新闻
                </div>
              )}
              {items.map((it) => (
                <article key={it.id} className="rounded-lg border bg-card px-4 py-3 transition hover:border-primary/50">
                  <div className="flex items-baseline justify-between gap-3">
                    {/* 新闻外链保持中性色，不套平台主题色 */}
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-solid"
                    >
                      {it.title}
                    </a>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(it.publishedAt)}</span>
                  </div>
                  {it.summary && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{it.summary}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5">{it.sourceLabel}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5">{it.category}</span>
                    {(it.relatedSources?.length ?? 0) > 1 && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                        {it.relatedSources!.length} 源共同报道
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
