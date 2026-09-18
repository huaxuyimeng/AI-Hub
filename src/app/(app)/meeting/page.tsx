'use client';

// RAG-P2-B：会议列表页
// 列出用户所有会议 + 新建入口 + 最近会议快捷入口（v2 2026-09-17）

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconPlus,
  IconUsersGroup,
  IconChevronRight,
  IconClock,
  IconLoader2,
  IconBolt,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  ACTIVE:    { text: '草稿',     color: 'text-muted-foreground' },
  RUNNING:   { text: '进行中',   color: 'text-warning' },
  COMPLETED: { text: '已完成',   color: 'text-success' },
  FAILED:    { text: '失败',     color: 'text-destructive' },
};

export default function MeetingListPage() {
  const router = useRouter();
  const listQ = trpc.meeting.list.useQuery({ take: 50 });

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-4 py-8 sm:px-6">
      {/* 顶部标题 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <IconUsersGroup size={22} className="text-primary" />
            多模型会议
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            让多个 LLM 扮演不同角色（如产品经理 / 工程师 / 投资人），围绕主题展开讨论
          </p>
        </div>
      </div>

      {/* 新建会议卡片 */}
      <button
        type="button"
        onClick={() => router.push('/meeting/new')}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 px-6 py-8 text-sm font-medium text-primary transition hover:border-primary/60 hover:bg-primary/10"
      >
        <IconPlus size={18} />
        新建会议
      </button>

      {/* 最近会议快捷入口（取最近 4 个，按 updatedAt DESC） */}
      {!listQ.isLoading && listQ.data && listQ.data.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <IconBolt size={13} className="text-amber-500" />
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              最近会议
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[...listQ.data]
              .sort(
                (a, b) =>
                  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
              )
              .slice(0, 4)
              .map((m) => {
                const statusMeta = STATUS_LABEL[m.status] ?? STATUS_LABEL.ACTIVE;
                const timeStr = new Date(m.updatedAt).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <button
                    key={`recent-${m.id}`}
                    type="button"
                    onClick={() => router.push(`/meeting/${m.id}`)}
                    className="group flex flex-col items-start gap-1 rounded-lg border bg-card px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
                  >
                    <span className="line-clamp-1 text-[12px] font-medium">
                      {m.title ?? m.topic.slice(0, 16)}
                    </span>
                    <div className="flex w-full items-center justify-between text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <IconUsersGroup size={9} />
                        {m.participantCount} 人
                      </span>
                      <span className={statusMeta.color}>{statusMeta.text}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                      <IconClock size={9} />
                      {timeStr}
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      )}

      {/* 全部会议 */}
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        全部会议
      </h2>

      {/* 会议列表 */}
      {listQ.isLoading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <IconLoader2 size={14} className="animate-spin" />
          加载中…
        </div>
      )}

      {!listQ.isLoading && listQ.data?.length === 0 && (
        <div className="rounded-lg border bg-card px-6 py-12 text-center">
          <div className="mb-2 text-sm font-medium">还没有会议</div>
          <div className="text-xs text-muted-foreground">
            点击上方按钮，创建你的第一个多模型会议
          </div>
        </div>
      )}

      <div className="space-y-2">
        {listQ.data?.map((m) => {
          const statusMeta = STATUS_LABEL[m.status] ?? STATUS_LABEL.ACTIVE;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => router.push(`/meeting/${m.id}`)}
              className="flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <IconUsersGroup size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{m.title ?? '未命名会议'}</span>
                  <span className={`shrink-0 text-[11px] font-medium ${statusMeta.color}`}>
                    {statusMeta.text}
                  </span>
                </div>
                <div className="line-clamp-1 text-xs text-muted-foreground">{m.topic}</div>
                <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <IconUsersGroup size={10} />
                    {m.participantCount} 位参与者
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <IconClock size={10} />
                    {new Date(m.updatedAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              </div>
              <IconChevronRight size={14} className="shrink-0 self-center text-muted-foreground" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
