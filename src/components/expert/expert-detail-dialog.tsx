'use client';

/**
 * ExpertDetailDialog — 专家详情弹窗（v1 2026-09-17）
 *
 * 点击"详情"按钮或卡片任意位置触发。
 * 展示：
 *   - 头部：accent 装饰 + icon + 名称 + 分类
 *   - 标签 + 描述
 *   - 完整 systemPrompt（带"复制"按钮）
 *   - 推荐模型
 *   - 评分分布（5 星数）
 *   - 我的评分（5 颗交互星）
 *   - 最近评论
 *
 * 安全：所有 expert 列表 API 已做可见性过滤（isBuiltIn || createdByUserId=me）。
 */

import { useMemo, useState } from 'react';
import * as TablerIcons from '@tabler/icons-react';
import {
  IconX,
  IconCopy,
  IconCheck,
  IconStar,
  IconStarFilled,
  IconExternalLink,
  IconMessage2,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { formatError } from '@/lib/format-error';
import { iconLookup } from '@/lib/ui/icon-lookup';
import type { ExpertListItem } from '@/types/expert';

interface ExpertDetailDialogProps {
  expertId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ExpertDetailDialog({ expertId, open, onClose }: ExpertDetailDialogProps) {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  // 完整数据（含 systemPrompt）
  const detailQ = trpc.expert.getWithPrompt.useQuery(
    { id: expertId ?? '' },
    { enabled: open && !!expertId },
  );

  // 我的评分
  const myRatingQ = trpc.expert.myRating.useQuery(
    { agentId: expertId ?? '' },
    { enabled: open && !!expertId, staleTime: 30_000 },
  );

  // 列表数据（含 avgRating/ratingCount）
  const listQ = trpc.expert.list.useQuery(
    { take: 50 },
    { enabled: open && !!expertId, staleTime: 30_000 },
  );

  // 最近评论
  const commentsQ = trpc.expert.listComments.useQuery(
    { agentId: expertId ?? '', limit: 10 },
    { enabled: open && !!expertId, staleTime: 30_000 },
  );

  const detail = detailQ.data;
  const listItem = useMemo<ExpertListItem | null>(() => {
    return listQ.data?.experts.find((e) => e.id === expertId) ?? null;
  }, [listQ.data, expertId]);

  const [hoverStar, setHoverStar] = useState(0);

  const rateMut = trpc.expert.rate.useMutation({
    onSuccess: (_, variables) => {
      toast.success(`已评分 ${'★'.repeat(Math.max(0, Math.min(5, variables.rating)))}`);
      utils.expert.list.invalidate();
      utils.expert.myRating.invalidate({ agentId: variables.agentId });
      utils.expert.listComments.invalidate({ agentId: variables.agentId });
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const deleteMut = trpc.expert.deleteRating.useMutation({
    onSuccess: () => {
      toast.success('已取消评分');
      utils.expert.list.invalidate();
      if (expertId) utils.expert.myRating.invalidate({ agentId: expertId });
    },
  });

  async function copyPrompt() {
    if (!detail?.systemPrompt) return;
    try {
      await navigator.clipboard.writeText(detail.systemPrompt);
      setCopied(true);
      toast.success('已复制提示词');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败：浏览器权限不足');
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        {detailQ.isLoading ? (
          <div className="flex h-72 items-center justify-center">
            <TablerIcons.IconLoader2 size={28} className="animate-spin text-muted-foreground" />
          </div>
        ) : !detail ? (
          <div className="flex h-72 flex-col items-center justify-center p-8 text-center">
            <IconMessage2 size={32} className="mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">专家不存在或已被删除</p>
          </div>
        ) : (
          <>
            {/* 头部 */}
            <header
              className="relative shrink-0 px-6 pt-6 pb-4"
              style={{ borderTop: `4px solid ${detail.accentColor}` }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${detail.accentColor}1A`, color: detail.accentColor }}
                >
                  {(() => {
                    const Icon = iconLookup(detail.icon);
                    return Icon ? <Icon size={28} stroke={1.6} /> : <TablerIcons.IconSparkles size={28} stroke={1.6} />;
                  })()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline gap-2">
                    <h2 className="truncate text-xl font-semibold">{detail.name}</h2>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {detail.category}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {detail.description}
                  </p>
                  {detail.recommendedModel && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      推荐模型 · {detail.recommendedModel}
                      {detail.recommendedModel && (
                        <a
                          href="#"
                          className="ml-1 inline-flex items-center opacity-60 hover:opacity-100"
                          title="搜索该模型"
                          onClick={(e) => {
                            e.preventDefault();
                            toast.info(`关键词：${detail.recommendedModel}`);
                          }}
                        >
                          <IconExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <IconX size={18} />
                </button>
              </div>
            </header>

            {/* 内容可滚动 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* 标签 */}
              {detail.tags && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {detail.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        #{t}
                      </span>
                    ))}
                </div>
              )}

              {/* 系统提示词 */}
              <section className="mb-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <TablerIcons.IconFileText size={14} className="text-primary" />
                    系统提示词
                  </h3>
                  <button
                    type="button"
                    onClick={copyPrompt}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
                  >
                    {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <pre className="max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {detail.systemPrompt ?? '（暂无）'}
                </pre>
              </section>

              {/* 评分 */}
              <section className="mb-5 rounded-lg border bg-muted/20 p-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold">
                  <IconStarFilled size={13} className="text-amber-500" />
                  评分
                </h3>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* 左侧：聚合评分 */}
                  <div className="text-center">
                    <div className="text-4xl font-bold text-foreground">
                      {Number(listItem?.avgRating ?? 0).toFixed(1)}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      / 5 · {listItem?.ratingCount ?? 0} 人评分
                    </div>
                    <div className="mt-2 flex justify-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span key={s}>
                          {s <= Number(listItem?.avgRating ?? 0) ? (
                            <IconStarFilled size={16} className="text-amber-400" />
                          ) : (
                            <IconStar size={16} className="text-muted-foreground/40" />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 右侧：我的评分 */}
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                      我的评分
                    </div>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => {
                        const myR = myRatingQ.data?.rating ?? 0;
                        const display = hoverStar || myR;
                        return (
                          <button
                            key={s}
                            type="button"
                            disabled={rateMut.isPending}
                            onMouseEnter={() => setHoverStar(s)}
                            onMouseLeave={() => setHoverStar(0)}
                            onClick={() => {
                              if (myR > 0 && myR === s) {
                                deleteMut.mutate({ agentId: detail.id });
                              } else {
                                rateMut.mutate({ agentId: detail.id, rating: s });
                              }
                            }}
                            className="rounded p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
                            title={s === 1 ? '很差' : s === 2 ? '较差' : s === 3 ? '一般' : s === 4 ? '较好' : '很好'}
                          >
                            {s <= display ? (
                              <IconStarFilled size={20} className="text-amber-500" />
                            ) : (
                              <IconStar size={20} className="text-muted-foreground/40" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {myRatingQ.data && (
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        你给了 {myRatingQ.data.rating} 星
                        {myRatingQ.data.comment && ` · ${myRatingQ.data.comment.slice(0, 30)}...`}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* 最近评论 */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
                  <IconMessage2 size={14} className="text-primary" />
                  最近评论（{commentsQ.data?.length ?? 0}）
                </h3>
                {commentsQ.isLoading ? (
                  <div className="py-4 text-center text-[11px] text-muted-foreground">加载中…</div>
                ) : !commentsQ.data || commentsQ.data.length === 0 ? (
                  <div className="rounded-md border border-dashed py-6 text-center text-[11px] text-muted-foreground">
                    暂无评论
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {commentsQ.data.map((c) => (
                      <li key={c.id} className="rounded-md border bg-card px-3 py-2.5">
                        <div className="mb-1 flex items-center gap-2">
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <IconStarFilled
                                key={s}
                                size={11}
                                className={s <= c.rating ? 'text-amber-500' : 'text-muted-foreground/20'}
                              />
                            ))}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {c.userHash} · {new Date(c.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <p className="text-[12px] leading-relaxed text-foreground/90">
                          {c.comment}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* 底部 */}
            <footer className="shrink-0 border-t bg-muted/30 px-6 py-3 text-[11px] text-muted-foreground">
              slug：<code className="font-mono">{detail.slug}</code> · 已被使用{' '}
              {detail.useCount} 次 · 排序 {detail.sortOrder}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
