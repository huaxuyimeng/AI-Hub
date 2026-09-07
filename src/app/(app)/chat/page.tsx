'use client';

// 来源：.cursor/skills/workbench-ui-designer §5.3 + §6.2
// Chat 重写：左侧对话列表（时间分组 + 搜索 + 折叠） + 主区对话流 + 输入框 + 模型选择

import { useState, useEffect, useRef, useMemo } from 'react';
import * as React from 'react';
import {
  IconPlus,
  IconSend,
  IconTrash,
  IconUser,
  IconRobot,
  IconSearch,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconSettings,
  IconLoader2,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { formatError } from '@/lib/format-error';
import { useToast } from '@/components/toast';
import { useConfirm, ConfirmDialog } from '@/components/confirm-dialog';
import type { TablerIconType } from '@/lib/icon-type';

type ModelEntry = {
  name: string;
  displayName: string;
  provider: string;
  contextWindow: number;
};

const FALLBACK_MODELS: ModelEntry[] = [
  { name: 'deepseek-chat', displayName: 'DeepSeek V3', provider: 'deepseek', contextWindow: 64000 },
  { name: 'deepseek-reasoner', displayName: 'DeepSeek R1', provider: 'deepseek', contextWindow: 64000 },
  { name: 'moonshot-v1-8k', displayName: 'Kimi V1 8K', provider: 'kimi', contextWindow: 8000 },
  { name: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200000 },
];

export default function ChatPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [askConfirm, ConfirmNode] = useConfirm();
  const listQ = trpc.chat.list.useQuery({ take: 50 });

  const [activeId, setActiveId] = useState<string | null>(null);
  const convQ = trpc.chat.byId.useQuery({ id: activeId! }, { enabled: !!activeId, staleTime: 0 });

  const [input, setInput] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 控制参数
  const [model, setModel] = useState<string>(FALLBACK_MODELS[0].name);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [controlsOpen, setControlsOpen] = useState(false);

  const create = trpc.chat.create.useMutation({
    onSuccess: (c) => {
      utils.chat.list.invalidate();
      setActiveId(c.id);
    },
  });

  const send = trpc.chat.sendMessage.useMutation({
    onSuccess: () => {
      utils.chat.byId.invalidate({ id: activeId! });
      utils.chat.list.invalidate();
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const trash = trpc.chat.trash.useMutation({
    onSuccess: () => {
      utils.chat.list.invalidate();
      setActiveId(null);
      toast.info('对话已删除');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  // I-05 修复：用 ref 记录是否已设置过初始 activeId，避免 listQ.data 引用变化导致无限循环
  const hasSetInitialRef = useRef(false);
  // 拆出变量（lint：避免 useEffect 依赖项里写复杂表达式）
  const firstConvId = listQ.data?.items[0]?.id;
  const convItems = listQ.data?.items;
  useEffect(() => {
    if (hasSetInitialRef.current) return;
    if (!activeId && firstConvId) {
      setActiveId(firstConvId);
      hasSetInitialRef.current = true;
    }
  }, [activeId, firstConvId, convItems]);

  // H-12+H-13 修复：追踪用户是否主动滚到上方读旧消息，避免新消息打断阅读
  const userScrolledUpRef = useRef(false);
  const BOTTOM_THRESHOLD_PX = 120; // 距底部超过此值视为"在读旧消息"

  // 监听用户手动滚动
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distFromBottom > BOTTOM_THRESHOLD_PX;
  };

  // 新消息到达时自动滚到底（仅当用户当前在底部区域时）
  // H-12 修复：只在有 activeId + 有消息时触发，避免空状态滚动到 top
  // H-13 修复：检测用户是否在读旧消息，尊重阅读位置
  useEffect(() => {
    if (!activeId || (convQ.data?.messages.length ?? 0) === 0) return;
    if (userScrolledUpRef.current) return; // 用户在看旧消息，不打断
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [convQ.data?.messages.length, activeId]);

  // 对话列表按时间分组
  const grouped = useMemo(() => {
    const items = listQ.data?.items ?? [];
    const filtered = searchQ.trim()
      ? items.filter((i) => i.title?.toLowerCase().includes(searchQ.toLowerCase()))
      : items;
    const now = Date.now();
    const DAY = 86_400_000;
    const groups: Record<string, typeof items> = {
      今天: [],
      昨天: [],
      本周: [],
      更早: [],
    };
    for (const c of filtered) {
      const t = new Date(c.updatedAt).getTime();
      const days = Math.floor((now - t) / DAY);
      if (days <= 0) groups.今天.push(c);
      else if (days === 1) groups.昨天.push(c);
      else if (days <= 7) groups.本周.push(c);
      else groups.更早.push(c);
    }
    return groups;
  }, [listQ.data, searchQ]);

  // P0 修复：移动端双视图状态管理
  const [mobileView, setMobileView] = React.useState<'list' | 'chat'>('list');

  // 移动端：选择对话后自动切换到聊天视图
  React.useEffect(() => {
    if (activeId && window.innerWidth < 768) {
      setMobileView('chat');
    }
  }, [activeId]);

  // 当前选中的模型 meta
  const currentModel = FALLBACK_MODELS.find((m) => m.name === model) ?? FALLBACK_MODELS[0];

  function handleNew() {
    create.mutate({ title: '新对话' });
  }

  function handleSend() {
    const text = input.trim();
    if (!text || !activeId || send.isPending) return;
    userScrolledUpRef.current = false; // 发消息后重置"已读"状态，下次自动滚到底
    setInput('');
    send.mutate({
      conversationId: activeId,
      content: text,
      model,
      temperature,
      maxTokens,
    });
  }

  return (
    <div className="flex h-full">
      {/* 移动端：条件渲染侧栏或主区；桌面端：始终显示双栏 */}
      <aside
        className={
          'flex w-72 shrink-0 flex-col border-r bg-card transition-transform ' +
          'md:flex ' +
          (mobileView === 'list' ? 'flex' : 'hidden')
        }
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b px-3">
          <div className="text-sm font-semibold">对话</div>
          <button
            type="button"
            onClick={handleNew}
            disabled={create.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            <IconLoader2 size={12} className={create.isPending ? 'animate-spin' : ''} />
            {create.isPending ? '创建中…' : '新建'}
          </button>
        </div>

        {/* 搜索 */}
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5">
            <IconSearch size={12} className="text-muted-foreground" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="搜索对话…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* 分组列表 */}
        <div className="flex-1 overflow-y-auto p-1">
          {listQ.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">加载中…</div>}
          {Object.entries(grouped).map(([label, items]) => (
            items.length === 0 ? null : (
              <Group key={label} label={label} count={items.length}>
                {items.map((c) => (
                  <ConvItem
                    key={c.id}
                    conv={c}
                    active={c.id === activeId}
                    onSelect={() => setActiveId(c.id)}
                    onDelete={async () => {
                      const title = c.title ?? '未命名';
                      const ok = await askConfirm({
                        title: '删除对话',
                        description: `确认删除「${title}」？此操作不可恢复。`,
                        confirmText: '删除',
                        destructive: true,
                      });
                      if (ok) trash.mutate({ id: c.id });
                    }}
                  />
                ))}
              </Group>
            )
          ))}
          {!listQ.isLoading && listQ.data?.items.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              没有对话 · 点 + 创建
            </div>
          )}
          {searchQ && listQ.data && Object.values(grouped).every((g) => g.length === 0) && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              没有匹配的对话
            </div>
          )}
          {/* DS-06: 刷新当前页（cursor 滚动到 P5 再升级 useInfiniteQuery） */}
          <button
            type="button"
            onClick={() => listQ.refetch()}
            disabled={listQ.isFetching}
            className="mt-1 w-full rounded-md px-2.5 py-1.5 text-center text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {listQ.isFetching ? '刷新中…' : '刷新当前页'}
          </button>
        </div>
      </aside>

      {/* Active conversation */}
      <div className={'flex flex-1 flex-col bg-background ' + (mobileView === 'chat' ? 'flex' : 'hidden md:flex')}>
        {activeId ? (
          <>
            {/* Top bar with model selector + 移动端返回按钮 */}
            <div className="flex h-14 items-center justify-between border-b bg-card px-4">
              <div className="flex min-w-0 items-center gap-2">
                {/* 移动端返回按钮 */}
                <button
                  type="button"
                  onClick={() => setMobileView('list')}
                  className="md:hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="返回对话列表"
                >
                  <IconChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setControlsOpen(!controlsOpen)}
                  className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs transition hover:bg-accent"
                >
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {currentModel.provider}
                  </span>
                  <span className="font-medium">{currentModel.displayName}</span>
                  {controlsOpen ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {(convQ.data?.messages.length ?? 0)} 条消息
              </div>
            </div>

            {/* 控制面板（折叠） */}
            {controlsOpen && (
              <div className="border-b bg-muted/30 px-4 py-3 animate-slide-down">
                <div className="mx-auto grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-3">
                  <ModelPicker
                    value={model}
                    onChange={setModel}
                    models={FALLBACK_MODELS}
                  />
                  <SliderField
                    label="温度"
                    value={temperature}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={setTemperature}
                    format={(v) => v.toFixed(2)}
                    hint="0=精确 2=发散"
                  />
                  <SliderField
                    label="Max tokens"
                    value={maxTokens}
                    min={256}
                    max={8192}
                    step={256}
                    onChange={setMaxTokens}
                    format={(v) => String(v)}
                    hint={`上限 ${(currentModel.contextWindow / 1000).toFixed(0)}k`}
                  />
                </div>
              </div>
            )}

            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-3xl">
                {!convQ.data && <div className="text-sm text-muted-foreground">加载中…</div>}
                {convQ.data?.messages.length === 0 && (
                  <div className="py-20 text-center">
                    <div className="mb-2 text-base font-medium">发送第一条消息</div>
                    <div className="text-xs text-muted-foreground">
                      当前模型：<span className="font-mono">{currentModel.displayName}</span> ·
                      温度 {temperature.toFixed(2)} · max {maxTokens}
                    </div>
                  </div>
                )}
                {convQ.data?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      'mb-4 flex gap-3 ' + (m.role === 'user' ? 'flex-row-reverse' : 'flex-row')
                    }
                  >
                    <div
                      className={
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground ' +
                        (m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')
                      }
                    >
                      {m.role === 'user' ? <IconUser size={14} /> : <IconRobot size={14} className="text-primary" />}
                    </div>
                    <div
                      className={
                        'max-w-2xl rounded-lg px-4 py-2.5 text-sm leading-relaxed ' +
                        (m.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'border bg-card')
                      }
                    >
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {m.tokenCount != null && (
                        <div className="mt-1 text-[10px] opacity-60">
                          {m.model && <span className="font-mono mr-2">{m.model}</span>}
                          tokens: {m.tokenCount}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {send.isPending && (
                  <div className="mb-4 flex flex-row gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                      <IconRobot size={14} />
                    </div>
                    <div className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t bg-card px-4 py-4">
              <div className="mx-auto max-w-3xl">
                <div className="flex gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="输入消息… (Enter 发送 · Shift+Enter 换行)"
                    rows={2}
                    className="flex-1 resize-none rounded-md border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!input.trim() || send.isPending}
                    className="inline-flex items-center gap-1 self-end rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                  >
                    <IconLoader2 size={14} className={send.isPending ? 'animate-spin' : ''} />
                    发送
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-lg font-medium">还没有对话</div>
              <button
                type="button"
                onClick={handleNew}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                开始第一个对话
              </button>
            </div>
          </div>
        )}
      </div>
      {ConfirmNode()}
    </div>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ConvItem({
  conv,
  active,
  onSelect,
  onDelete,
}: {
  conv: { id: string; title: string | null; updatedAt: string | Date };
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  // P0-修复：外层不能是 <button>（嵌套 button 触发 hydration error），
  // 改为 div + role="button" + 键盘事件，保持可访问性。
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={
        'group flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ' +
        (active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-foreground/80 hover:bg-accent')
      }
    >
      <span className="min-w-0 flex-1 truncate">{conv.title ?? '未命名'}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="ml-1 rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive"
        title="删除"
        aria-label={`删除对话 ${conv.title ?? '未命名'}`}
      >
        <IconTrash size={11} />
      </button>
    </div>
  );
}

function ModelPicker({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (v: string) => void;
  models: ModelEntry[];
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">模型</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/30"
      >
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.displayName} ({m.provider})
          </option>
        ))}
      </select>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}