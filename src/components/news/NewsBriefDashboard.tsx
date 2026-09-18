/**
 * 新闻简要看板组件（NewsBriefDashboard）
 *
 * 功能：展示今日最新新闻的紧凑表格视图
 *   列：时间 | 标题（可点击跳转） | 来源 | 关键词 | 分类
 *
 * 设计原则（2026-09-01）：
 * - 紧凑表格，节省空间
 * - 固定表头，可滚动内容
 * - 每行 hover 高亮
 * - 点击标题跳转外链
 * - 默认折叠（可展开/收起）
 */

import { memo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { decodeHtmlEntities } from '@/lib/text';

interface BriefItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceName: string;
  category: string | null;
  companyTags: string[];
  crossSourcesCount: number;
}

interface NewsBriefDashboardProps {
  /** 默认展开状态（默认收起） */
  defaultOpen?: boolean;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function BriefRow({ item }: { item: BriefItem }) {
  const titleText = decodeHtmlEntities(item.title);
  const hasKeywords = item.companyTags.length > 0;
  const isMultiSource = item.crossSourcesCount > 0;

  return (
    <tr className="group border-b border-border/50 transition-colors hover:bg-muted/40">
      {/* 时间 */}
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <div className="flex flex-col">
          <span>{fmtTime(item.publishedAt)}</span>
          <span className="text-[9px] opacity-60">{fmtDate(item.publishedAt)}</span>
        </div>
      </td>

      {/* 标题 */}
      <td className="max-w-0 px-3 py-1.5">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[12px] font-medium text-foreground decoration-dotted underline-offset-2 transition hover:decoration-solid hover:text-primary"
          title={titleText}
        >
          {titleText}
        </a>
      </td>

      {/* 来源 */}
      <td className="whitespace-nowrap px-3 py-1.5 text-[10px]">
        <span
          className="rounded border border-border bg-background px-1.5 py-0.5 font-medium text-foreground/80"
          title={item.sourceName}
        >
          {item.sourceName}
        </span>
      </td>

      {/* 关键词 */}
      <td className="max-w-[200px] px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          {item.companyTags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary"
            >
              {tag}
            </span>
          ))}
          {item.companyTags.length > 3 && (
            <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
              +{item.companyTags.length - 3}
            </span>
          )}
          {!hasKeywords && item.category && (
            <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
              {item.category}
            </span>
          )}
        </div>
      </td>

      {/* 多源标记 */}
      <td className="whitespace-nowrap px-3 py-1.5 text-center">
        {isMultiSource ? (
          <span
            className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600"
            title={`${item.crossSourcesCount + 1} 个来源验证`}
          >
            {item.crossSourcesCount + 1}源
          </span>
        ) : (
          <span className="text-[9px] text-muted-foreground/40">—</span>
        )}
      </td>

      {/* 跳转 */}
      <td className="whitespace-nowrap px-3 py-1.5 text-right">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-[10px] text-primary opacity-0 transition-opacity group-hover:opacity-100"
          title="查看原文"
        >
          →
        </a>
      </td>
    </tr>
  );
}

export const NewsBriefDashboard = memo(function NewsBriefDashboard({
  defaultOpen = false,
}: NewsBriefDashboardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const briefQuery = trpc.news.brief.useQuery(
    { limit: 30 },
    {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const items = briefQuery.data ?? [];
  const isLoading = briefQuery.isLoading;
  const isEmpty = items.length === 0 && !isLoading;
  const todayCount = items.length;

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-card">
      {/* 标题栏 */}
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-muted/20"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            简报
          </span>
          <h2 className="text-[13px] font-semibold text-foreground">
            今日快讯
          </h2>
          {isLoading ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              加载中…
            </span>
          ) : todayCount > 0 ? (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              {todayCount} 条
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && todayCount === 0 && (
            <span className="text-[10px] text-muted-foreground">暂无数据</span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {isOpen ? '▲ 收起' : '▼ 展开'}
          </span>
        </div>
      </button>

      {/* 表格内容 */}
      {isOpen && (
        <div className="max-h-[320px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary mr-2" />
              加载今日快讯…
            </div>
          ) : isEmpty ? (
            <div className="py-6 text-center text-[12px] text-muted-foreground">
              今日暂无新闻数据，请点击上方「抓取新闻」
            </div>
          ) : (
            <table className="w-full border-t border-border text-left">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
                <tr className="border-b border-border/50 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="w-20 whitespace-nowrap px-3 py-2">时间</th>
                  <th className="px-3 py-2">标题</th>
                  <th className="w-24 whitespace-nowrap px-3 py-2">来源</th>
                  <th className="w-48 px-3 py-2">关键词</th>
                  <th className="w-12 whitespace-nowrap px-3 py-2 text-center">多源</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <BriefRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
});
