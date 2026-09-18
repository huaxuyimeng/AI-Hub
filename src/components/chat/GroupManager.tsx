'use client';

// RAG-P2-A：侧栏顶部的对话分组（drop target）
// 鼠标按住对话拖进来即可移入；不再用"移入"按钮

import { useState, useRef } from 'react';
import { IconFolder, IconFolderFilled, IconPlus, IconTrash, IconCheck, IconX, IconHandStop, IconFolderOff } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useConfirm } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { formatError } from '@/lib/format-error';

interface GroupManagerProps {
  /** 当前选中的对话（用于判断是否要显示"移出分组"） */
  activeConv?: { id: string; groupId: string | null } | null;
  /** 当前拖拽中的对话 ID */
  draggingConvId?: string | null;
  /** 把对话移入分组（拖拽松手时触发） */
  onDropToGroup?: (conversationId: string, groupId: string | null) => void;
}

export function GroupManager({ activeConv, draggingConvId, onDropToGroup }: GroupManagerProps) {
  const toast = useToast();
  const [askConfirm, ConfirmNode] = useConfirm();
  const utils = trpc.useUtils();
  const groupsQ = trpc.chat.listGroups.useQuery();
  const createMut = trpc.chat.createGroup.useMutation({
    onSuccess: () => utils.chat.listGroups.invalidate(),
    onError: (e) => toast.error(formatError(e)),
  });
  const renameMut = trpc.chat.renameGroup.useMutation({
    onSuccess: () => utils.chat.listGroups.invalidate(),
    onError: (e) => toast.error(formatError(e)),
  });
  const deleteMut = trpc.chat.deleteGroup.useMutation({
    onSuccess: () => {
      utils.chat.listGroups.invalidate();
      utils.chat.list.invalidate();
      toast.info('已删除分组');
    },
    onError: (e) => toast.error(formatError(e)),
  });
  const setGroupMut = trpc.chat.setGroup.useMutation({
    onSuccess: () => {
      utils.chat.listGroups.invalidate();
      utils.chat.list.invalidate();
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const [hoverGroupId, setHoverGroupId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  function startEdit(id: string, current: string) {
    setEditingId(id);
    setEditingName(current);
  }

  function commitEdit() {
    if (!editingId) return;
    const v = editingName.trim();
    if (!v) {
      setEditingId(null);
      return;
    }
    renameMut.mutate({ id: editingId, name: v });
    setEditingId(null);
  }

  async function handleDelete(id: string, name: string) {
    const ok = await askConfirm({
      title: '删除分组',
      description: `确认删除分组「${name}」？组内对话会自动移出分组。`,
      confirmText: '删除',
      destructive: true,
    });
    if (ok) deleteMut.mutate({ id });
  }

  function handleCreate() {
    const v = newName.trim();
    if (!v) {
      setCreating(false);
      return;
    }
    createMut.mutate({ name: v });
    setNewName('');
    setCreating(false);
  }

  function performMove(convId: string, groupId: string | null) {
    if (onDropToGroup) {
      onDropToGroup(convId, groupId);
    } else {
      setGroupMut.mutate({ conversationId: convId, groupId });
    }
  }

  function handleDrop(e: React.DragEvent, groupId: string | null) {
    e.preventDefault();
    setHoverGroupId(null);
    const convId = e.dataTransfer.getData('text/plain');
    if (!convId) return;
    performMove(convId, groupId);
  }

  const isDragging = !!draggingConvId;
  const showUngroupZone = isDragging; // 只有拖拽时才显示"移到此处移出分组"
  const showMoveOutButton = !isDragging && activeConv?.groupId; // 没拖拽 且 当前对话在某个组里 → 显示移出按钮

  return (
    <div className="border-b px-2 py-2">
      {/* 头部 */}
      <div className="mb-1.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
          <IconFolder size={12} />
          <span>分组</span>
        </div>
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="新建分组"
          >
            <IconPlus size={11} />
            <span>新建</span>
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCreate}
              className="rounded p-1 text-success hover:bg-success/10"
              title="确认"
            >
              <IconCheck size={12} />
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(''); }}
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              title="取消"
            >
              <IconX size={12} />
            </button>
          </div>
        )}
      </div>

      {/* 新建输入框 */}
      {creating && (
        <div className="mb-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              else if (e.key === 'Escape') { setCreating(false); setNewName(''); }
            }}
            placeholder="组名（如 AI Coding 项目）"
            maxLength={60}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      )}

      {/* 拖拽时的顶部提示 */}
      {isDragging && (
        <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] text-primary">
          <IconHandStop size={11} />
          <span>按住对话拖到下方分组</span>
        </div>
      )}

      {/* 分组列表 */}
      <div className="space-y-0.5">
        {groupsQ.isLoading && (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">加载中…</div>
        )}
        {!groupsQ.isLoading && groupsQ.data?.length === 0 && !creating && (
          <div className="rounded-md border border-dashed border-border/60 px-3 py-3 text-center text-[11px] text-muted-foreground">
            暂无分组 · 点 + 新建
          </div>
        )}
        {groupsQ.data?.map((g) => {
          const isHover = hoverGroupId === g.id;
          const isEditing = editingId === g.id;
          const isActive = activeConv?.groupId === g.id;
          return (
            <div
              key={g.id}
              onDragOver={(e) => {
                if (!draggingConvId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setHoverGroupId(g.id);
              }}
              onDragLeave={() => {
                if (hoverGroupId === g.id) setHoverGroupId(null);
              }}
              onDrop={(e) => handleDrop(e, g.id)}
              className={
                'group/item flex items-center gap-1.5 rounded-md px-2 py-1.5 transition ' +
                (isHover
                  ? 'bg-primary/15 ring-2 ring-primary/40'
                  : isActive
                    ? 'bg-primary/5 ring-1 ring-primary/20'
                    : 'hover:bg-accent/50')
              }
              title={draggingConvId ? '松手移入此分组' : g.name}
            >
              <span className="shrink-0">
                {isHover ? (
                  <IconFolderFilled size={13} className="text-primary" />
                ) : (
                  <IconFolder size={13} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                )}
              </span>
              {isEditing ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded-sm border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  maxLength={60}
                />
              ) : (
                <span
                  className="min-w-0 flex-1 cursor-text truncate text-xs"
                  onClick={() => startEdit(g.id, g.name)}
                  title="点击重命名"
                >
                  {g.name}
                </span>
              )}
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
                {g.conversationCount}
              </span>
              {!isEditing && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(g.id, g.name); }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover/item:opacity-100"
                  title="删除分组"
                  aria-label={`删除分组 ${g.name}`}
                >
                  <IconTrash size={10} />
                </button>
              )}
            </div>
          );
        })}

        {/* 拖拽中：显示"移出分组"drop zone */}
        {showUngroupZone && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setHoverGroupId('__ungrouped__');
            }}
            onDragLeave={() => {
              if (hoverGroupId === '__ungrouped__') setHoverGroupId(null);
            }}
            onDrop={(e) => handleDrop(e, null)}
            className={
              'flex items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-2 py-2 text-[11px] transition ' +
              (hoverGroupId === '__ungrouped__'
                ? 'border-destructive/60 bg-destructive/10 text-destructive'
                : 'border-border/60 text-muted-foreground')
            }
          >
            <IconFolderOff size={12} />
            <span>拖到此处移出分组</span>
          </div>
        )}

        {/* 未拖拽 且 当前对话有 groupId：显示"移出分组"按钮 */}
        {showMoveOutButton && activeConv && (
          <button
            type="button"
            onClick={() => performMove(activeConv.id, null)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground transition hover:border-destructive/40 hover:text-destructive"
            title="把当前对话移出分组（恢复隔离模式）"
          >
            <IconFolderOff size={11} />
            <span>移出分组</span>
          </button>
        )}
      </div>
      {ConfirmNode()}
    </div>
  );
}
