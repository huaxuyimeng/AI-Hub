/**
 * 今日 B 站 UP 主视频面板（D-1）
 *
 * 展示内容：
 *   - 横向滚动卡片列表（每个 UP 主一条最新视频）
 *   - 缩略图 + 标题 + UP 主名 + 播放量
 *   - 鼠标悬停显示提取的新闻条目数
 *
 * 设计原则：
 *   - 与 NewsCard 风格一致（无 emoji、无 box-shadow、简洁边框）
 *   - 视频卡片显示在新闻流顶部，作为"今日精选"高亮区
 *   - 失败兜底：API 无数据时不显示整个面板
 */

import { memo, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

interface VideoItem {
  bvid: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  durationSec: number;
  publishedAt: number;
  playCount: number;
  method: string;
  articleUrl: string | null;
  news: Array<{ title: string; summary: string; category: string }>;
}

interface UPItem {
  uid: string;
  name: string;
  tag: string;
  priority: number;
  videos: VideoItem[];
}

export function BilibiliPanel() {
  const { data, isLoading, error } = trpc.bilibili.current.useQuery(undefined, {
    staleTime: 30 * 60 * 1000, // 30 分钟
    refetchOnWindowFocus: false,
  });

  // 三种状态：加载中、错误、空数据
  if (isLoading) {
    return (
      <section className="mb-5 rounded-lg border border-border bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">今日 B 站</h2>
          <span className="text-[10px] font-mono text-muted-foreground/60">Loading…</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="aspect-video animate-pulse rounded border border-border bg-muted"
            />
          ))}
        </div>
      </section>
    );
  }

  if (error || !data) {
    return null; // 失败时静默隐藏，不影响新闻主体
  }

  const ups = (data.ups ?? []) as UPItem[];
  if (ups.length === 0) {
    return null;
  }

  // 每个 UP 主取最新一条视频
  const latestByUP = ups
    .map((up) => {
      const video = up.videos?.[0];
      if (!video) return null;
      return { up, video };
    })
    .filter((x): x is { up: UPItem; video: VideoItem } => x !== null)
    .sort((a, b) => b.up.priority - a.up.priority);

  if (latestByUP.length === 0) return null;

  return (
    <section className="mb-5 rounded-lg border border-border bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">今日 B 站</h2>
        <span className="text-[10px] font-mono text-muted-foreground/60">
          {data.fetchedAt
            ? new Date(data.fetchedAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '未抓取'}
          {data.note && (
            <span className="ml-2 rounded border border-border bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
              {data.note}
            </span>
          )}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {latestByUP.slice(0, 5).map(({ up, video }) => (
          <BiliVideoCard key={up.uid} up={up} video={video} />
        ))}
      </div>
    </section>
  );
}

interface BiliVideoCardProps {
  up: UPItem;
  video: VideoItem;
}

const BiliVideoCard = memo(function BiliVideoCard({ up, video }: BiliVideoCardProps) {
  const [hovered, setHovered] = useState(false);
  // H-29 修复：同时跟踪键盘焦点（Tab 键聚焦时也展开新闻预览）
  const [focused, setFocused] = useState(false);
  const showPreview = (hovered || focused) && (video.news?.length ?? 0) > 0;
  const newsCount = video.news?.length ?? 0;
  const duration = formatDuration(video.durationSec);

  return (
    <Link
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-lg border border-border bg-background transition hover:border-foreground/40 focus-visible:border-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      aria-label={`${video.title}，UP 主：${up.name}，时长 ${duration || '未知'}${newsCount > 0 ? `，含 ${newsCount} 条新闻摘要` : ''}`}
    >
      {/* 缩略图 */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground/40">
            视频
          </div>
        )}
        {/* 时长 */}
        {duration && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px font-mono text-[10px] tabular-nums text-white">
            {duration}
          </span>
        )}
        {/* 新闻条数 */}
        {newsCount > 0 && (
          <span
            className="absolute left-1 top-1 rounded bg-primary/90 px-1.5 py-px text-[10px] font-medium text-primary-foreground"
            title={`提取了 ${newsCount} 条新闻`}
          >
            {newsCount} 条
          </span>
        )}
      </div>

      {/* 元数据 */}
      <div className="p-2">
        <p className="line-clamp-2 text-[11px] font-medium leading-snug text-foreground group-hover:underline">
          {video.title}
        </p>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="truncate">{up.name}</span>
          <span className="font-mono tabular-nums">{formatPlay(video.playCount)}</span>
        </div>
        {showPreview && (
          <div className="mt-1.5 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
            <p className="line-clamp-2">
              {video.news.slice(0, 2).map((n) => n.title).join(' · ')}
            </p>
          </div>
        )}
      </div>
    </Link>
  );
});

function formatDuration(sec: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPlay(play: number): string {
  if (play >= 10000) return `${(play / 10000).toFixed(1)}万`;
  if (play >= 1000) return `${(play / 1000).toFixed(1)}k`;
  return String(play);
}
