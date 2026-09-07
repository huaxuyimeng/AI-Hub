'use client';

/**
 * 模型详情页面
 *
 * 来源：整合 plan §5.2
 * 功能：
 *   - 模型基本信息（名称、厂商、价格、能力分）
 *   - 价格走势（基于 ModelSnapshot）
 *   - 关联新闻（从 NewsItem 提取的 relatedModels 匹配）
 *   - 跳转外部 API Key 申请链接
 */

import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { PriceChart } from '@/components/rankings/PriceChart';
import { NewsCard } from '@/components/news/NewsCard';
import { BackButton } from '@/components/ui/back-button';

export default function ModelDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, error } = trpc.rankings.detail.useQuery({ id: params.id });

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto page-enter">
        <div className="mx-auto max-w-5xl px-8 py-10">
          <div className="rounded-lg border bg-card py-16 text-center text-sm text-muted-foreground">
            加载中…
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 overflow-y-auto page-enter">
        <div className="mx-auto max-w-5xl px-8 py-10">
          <div className="rounded-lg border border-destructive/40 bg-card py-16 text-center text-sm text-destructive">
            模型不存在或加载失败
          </div>
        </div>
      </div>
    );
  }

  const { model, relatedNews } = data;
  const intel = model.intelligence ?? 0;
  const speed = model.speed ?? 0;
  const blendPrice = model.priceInput * 0.7 + model.priceOutput * 0.3;

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <div className="mx-auto max-w-5xl px-8 py-10">
        {/* 标题区 */}
        <header className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <BackButton href="/rankings" title="返回排行" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {model.provider} {model.family ? `· ${model.family}` : ''}
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight">{model.name}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  标准化 ID：<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{model.externalId}</code>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {model.officialUrl && (
                <a
                  href={model.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border bg-card px-3 py-1.5 text-xs hover:bg-accent"
                >
                  官网 ↗
                </a>
              )}
              {model.apiKeyUrl && (
                <a
                  href={model.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  获取 API Key
                </a>
              )}
            </div>
          </div>
        </header>

        {/* 数据卡片 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">输入价</div>
            <div className="mt-1 font-mono text-lg">${model.priceInput.toFixed(2)}/M</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">输出价</div>
            <div className="mt-1 font-mono text-lg">${model.priceOutput.toFixed(2)}/M</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">能力分</div>
            <div className="mt-1 font-mono text-lg">{intel > 0 ? intel.toFixed(1) : '—'}</div>
          </div>
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">混合价</div>
            <div className="mt-1 font-mono text-lg">${blendPrice > 0 ? blendPrice.toFixed(2) : '—'}</div>
          </div>
        </div>

        {/* 状态徽章 */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {model.isPending && (
            <span className="rounded bg-warning/15 px-2 py-0.5 text-xs text-warning">
              待验证（爬虫未获取到数据）
            </span>
          )}
          {model.scoreSource && (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              分数来源：{model.scoreSource}
            </span>
          )}
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            速度：{speed > 0 ? `${speed} tokens/s` : '—'}
          </span>
        </div>

        {/* 描述 */}
        {model.description && (
          <div className="mb-6 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            {model.description}
          </div>
        )}

        {/* 价格走势 */}
        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold">价格走势</h2>
          {model.snapshots && model.snapshots.length > 1 ? (
            <PriceChart snapshots={model.snapshots} />
          ) : (
            <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
              暂无价格历史（首次刷新后开始记录）
            </div>
          )}
        </section>

        {/* 相关新闻 */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">相关新闻</h2>
            <span className="text-sm text-muted-foreground">共 {relatedNews.length} 篇</span>
          </div>
          {relatedNews.length === 0 ? (
            <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
              暂无相关新闻
            </div>
          ) : (
            <div className="space-y-3">
              {relatedNews.map((news) => (
                <NewsCard
                  key={news.id}
                  item={news}
                  highlight={model.externalId}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}