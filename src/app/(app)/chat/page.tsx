'use client';

// 来源：.cursor/skills/workbench-ui-designer §5.3 + §6.2
// Chat 重写：左侧对话列表（时间分组 + 搜索 + 折叠） + 主区对话流 + 输入框 + 模型选择

import { useState, useEffect, useRef, useMemo } from 'react';
import * as React from 'react';
import {
  IconPlus,
  IconSend,
  IconTrash,
  IconSearch,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconLoader2,
  IconDots,
  IconStar,
  IconStarFilled,
  IconCircleCheck,
  IconCircleX,
  IconAlertCircle,
  IconCheck,
  IconEdit,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { formatError } from '@/lib/format-error';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import { RagRefCard, type Reference } from '@/components/chat/RagRefCard';
import { GroupManager } from '@/components/chat/GroupManager';
import type { TablerIconType } from '@/lib/icon-type';
import { useSession } from 'next-auth/react';
import { getModelAvatar } from '@/lib/ai/models';
import { getUserAvatar } from '@/lib/avatar';
// FULL_ADAPTER_IDS 只用于 UI 过滤（provider badge 颜色映射）
import { FULL_ADAPTER_IDS } from '@/lib/ai/providers';
import { DEFAULT_MODEL } from '@/lib/ai/models';
import { randomBytes } from 'crypto';

/** 从 tRPC models.list 动态获取（ModelDiscoveryService 维护的真实数据源） */
export default function ChatPage() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data: ctxSession } = useSession();
  const ctxSessionName = ctxSession?.user?.name ?? ctxSession?.user?.email ?? 'U';
  const [askConfirm, ConfirmNode] = useConfirm();
  // RAG-P2-B 修复：take 改 200，避免 >50 对话看不到（cursor 翻页留给 P2）
  const listQ = trpc.chat.list.useQuery({ take: 200 });

  // 从 DB 实时获取模型列表（discover 后自动更新）
  const modelsQ = trpc.models.list.useQuery(undefined, { staleTime: 60_000 });

  // 过滤：只展示已完整实现的 Provider（stub provider 不可调用）
  const chatModels = useMemo(() => {
    if (!modelsQ.data) return [];
    return modelsQ.data.models
      .filter((m) => FULL_ADAPTER_IDS.includes(m.provider as typeof FULL_ADAPTER_IDS[number]))
      .map((m) => ({ name: m.externalId, displayName: m.name, provider: m.provider, contextWindow: 128_000 }));
  }, [modelsQ.data]);

  const [activeId, setActiveId] = useState<string | null>(null);
  // RAG-P2-B 修复：byId query 关闭重试 + 用 effect 捕获错误，对话被删时不再卡死面板
  const convQ = trpc.chat.byId.useQuery(
    { id: activeId! },
    { enabled: !!activeId, staleTime: 0, retry: false },
  );
  // tRPC-v11 useQuery 不直接支持 onError option，改用 effect 监听 error
  useEffect(() => {
    if (!convQ.error) return;
    const code = convQ.error.data?.code;
    if (code === 'NOT_FOUND') {
      setActiveId(null);
      toast.info('对话已不存在，已返回对话列表');
    } else {
      toast.error(formatError(convQ.error));
    }
  }, [convQ.error]);
  // 乐观消息 id 集合：用于渲染时给气泡加 opacity-70
  const optimisticIdsRef = useRef<Set<string>>(new Set());

  const [input, setInput] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 控制参数
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
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
    onSuccess: (data) => {
      // invalidate 拉回真实数据后会自然覆盖乐观消息（包括真实的 user 消息 + AI 响应）
      utils.chat.byId.invalidate({ id: activeId! });
      utils.chat.list.invalidate();
      // 保存 RAG 引用（aiMsg.id 用于关联到刚生成的 AI 消息气泡下）
      // RAG-P2-B 修复：加上 conversationId 防跨对话泄漏
      lastRagRef.current = {
        references: (data.rag?.references ?? []) as Reference[],
        durationMs: data.rag?.durationMs ?? 0,
        messageId: data.aiMsg?.id,
        conversationId: activeId ?? undefined,
      };
      setLastRagVersion((v) => v + 1);
    },
    onError: (e, vars) => {
      // RAG-P2-B 修复：send 失败时回滚乐观插入的消息，并清空 optimisticIdsRef 防泄漏
      const convId = vars?.conversationId;
      if (convId) {
        const prev = utils.chat.byId.getData({ id: convId });
        if (prev && optimisticIdsRef.current.size > 0) {
          const removed = prev.messages.length;
          const newMessages = prev.messages.filter((m) => !optimisticIdsRef.current.has(m.id));
          const actuallyRemoved = removed - newMessages.length;
          if (actuallyRemoved > 0) {
            utils.chat.byId.setData({ id: convId }, {
              ...prev,
              messages: newMessages,
              messageCount: Math.max(0, prev.messageCount - actuallyRemoved),
            });
          }
        }
      }
      optimisticIdsRef.current.clear();
      toast.error(formatError(e));
    },
  });

  // RAG-P2：保存最近一次 send 的引用（用于在最后一条 AI 消息下展示）
  // 用 ref 而非 state：避免触发 re-render；用 useEffect setState 同步到 React 树
  // RAG-P2-B 修复：lastRagRef 加 conversationId 防 RAG 卡片跨对话泄漏
  const lastRagRef = useRef<{ references: Reference[]; durationMs: number; messageId?: string; conversationId?: string } | null>(null);
  const [lastRagVersion, setLastRagVersion] = useState(0); // 触发 re-render 的版本号

  const trash = trpc.chat.trash.useMutation({
    onSuccess: () => {
      // RAG-P2-B 修复：先 cancel byId 再 setActiveId(null)，避免删除瞬间主面板闪"还没有对话"
      const droppedId = activeId;
      if (droppedId) {
        utils.chat.byId.cancel({ id: droppedId });
        utils.chat.byId.setData({ id: droppedId }, undefined);
      }
      utils.chat.list.invalidate();
      setActiveId(null);
      toast.info('对话已删除');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const renameMut = trpc.chat.rename.useMutation({
    onSuccess: () => {
      utils.chat.list.invalidate();
      toast.success('已重命名');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const updateStatusMut = trpc.chat.updateStatus.useMutation({
    onSuccess: (_, vars) => {
      utils.chat.list.invalidate();
      toast.success(`已标记为「${vars.status}」`);
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const togglePinMut = trpc.chat.togglePin.useMutation({
    onSuccess: (res) => {
      utils.chat.list.invalidate();
      toast.info(res.isPinned ? '已置顶' : '已取消置顶');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  // RAG-P2-A：拖拽态（哪个对话正在被拖）
  const [draggingConvId, setDraggingConvId] = useState<string | null>(null);

  // RAG-P2-A：移入/移出分组 mutation
  const setGroupMut = trpc.chat.setGroup.useMutation({
    onSuccess: () => {
      utils.chat.listGroups.invalidate();
      utils.chat.list.invalidate();
      toast.success('已更新分组');
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

  // 切换对话后清空乐观 id 集合（避免新对话继承旧标记）
  // RAG-P2-B 修复：同时重置 controlsOpen 和 input，防旧对话状态泄漏到新对话
  useEffect(() => {
    optimisticIdsRef.current.clear();
    lastRagRef.current = null;
    setLastRagVersion((v) => v + 1);
    setControlsOpen(false);
    setInput('');
  }, [activeId]);

  // 对话列表按状态分组（替代原先「按时间分组」，与 Cursor/Trae 风格一致）
  // 顺序：进行中（ACTIVE） → 已完成 → 未完成/中断 → 待办 → 已收藏（在顶部 pin）
  const grouped = useMemo(() => {
    const items = listQ.data?.items ?? [];
    const filtered = searchQ.trim()
      ? items.filter((i) => (i.title ?? '').toLowerCase().includes(searchQ.toLowerCase()))
      : items;

    const groups: Record<string, typeof items> = {
      进行中: [],
      已完成: [],
      未完成: [],
      待办: [],
    };

    // 已收藏项单独置顶（不参与分组，固定显示在「已收藏」组）
    const pinnedItems = filtered.filter((i) => i.isPinned);

    for (const c of filtered) {
      if (c.isPinned) continue; // 已显示在置顶区
      const status = c.status ?? 'ACTIVE';
      if (status === 'COMPLETED') groups['已完成'].push(c);
      else if (status === 'INTERRUPTED') groups['未完成'].push(c);
      else if (status === 'TODO') groups['待办'].push(c);
      else groups['进行中'].push(c); // ACTIVE 视为进行中
    }
    return { pinned: pinnedItems, groups };
  }, [listQ.data, searchQ]);

  // P0 修复：移动端双视图状态管理
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // 移动端：选择对话后自动切换到聊天视图
  useEffect(() => {
    if (activeId && window.innerWidth < 768) {
      setMobileView('chat');
    }
  }, [activeId]);

  // 侧栏宽度（可拖拽调整，200-400px 之间，默认 288px）
  // 持久化到 localStorage（用户偏好跨刷新保留）。
  //
  // SSR/水合安全：
  // - 服务端用 SIDEBAR_DEFAULT（避免 hydration mismatch）
  // - 客户端 mount 后再从 localStorage 读真实宽度，并用 ref 跳过 "初次匹配" 时同步 state
  //   否则 React 18 strict mode + 持久化值会导致 hydration 闪烁警告
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 400;
  const SIDEBAR_DEFAULT = 288;

  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // 只在客户端读 localStorage（修正 #1 + #8）
    const saved = window.localStorage.getItem('chat:sidebarWidth');
    const n = saved ? Number(saved) : SIDEBAR_DEFAULT;
    if (Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) {
      setSidebarWidth(n);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    // 只在 hydrated 之后才写 localStorage（避免服务端写入报错）
    if (hydrated && typeof window !== 'undefined') {
      window.localStorage.setItem('chat:sidebarWidth', String(sidebarWidth));
    }
  }, [sidebarWidth, hydrated]);

  // Hydrate 后（一次性）把真实 width 写到 DOM，
  // 之后拖拽过程也由 onMove 直接 mutate DOM，state flush 只在 onUp
  useEffect(() => {
    if (asideRef.current) {
      asideRef.current.style.width = `${sidebarWidth}px`;
    }
    // 依赖 sidebarWidth 是有意的：hydrate 时需要把持久化的真实值写入 DOM
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // sidebarWidth state 变化时也同步到 DOM（处理"非拖拽改宽"的未来扩展，例如双击 reset）
  useEffect(() => {
    if (!hydrated) return;
    if (isResizingRef.current) return; // 拖拽中由 onMove 直接写 DOM
    if (asideRef.current) {
      asideRef.current.style.width = `${sidebarWidth}px`;
    }
  }, [sidebarWidth, hydrated]);

  // 拖拽状态：是否正在拖 + 动态样式，避免每帧 setState
  const isResizingRef = useRef(false);
  const resizeStartRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 0 });
  // 拖拽过程中的"瞬时宽度"——直接写 DOM 不触发 React render（修正 #2）
  const asideRef = useRef<HTMLElement | null>(null);
  // 记录当前拖拽的 cleanup 函数，卸载时强制清理（修正 #7）
  const cleanupResizeRef = useRef<(() => void) | null>(null);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    // 防止重复触发（双击或浏览器触发两次 mousedown）
    if (isResizingRef.current) return;
    isResizingRef.current = true;
    resizeStartRef.current = { startX: e.clientX, startWidth: sidebarWidth };

    // rAF 节流：每 16ms（约 60fps）最多更新一次 state。
    // 但拖拽中频繁 state 更新会让所有子组件 rerender；改成直接 mutate DOM + rAF flush state
    let pendingWidth: number | null = null;
    let rafId: number | null = null;

    const flushState = () => {
      rafId = null;
      if (pendingWidth != null) {
        setSidebarWidth(pendingWidth);
        pendingWidth = null;
      }
    };

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const dx = ev.clientX - resizeStartRef.current.startX;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartRef.current.startWidth + dx));
      pendingWidth = next;
      // 直接写 DOM，避免 setState 触发整树 re-render
      if (asideRef.current) {
        asideRef.current.style.width = `${next}px`;
      }
      if (rafId == null) rafId = window.requestAnimationFrame(flushState);
    };
    const cleanup = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // 拖完 flush 一次最新值到 state
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (pendingWidth != null) {
        setSidebarWidth(pendingWidth);
        pendingWidth = null;
      }
      cleanupResizeRef.current = null;
    };
    const onUp = () => cleanup();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // 把 cleanup 暴露给卸载 effect
    cleanupResizeRef.current = cleanup;
  };

  // 卸载时如果正在拖，强制清理监听器与副作用（修正 #7 加强版）
  useEffect(() => {
    return () => {
      if (cleanupResizeRef.current) {
        cleanupResizeRef.current();
      }
    };
  }, []);

  // 当前选中的模型 meta
  const currentModel = chatModels.find((m) => m.name === model)
    ?? chatModels[0]
    ?? { name: DEFAULT_MODEL, displayName: DEFAULT_MODEL, provider: 'deepseek', contextWindow: 128_000 };

  // RAG-P2-B 修复：handleNew 防 create.isPending，避免双击空状态按钮建多个
  function handleNew() {
    if (create.isPending) return;
    create.mutate({ title: '新对话' });
  }

  function handleSend() {
    const text = input.trim();
    // RAG-P2-B 修复：同时拦截 create.isPending，建对话瞬间发消息不会发到旧对话
    if (!text || !activeId || send.isPending || create.isPending) return;
    userScrolledUpRef.current = false; // 发消息后重置"已读"状态，下次自动滚到底
    setInput('');

    // 乐观插入用户消息：避免 invalidate 回流前的"被吞"空窗
    const optimisticId = `optimistic-${Date.now()}-${randomBytes(4).toString('hex')}`;
    optimisticIdsRef.current.add(optimisticId);
    utils.chat.byId.setData({ id: activeId }, (prev) => {
      if (!prev) return prev;
      const optimisticMsg = {
        id: optimisticId,
        conversationId: activeId,
        role: 'user' as const,
        content: text,
        createdAt: new Date(),
        deletedAt: null,
        tokenCount: null,
        model: null,
      };
      return {
        ...prev,
        messages: [
          ...prev.messages,
          optimisticMsg as (typeof prev.messages)[number],
        ],
        messageCount: prev.messageCount + 1,
      };
    });

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
      {/* 移动端：条件渲染侧栏或主区；桌面端：始终显示双栏。
          SSR 安全：宽度由 hydrate 后第一帧渲染，初始 SSR 时不输出 width style 避免 hydration mismatch */}
      <aside
        ref={asideRef}
        className={
          'flex shrink-0 flex-col border-r bg-card transition-[width] duration-75 ' +
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

        {/* RAG-P2-A：分组管理（顶部，拖拽目标） */}
        <GroupManager
          activeConv={
            activeId
              ? {
                  id: activeId,
                  groupId: convQ.data?.groupId ?? null,
                }
              : null
          }
          draggingConvId={draggingConvId}
          onDropToGroup={(convId, groupId) => setGroupMut.mutate({ conversationId: convId, groupId })}
        />

        {/* 分组列表 */}
        <div className="flex-1 overflow-y-auto p-1">
          {listQ.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">加载中…</div>}

          {/* 置顶区（收藏的对话） */}
          {grouped.pinned.length > 0 && (
            <Group label="📌 已收藏" count={grouped.pinned.length}>
              {grouped.pinned.map((c) => (
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
                  onRename={(title) => renameMut.mutate({ id: c.id, title })}
                  onTogglePin={() => togglePinMut.mutate({ id: c.id })}
                  onMarkStatus={(status) => updateStatusMut.mutate({ id: c.id, status })}
                  onDragStart={(id) => setDraggingConvId(id)}
                  onDragEnd={() => setDraggingConvId(null)}
                />
              ))}
            </Group>
          )}

          {Object.entries(grouped.groups).map(([label, items]) => (
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
                    onRename={(title) => renameMut.mutate({ id: c.id, title })}
                    onTogglePin={() => togglePinMut.mutate({ id: c.id })}
                    onMarkStatus={(status) => updateStatusMut.mutate({ id: c.id, status })}
                    onDragStart={(id) => setDraggingConvId(id)}
                    onDragEnd={() => setDraggingConvId(null)}
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
          {searchQ && listQ.data && grouped.pinned.length === 0 && Object.values(grouped.groups).every((g) => g.length === 0) && (
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

      {/* 拖拽把手：拖动调整侧栏宽度 */}
      {/* RAG-P2-B 修复：加 tabIndex+onKeyDown 支持键盘操作（ArrowLeft/Right 每次 ±10px） */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onMouseDown={handleResizeMouseDown}
        onKeyDown={(e) => {
          const STEP = 10;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setSidebarWidth((w) => Math.max(SIDEBAR_MIN, w - STEP));
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            setSidebarWidth((w) => Math.min(SIDEBAR_MAX, w + STEP));
          }
        }}
        className="hidden w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30 active:bg-primary/50 focus-visible:bg-primary/30 focus-visible:outline-none md:block"
        title="拖动或按左右方向键调整侧栏宽度"
      />

      {/* Active conversation - 外层 bg-background：暗色主题(oklch 18%) 形成稳定的"面板"边界，
          比 body 背景图略亮一截；浅色主题(oklch 98.5%) 形成柔白卡片感。 */}
      <div className={'flex flex-1 flex-col bg-background ' + (mobileView === 'chat' ? 'flex' : 'hidden md:flex')}>
        <div className="flex h-full min-h-0 flex-col">
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
                    models={chatModels}
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

            {/* 消息流：bg-card 让气泡之间的缝隙也走卡片色，杜绝背景透出。
               容器自身有 mx-auto + max-w-3xl + 圆角 + 内边距，气泡在卡片内透明显示。
               min-h-full + overflow-y-auto 让容器占满 flex 高度，避免出现"半截透明" */}
            {/* 消息流：bg-background 让消息之间"无明显分界"。
               没有 border 干扰，整块一片 background 色 = 18% (暗) / 98.5% (浅)。
               视觉上就是"卡片在大背景里"，没有任何"缝"或"穿透" */}
            <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto bg-background">
              <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
                {!convQ.data && <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>}
                {convQ.data?.messages.length === 0 && (
                  <div className="py-20 text-center">
                    <div className="mb-2 text-base font-medium">发送第一条消息</div>
                    <div className="text-xs text-muted-foreground">
                      当前模型：<span className="font-mono">{currentModel.displayName}</span> ·
                      温度 {temperature.toFixed(2)} · max {maxTokens}
                    </div>
                  </div>
                )}
                {convQ.data?.messages.map((m, idx) => {
                  const isUser = m.role === 'user';
                  // 用户头像：基于 userId 哈希出稳定色；AI 头像：从模型名生成
                  const aiAvatar = m.model ? getModelAvatar(m.model) : null;
                  return (
                    <div
                      key={m.id}
                      className={
                        // 每个消息上下 padding 4，flex 排头像 + 气泡
                        'flex gap-3 px-2 py-4 ' +
                        (isUser ? 'flex-row-reverse pl-10 sm:pl-16' : 'flex-row pr-10 sm:pr-16')
                      }
                    >
                      {/* 头像：圆形 + 实色 HSL 背景 + 白色首字母（用户和 AI 一致的高对比） */}
                      {isUser ? (
                        (() => {
                          const userAvatar = getUserAvatar(ctxSession?.user?.id ?? '', ctxSessionName);
                          return (
                            <div
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white select-none ring-1 ring-black/5 dark:ring-white/10"
                              style={{ backgroundColor: `hsl(${userAvatar.bgHsl})` }}
                              aria-label="用户"
                              title={ctxSessionName}
                            >
                              {userAvatar.letter}
                            </div>
                          );
                        })()
                      ) : (
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white select-none ring-1 ring-black/5 dark:ring-white/10"
                          style={{ backgroundColor: `hsl(${aiAvatar?.bgHsl ?? '220 10% 50%'})` }}
                          aria-label={`模型 ${m.model ?? ''}`}
                          title={m.model ?? ''}
                        >
                          {aiAvatar?.letter ?? '?'}
                        </div>
                      )}
                      {/* 气泡：两个气泡都走 bg-card，在背景容器上"凸起"。
                          暗色主题下 bg-card(22%) 比 父容器 bg-background(18%) 亮一截形成明显边界。 */}
                      <div
                        className={
                          'min-w-0 max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ' +
                          (isUser
                            ? 'rounded-tr-sm bg-primary text-primary-foreground'
                            : 'rounded-tl-sm bg-card border border-border/60') +
                          // 乐观消息半透明，让用户感觉到"正在发送"
                          (optimisticIdsRef.current.has(m.id) ? ' opacity-70' : '')
                        }
                      >
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>
                        {/* AI 消息底部加耗时 + 模型名（轻量，不占位） */}
                        {!isUser && m.tokenCount != null && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="font-mono">{m.model ?? ''}</span>
                            <span>·</span>
                            <span>{m.tokenCount} tokens</span>
                          </div>
                        )}
                        {/* RAG-P2-A：展示本次回答参考的资料（仅与本次 send 的 AI 消息匹配时） */}
                        {/* RAG-P2-B 修复：同时校验 conversationId，防止旧对话的 RAG 卡片泄漏到新对话 */}
                        {!isUser && lastRagRef.current && lastRagRef.current.messageId === m.id && lastRagRef.current.conversationId === convQ.data?.id && (
                          <RagRefCard
                            references={lastRagRef.current.references}
                            durationMs={lastRagRef.current.durationMs}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                {send.isPending && (
                  <div className="flex flex-row gap-3 px-2 pt-4 pr-10 sm:pr-16">
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white select-none ring-1 ring-black/5 dark:ring-white/10"
                      style={{ backgroundColor: `hsl(${getModelAvatar(model).bgHsl})` }}
                    >
                      {getModelAvatar(model).letter}
                    </div>
                    <div className="rounded-xl rounded-tl-sm border border-border/60 bg-card px-3.5 py-2.5 text-sm text-muted-foreground shadow-sm">
                      <span className="mr-1.5 text-[11px] text-foreground/70">{currentModel.displayName}</span>
                      <span className="inline-flex items-center gap-1" aria-label="AI 正在思考">
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
                    className="flex-1 resize-none rounded-md border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
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
                disabled={create.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {create.isPending ? '创建中…' : '开始第一个对话'}
              </button>
            </div>
          </div>
        )}
        </div>
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

/** 单条对话的状态元数据（图标 + 颜色 + tooltip） */
const STATUS_META: Record<string, { icon: React.ElementType; color: string; label: string; pulse?: boolean }> = {
  ACTIVE:       { icon: IconLoader2,    color: 'text-warning',           label: '进行中',   pulse: true },
  COMPLETED:    { icon: IconCircleCheck, color: 'text-success',           label: '已完成' },
  INTERRUPTED: { icon: IconCircleX,     color: 'text-destructive',       label: '未完成/中断' },
  TODO:         { icon: IconAlertCircle, color: 'text-orange-500',        label: '待办' },
};

function ConvItem({
  conv,
  active,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onMarkStatus,
  onDragStart,
  onDragEnd,
}: {
  conv: {
    id: string;
    title: string | null;
    updatedAt: string | Date;
    status: string | null;
    lastModel: string | null;
    messageCount: number;
    isPinned: boolean;
  };
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onMarkStatus: (status: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED' | 'TODO') => void;
  /** RAG-P2-A：拖拽开始（向外传 conv.id），用于跨组拖拽 */
  onDragStart?: (convId: string) => void;
  /** RAG-P2-A：拖拽结束（无论成功与否） */
  onDragEnd?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title ?? '');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // RAG-P2-B 修复：防 commitRename 在同一次编辑会话中被多次调用（例如 blur + Escape 同时）
  const committedRef = useRef(false);

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (editing) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }

  function commitRename() {
    // RAG-P2-B 修复：防止同一次编辑会话中 commit 被多次触发
    if (committedRef.current) return;
    committedRef.current = true;
    const v = editValue.trim();
    if (!v || v === conv.title) {
      setEditing(false);
      setEditValue(conv.title ?? '');
      return;
    }
    onRename(v);
    setEditing(false);
  }

  const statusMeta = STATUS_META[conv.status ?? 'ACTIVE'] ?? STATUS_META.ACTIVE;
  const StatusIcon = statusMeta.icon;
  const avatar = conv.lastModel ? getModelAvatar(conv.lastModel) : { letter: '?', bgHsl: '220 10% 50%' };

  // 截断标题（> 40 字截断）
  const title = conv.title ?? '未命名';

  const meta = (
    <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
      <div
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[8px] font-bold text-white"
        style={{ backgroundColor: `hsl(${avatar.bgHsl})` }}
        title={conv.lastModel ?? ''}
      >
        {avatar.letter}
      </div>
      <span className="truncate font-mono">{conv.lastModel ?? '未开始'}</span>
      <span>·</span>
      <span>{conv.messageCount} 条</span>
    </div>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={editing ? undefined : onSelect}
      onKeyDown={handleKeyDown}
      // RAG-P2-A：原生拖拽支持
      draggable={!!onDragStart}
      onDragStart={(e) => {
        if (!onDragStart) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', conv.id);
        // 半透明反馈
        (e.currentTarget as HTMLDivElement).style.opacity = '0.4';
        onDragStart(conv.id);
      }}
      onDragEnd={(e) => {
        // RAG-P2-B 修复：节点被卸载（对话被删/拖到无效位置）时 e.currentTarget 可能已不在 DOM 中
        if (e.currentTarget.isConnected) {
          (e.currentTarget as HTMLDivElement).style.opacity = '';
        }
        onDragEnd?.();
      }}
      className={
        'group relative flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ' +
        (active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent') +
        (onDragStart ? ' cursor-grab active:cursor-grabbing' : ' cursor-pointer') +
        // 已置顶项左边加橙色竖线（克制、不挤标题）
        (conv.isPinned && !active ? ' before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-warning' : '')
      }
    >
      {/* 状态图标 */}
      <StatusIcon
        size={12}
        className={
          'mt-0.5 shrink-0 ' +
          statusMeta.color +
          (statusMeta.pulse ? ' animate-spin [animation-duration:3s]' : '')
        }
        aria-label={statusMeta.label}
        title={statusMeta.label}
      />
      {/* 主内容：标题 + meta 行 */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
                setEditValue(conv.title ?? '');
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-sm border bg-background px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            maxLength={200}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs">{title}</span>
            {/* RAG-P2-A 修复：去掉标题旁的黄星（避免和 hover 按钮区重复；hover 时的空心/实心已足够提示置顶状态） */}
          </div>
        )}
        {!editing && meta}
      </div>

      {/* Hover 按钮组（默认隐藏） */}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              committedRef.current = false; // RAG-P2-B 修复：每次开始编辑重置防重标志
              setEditing(true);
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="重命名"
            aria-label="重命名"
          >
            <IconEdit size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className={
              'rounded p-1 hover:bg-accent ' +
              (conv.isPinned ? 'text-warning' : 'text-muted-foreground hover:text-warning')
            }
            title={conv.isPinned ? '取消置顶' : '置顶'}
            aria-label={conv.isPinned ? '取消置顶' : '置顶'}
          >
            {conv.isPinned ? <IconStarFilled size={11} /> : <IconStar size={11} />}
          </button>
          {/* ⋯ 菜单按钮 */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="更多"
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <IconDots size={11} />
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border surface-elevated p-1 shadow-lg animate-fade-in"
              >
                <MenuItem
                  icon={IconAlertCircle}
                  label="标记待办"
                  onClick={() => { onMarkStatus('TODO'); setMenuOpen(false); }}
                />
                <MenuItem
                  icon={IconCircleCheck}
                  label="标记已完成"
                  onClick={() => { onMarkStatus('COMPLETED'); setMenuOpen(false); }}
                />
                <MenuItem
                  icon={IconCircleX}
                  label="标记未完成"
                  onClick={() => { onMarkStatus('INTERRUPTED'); setMenuOpen(false); }}
                />
                <MenuItem
                  icon={IconLoader2}
                  label="标记进行中"
                  onClick={() => { onMarkStatus('ACTIVE'); setMenuOpen(false); }}
                />
                <div className="my-1 border-t" />
                <MenuItem
                  icon={IconTrash}
                  label="删除"
                  destructive
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  destructive,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition ' +
        (destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'hover:bg-accent')
      }
    >
      <Icon size={12} />
      <span>{label}</span>
    </button>
  );
}

function ModelPicker({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (v: string) => void;
  models: Array<{ name: string; displayName: string; provider: string; contextWindow: number }>;
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