/**
 * B站资讯 Tab 组件（AI 新闻页独立标签）
 *
 * 展示内容：
 *   - 所有订阅 UP 主（不限于 5 个），每人一卡
 *   - 卡片顶部：UP 主名 + 标签 + 视频数 + 资讯条数
 *   - 展开后：最新视频 + 从视频字幕/标题提取的 AI 资讯列表
 *
 * 数据来源：trpc.bilibili.current
 */

import { memo, useState } from 'react';
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

function timeAgo(unixSec: number): string {
  const diff = Date.now() - unixSec * 1000;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}天前`;
  if (h > 0) return `${h}小时前`;
  if (m > 0) return `${m}分钟前`;
  return '刚刚';
}

/** 单个 UP 主卡片 */
const UPCollapseCard = memo(function UPCollapseCard({ up }: { up: UPItem }) {
  const [expanded, setExpanded] = useState(false);
  const totalNews = up.videos.reduce((s, v) => s + (v.news?.length ?? 0), 0);
  const latestVideo = up.videos?.[0];

  // 生成一个稳定的伪头像颜色
  const hue = (up.uid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360);

  return (
    <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
      {/* 卡片头部（始终可见） */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-accent/40"
      >
        {/* 伪头像 */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white select-none"
          style={{ background: `hsl(${hue}, 55%, 50%)` }}
          aria-hidden="true"
        >
          {up.name.slice(0, 1)}
        </div>

        {/* 名称 + 标签 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{up.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{up.tag}</p>
        </div>

        {/* 统计徽章 */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {up.videos.length} 视频
          </span>
          {totalNews > 0 && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
              {totalNews} 资讯
            </span>
          )}
        </div>

        {/* 展开图标 */}
        <span className="shrink-0 text-muted-foreground transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-border">
          {/* 最新视频 */}
          {latestVideo ? (
            <div className="flex gap-3 p-3 border-b border-border">
              {/* 缩略图 */}
              <a
                href={latestVideo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block h-16 w-28 shrink-0 overflow-hidden rounded bg-muted"
                onClick={e => e.stopPropagation()}
              >
                {latestVideo.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={latestVideo.thumbnailUrl}
                    alt={latestVideo.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground/40">视频</div>
                )}
                {latestVideo.durationSec > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-px font-mono text-[9px] text-white">
                    {formatDuration(latestVideo.durationSec)}
                  </span>
                )}
              </a>

              {/* 视频信息 */}
              <div className="flex-1 min-w-0">
                <a
                  href={latestVideo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 text-xs font-medium text-foreground hover:underline"
                >
                  {latestVideo.title}
                </a>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{timeAgo(latestVideo.publishedAt)}</span>
                  <span className="font-mono">{formatPlay(latestVideo.playCount)}播放</span>
                  {latestVideo.method && (
                    <span className="rounded border border-border bg-muted px-1 py-px text-[9px]">
                      {latestVideo.method}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">暂无视频数据</p>
          )}

          {/* 提取的 AI 资讯列表 */}
          {up.videos.some(v => v.news?.length > 0) ? (
            <div className="p-3 space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-2">
                提取自视频的 AI 资讯
              </p>
              {up.videos.flatMap((v) =>
                (v.news ?? []).map((n, i) => (
                  <div key={`${v.bvid}-${i}`} className="flex gap-2">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    <div className="flex-1 min-w-0">
                      <p className="line-clamp-2 text-xs leading-snug text-foreground">{n.title}</p>
                      {n.summary && (
                        <p className="line-clamp-1 mt-0.5 text-[10px] text-muted-foreground">{n.summary}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="p-3 text-xs text-muted-foreground">
              本次抓取暂无提取到资讯（视频字幕可能为空或抓取失败）
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * B站资讯标签页组件
 */
export function BilibiliNewsTab() {
  const { data, isLoading, error } = trpc.bilibili.current.useQuery(undefined, {
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-muted" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted-foreground">
        B站数据加载失败，请稍后刷新页面重试
      </div>
    );
  }

  const ups = (data.ups ?? []) as UPItem[];
  if (ups.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted-foreground">
        尚未抓取过 B站数据，请等待定时抓取或手动触发抓取
      </div>
    );
  }

  // 按优先级排序
  const sorted = [...ups].sort((a, b) => b.priority - a.priority);

  return (
    <div>
      {/* 头部信息栏 */}
      <div className="mb-4 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          共 {sorted.length} 位 UP 主 ·
          {' '}{sorted.reduce((s, u) => s + u.videos.length, 0)} 条视频 ·
          {' '}{sorted.reduce((s, u) => s + u.videos.reduce((v, vid) => v + (vid.news?.length ?? 0), 0), 0)} 条资讯
        </span>
        <span className="font-mono">
          {data.fetchedAt
            ? new Date(data.fetchedAt).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })
            : '未知'}
        </span>
      </div>

      {/* UP 主卡片列表 */}
      <div className="space-y-2">
        {sorted.map(up => (
          <UPCollapseCard key={up.uid} up={up} />
        ))}
      </div>
    </div>
  );
}
