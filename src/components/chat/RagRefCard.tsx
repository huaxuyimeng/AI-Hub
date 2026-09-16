'use client';

// RAG-P2-A：聊天消息底部的"参考引用"卡片
// 显示 LLM 在回答时检索到了哪些参考资料（新闻 / 早报 / B 站 / 对话历史）

import { useState } from 'react';
import { IconBook, IconChevronDown, IconChevronRight, IconExternalLink } from '@tabler/icons-react';

export interface Reference {
  kind: 'news' | 'briefing' | 'bilibili' | 'conversation';
  id: string;
  title: string;
  snippet: string;
  timestamp: string;
  url: string | null;
}

const KIND_META: Record<Reference['kind'], { label: string; color: string }> = {
  news:        { label: '新闻',     color: 'text-blue-600 dark:text-blue-400' },
  briefing:    { label: '早报',     color: 'text-purple-600 dark:text-purple-400' },
  bilibili:    { label: 'B 站',     color: 'text-pink-600 dark:text-pink-400' },
  conversation:{ label: '对话历史', color: 'text-amber-600 dark:text-amber-400' },
};

export interface RagRefCardProps {
  references: Reference[];
  /** 检索耗时（ms），仅在 ≥1 条引用时显示 */
  durationMs?: number;
  /** 折叠默认状态（默认 true：默认折叠） */
  defaultCollapsed?: boolean;
}

export function RagRefCard({ references, durationMs, defaultCollapsed = true }: RagRefCardProps) {
  // RAG-P2-B 修复：语义修正——defaultCollapsed=true（默认折叠）→ 初始 open=false（折叠），
  // 修复前用 !defaultCollapsed 导致 defaultCollapsed=true 时反而展开
  const [open, setOpen] = useState(defaultCollapsed);

  // 空引用时不渲染（避免无意义占位）
  if (!references || references.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[11px]">
      {/* 标题栏 */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 py-0.5 text-left transition hover:text-foreground"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <IconBook size={11} />
          <span>
            参考了 <span className="font-semibold text-foreground">{references.length}</span> 条资料
          </span>
          {typeof durationMs === 'number' && (
            <span className="font-mono text-[10px] text-muted-foreground/70">({durationMs}ms)</span>
          )}
        </div>
        {open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
      </button>

      {/* 折叠展开：参考列表 */}
      {open && (
        <ul className="mt-1.5 space-y-1.5 border-t border-border/40 pt-1.5">
          {references.map((r) => {
            const meta = KIND_META[r.kind];
            return (
              <li
                key={r.id}
                className="flex flex-col gap-0.5 rounded-md px-1.5 py-1 transition hover:bg-background"
              >
                {/* 标题行：种类 + 标题 */}
                <div className="flex items-start gap-1.5">
                  <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={r.title}>
                    {r.title}
                  </span>
                  {r.url && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-muted-foreground transition hover:text-foreground"
                      title="打开原文"
                      aria-label="打开原文"
                    >
                      <IconExternalLink size={10} />
                    </a>
                  )}
                </div>
                {/* 摘要 */}
                <div className="line-clamp-2 pl-0.5 text-[10.5px] leading-snug text-muted-foreground">
                  {r.snippet}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
