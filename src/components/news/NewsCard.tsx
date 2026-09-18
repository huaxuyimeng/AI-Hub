/**
 * 新闻卡片组件（v4 重构）
 *
 * 设计原则（2026-08-30 v4）：
 * - 无 emoji、无 box-shadow、无低劣渐变
 * - 简洁边框 + token 系统颜色
 * - 封面图懒加载，失败自动隐藏
 * - 厂家标签为可点击 Pill 风格
 * - 元数据用 mono 字体（技术感）
 *
 * 入参数据来自外部 RSS / HTML 抓取，需要先清洗：
 *   - title：解码 HTML 实体（避免 `&#8220;` `&amp;` 显示为字面字符）
 *   - summary：剥 HTML 标签（避免 `<div><a>...</a></div>` 之类被 React 当文本渲染）
 */

import { memo, useEffect, useState } from 'react';
import { decodeHtmlEntities, cleanSummary } from '@/lib/text';

/** 转义正则特殊字符，避免用户搜索 "(" "[" 等字符时 RegExp 抛异常 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 视频元数据（来自 NewsItem.media 字段，D-1 新增）*/
interface VideoMeta {
  kind?: 'video' | 'image' | 'audio';
  bvid?: string;
  author?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  url?: string;
}

interface NewsItemData {
  id: string;
  title: string;
  url: string;
  summary?: string | null;
  /** publishedAt 可为 null（时间未知） */
  publishedAt: string | null;
  /** 时间精度 */
  publishPrecision?: string | null;
  /** 爬取时间（createdAt 字段）：在 publishedAt 不可信时显示） */
  crawledAt?: string;
  category?: string | null;
  /** 封面图 URL（2026-08-30 新增） */
  coverUrl?: string | null;
  /** AI 厂家标签（OpenAI / DeepSeek 等）（2026-08-30 新增） */
  companyTags?: string[];
  crossSources?: string[];
  source?: { name: string };
  /** 多媒体引用（视频/音频/图片）（D-1 新增）*/
  media?: VideoMeta[] | null;
}

interface NewsCardProps {
  item: NewsItemData;
  highlight?: string;
  /** 点击厂家标签回调 */
  onCompanyTagClick?: (tag: string) => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 判断 publishedAt 是否可信：发布时间距离爬取时间不超过 5 分钟 → 视为不可信 */
function isPublishTimeReliable(publishedAt: string | null, crawledAt: string | undefined): boolean {
  if (!publishedAt || !crawledAt) return false;
  const diffMs = new Date(crawledAt).getTime() - new Date(publishedAt).getTime();
  return diffMs > 5 * 60 * 1000; // > 5 分钟 = 真实发布时间
}

export const NewsCard = memo(function NewsCard({ item, highlight, onCompanyTagClick }: NewsCardProps) {
  const titleText = decodeHtmlEntities(item.title);
  const summaryText = cleanSummary(item.summary);
  const timeUnreliable = item.crawledAt && !isPublishTimeReliable(item.publishedAt, item.crawledAt);
  const [coverFailed, setCoverFailed] = useState(false);

  // C-11 兜底：父级 key 缺失时，item 切换仍重置 coverFailed，避免旧 item 失败标记传染新 item
  useEffect(() => {
    setCoverFailed(false);
  }, [item.id, item.coverUrl]);

  const renderTitle = () => {
    if (!highlight) {
      return (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-foreground underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 transition hover:decoration-solid hover:text-foreground"
        >
          {titleText}
        </a>
      );
    }

    const regex = new RegExp(`(${escapeRegExp(highlight)})`, 'gi');
    const parts = titleText.split(regex);

    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium hover:underline"
      >
        {parts.map((p, i) =>
          p.toLowerCase() === highlight.toLowerCase() ? (
            <mark key={`${i}-${p}`} className="rounded bg-primary/20 px-1 text-primary">
              {p}
            </mark>
          ) : (
            <span key={`${i}-${p}`}>{p}</span>
          )
        )}
      </a>
    );
  };

  const showCover = item.coverUrl && !coverFailed;
  const videoEntry = item.media?.find((m) => m.kind === 'video');

  return (
    <article className="rounded-lg border border-border bg-card px-4 py-3 transition hover:border-foreground/30">
      <div className="flex gap-3">
        {/* 封面图（懒加载 + 错误兜底） */}
        {showCover && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
            aria-label="封面图链接"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* C-10 修复：去掉 crossOrigin="anonymous"，多数 RSS 源未配置 CORS 头，
                此属性会让浏览器拒绝加载并触发 onError → 封面永远不显示 */}
            <img
              src={item.coverUrl!}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-20 w-28 rounded border border-border bg-muted object-cover"
              onError={() => setCoverFailed(true)}
            />
          </a>
        )}

        <div className="min-w-0 flex-1">
          {/* 标题 + 时间 */}
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 flex-1">{renderTitle()}</div>
            <span
              className={`shrink-0 font-mono text-[10px] tabular-nums ${timeUnreliable ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
              title={
                timeUnreliable
                  ? `发布时间未知（此来源未提供）。爬取时间：${fmtTime(item.crawledAt!)}`
                  : undefined
              }
            >
              {item.publishedAt ? fmtTime(item.publishedAt) : '未知'}
              {timeUnreliable && (
                <span className="ml-1 rounded border border-border bg-muted px-1 py-px text-[9px] font-sans text-muted-foreground">
                  未知
                </span>
              )}
            </span>
          </div>

          {/* 摘要 */}
          {summaryText && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {summaryText}
            </p>
          )}

          {/* 标签条 */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            {videoEntry && (
              <span
                className="inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-medium text-primary"
                title={videoEntry.author ? `来源：B站 ${videoEntry.author}` : 'B 站视频'}
              >
                ▶ 视频{videoEntry.author ? ` · ${videoEntry.author}` : ''}
              </span>
            )}
            {item.source?.name && (
              <span className="rounded border border-border bg-background px-1.5 py-0.5 font-medium text-foreground/80">
                {item.source.name}
              </span>
            )}
            {item.category && (
              <span className="rounded border border-border bg-background px-1.5 py-0.5 text-muted-foreground">
                {item.category}
              </span>
            )}
            {item.companyTags && item.companyTags.map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => onCompanyTagClick?.(tag)}
                className="rounded border border-border bg-background px-1.5 py-0.5 font-medium text-foreground/90 transition hover:border-foreground/40 hover:bg-accent"
                title={`筛选 ${tag} 相关新闻`}
              >
                {tag}
              </button>
            ))}
            {item.crossSources && item.crossSources.length > 0 && (
              <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-foreground/70">
                {item.crossSources.length + 1} 源
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
});