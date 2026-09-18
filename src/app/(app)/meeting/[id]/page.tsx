'use client';

// RAG-P2-B：会议详情页
// 展示会议主题 / 参与者列表 / 串行执行 / 主持人汇总
//
// 2026-09-17 v2 改造：
//   - 加轮询：会议 status=RUNNING 时每 2s 重新拉 get（避免 Next.js 30s API 超时）
//   - 加进度条：基于 participants 的 transcript 数量计算 X/N
//   - 加运行日志占位：参与者卡片高亮正在发言的

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  IconArrowLeft,
  IconLoader2,
  IconPlayerPlay,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
  IconTrash,
  IconClock,
  IconDownload,
  IconFileText,
  IconFile,
  IconPrinter,
  IconGripVertical,
  IconArrowUp,
  IconArrowDown,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import { formatError } from '@/lib/format-error';
import {
  downloadMeetingExport,
  printMeetingAsPdf,
  type ExportFormat,
} from '@/lib/meeting/export';

interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  model: string;
  speaker?: string;
  timestamp: string;
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [askConfirm, ConfirmNode] = useConfirm();
  const meetingId = params.id;

  const meetingQ = trpc.meeting.get.useQuery(
    { id: meetingId },
    {
      enabled: !!meetingId,
      // 会议运行中每 2s 拉一次（轮询）
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return false;
        return data.status === 'RUNNING' ? 2000 : false;
      },
      refetchIntervalInBackground: true,
    },
  );
  const utils = trpc.useUtils();

  // 启动后 30s 自动调用一次 run（"新建会议 → 跳转"流程）
  const [hasAutoRun, setHasAutoRun] = useState(false);
  useEffect(() => {
    if (hasAutoRun) return;
    if (!meetingQ.data) return;
    if (meetingQ.data.status !== 'ACTIVE') return;
    setHasAutoRun(true);
    runMut.mutate({ id: meetingId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingQ.data?.status]);

  const runMut = trpc.meeting.run.useMutation({
    onSuccess: () => {
      utils.meeting.get.invalidate({ id: meetingId });
      toast.success('会议已执行');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const concludeMut = trpc.meeting.conclude.useMutation({
    onSuccess: () => {
      utils.meeting.get.invalidate({ id: meetingId });
      toast.success('会议纪要已生成');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const deleteMut = trpc.meeting.delete.useMutation({
    onSuccess: () => {
      toast.info('已删除会议');
      router.push('/meeting');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  // v2 重排参与者（2026-09-17）
  const reorderMut = trpc.meeting.reorderParticipants.useMutation({
    onSuccess: () => {
      utils.meeting.get.invalidate({ id: meetingId });
    },
    onError: (e) => toast.error(formatError(e)),
  });

  // Phase 3 (2026-09-17)：多轮执行 mutation
  const runMultiTurnMut = trpc.meeting.runMultiTurn.useMutation({
    onSuccess: () => {
      utils.meeting.get.invalidate({ id: meetingId });
      toast.success('多轮会议已执行');
    },
    onError: (e) => toast.error(formatError(e)),
  });

  /**
   * 上移/下移/拖拽插入（v2 2026-09-17）
   *   dir=up/down：相邻切换
   *   dir=before-id：把当前 id 移到目标 id 之前
   */
  function moveParticipant(participantId: string, dirOrTarget: 'up' | 'down') {
    if (!meeting) return;
    const ids = meeting.participants.map((p) => p.id);
    const idx = ids.indexOf(participantId);
    if (idx === -1) return;
    const target = dirOrTarget === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    reorderMut.mutate({ meetingId, orderedIds: ids });
  }

  /**
   * 把 fromId 移到 toId 之前
   */
  function moveParticipantBefore(fromId: string, toId: string) {
    if (!meeting) return;
    const ids = meeting.participants.map((p) => p.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    // 从数组中取出 fromId，插入到 toId 之前
    const removed = ids.splice(fromIdx, 1)[0];
    const newToIdx = ids.indexOf(toId);
    ids.splice(newToIdx, 0, removed);
    reorderMut.mutate({ meetingId, orderedIds: ids });
  }

  async function handleDelete() {
    const ok = await askConfirm({
      title: '删除会议',
      description: '确认删除该会议？所有发言记录也会一起删除。',
      confirmText: '删除',
      destructive: true,
    });
    if (ok) deleteMut.mutate({ id: meetingId });
  }

  if (meetingQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <IconLoader2 size={14} className="animate-spin" />
        加载中…
      </div>
    );
  }

  if (!meetingQ.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        会议不存在或已被删除
      </div>
    );
  }

  const meeting = meetingQ.data;
  const isRunning = meeting.status === 'RUNNING';
  const isCompleted = meeting.status === 'COMPLETED';
  const hasAnyTranscript = meeting.participants.some((p) => {
    const t = p.transcript as unknown as TranscriptEntry[] | null;
    return t && t.length > 0;
  });

  return (
    <div className="mx-auto h-full max-w-4xl overflow-y-auto px-4 py-6 sm:px-6">
      {/* 顶部 */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push('/meeting')}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft size={12} />
          返回
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <IconTrash size={12} />
          删除
        </button>
      </div>

      {/* 主题卡 */}
      <div className="mb-6 rounded-lg border bg-card px-5 py-4">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          会议主题
        </div>
        <h1 className="text-lg font-semibold leading-relaxed">{meeting.topic}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span>{meeting.participants.length} 位参与者</span>
          <span>·</span>
          <span>{isCompleted ? '已完成' : isRunning ? '进行中' : '草稿'}</span>
          <span>·</span>
          <span>主持人 {meeting.hostModel}</span>
          {/* Phase 3 (2026-09-17)：mode badge */}
          {meeting.mode === 'MULTI' && meeting.maxRounds != null && (
            <>
              <span>·</span>
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                多轮模式 · 最多 {meeting.maxRounds} 轮
              </span>
            </>
          )}
          {meeting.mode === 'SINGLE' && (
            <>
              <span>·</span>
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">单轮模式</span>
            </>
          )}
        </div>

        {/* 进度条（运行中显示） */}
        {isRunning && <ProgressBar meeting={meeting} />}
      </div>

      {/* 操作按钮 */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Phase 3 (2026-09-17)：多轮执行按钮（仅 MULTI 模式显示，或当 mode='SINGLE' 时仍可手动切换） */}
        {(meeting as { mode?: string }).mode === 'MULTI' && (
          <button
            type="button"
            onClick={() => runMultiTurnMut.mutate({ id: meetingId })}
            disabled={isRunning || runMut.isPending || runMultiTurnMut.isPending || concludeMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
          >
            {runMultiTurnMut.isPending ? (
              <>
                <IconLoader2 size={14} className="animate-spin" />
                执行中…
              </>
            ) : (
              <>
                <IconRefresh size={14} />
                多轮执行（{((meeting as { maxRounds?: number }).maxRounds) ?? 2} 轮）
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={() => runMut.mutate({ id: meetingId })}
          disabled={isRunning || runMut.isPending || runMultiTurnMut.isPending || concludeMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {runMut.isPending ? (
            <>
              <IconLoader2 size={14} className="animate-spin" />
              执行中…
            </>
          ) : (
            <>
              {hasAnyTranscript ? <IconRefresh size={14} /> : <IconPlayerPlay size={14} />}
              {hasAnyTranscript ? '重新执行' : '执行会议'}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => concludeMut.mutate({ id: meetingId })}
          disabled={!hasAnyTranscript || concludeMut.isPending || runMut.isPending || runMultiTurnMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          {concludeMut.isPending ? (
            <>
              <IconLoader2 size={14} className="animate-spin" />
              汇总中…
            </>
          ) : (
            <>
              <IconCheck size={14} />
              生成会议纪要
            </>
          )}
        </button>

        {/* 导出按钮（v2 — 2026-09-17）— 有发言即启用 */}
        <ExportMenu
          meeting={meeting}
          disabled={!hasAnyTranscript}
          onAfterAction={(fmt) => toast.success(`已导出为 ${fmt.toUpperCase()}`)}
          onError={(e) => toast.error(e.message)}
        />
      </div>

      {/* 参与者发言（v2 支持拖拽重排 — 2026-09-17） */}
      <div className="mb-6 space-y-3">
        {meeting.participants.map((p, idx) => {
          const transcript = (p.transcript as unknown as TranscriptEntry[]) ?? [];
          const lastEntry = transcript[transcript.length - 1];
          const hasFailed = lastEntry?.content.startsWith('[发言失败]');
          const isMultiTurn = transcript.length > 1;

          return (
            <DraggableParticipantCard
              key={p.id}
              participantId={p.id}
              order={idx + 1}
              isFirst={idx === 0}
              isLast={idx === meeting.participants.length - 1}
              disableDrag={isRunning}
              onMoveUp={() => moveParticipant(p.id, 'up')}
              onMoveDown={() => moveParticipant(p.id, 'down')}
              onDropBefore={(draggedId) => moveParticipantBefore(draggedId, p.id)}
            >
              <MeetingParticipantCard
                role={p.role}
                model={p.model}
                transcript={transcript}
                hasFailed={hasFailed}
                isMultiTurn={isMultiTurn}
              />
            </DraggableParticipantCard>
          );
        })}
      </div>

      {/* 会议纪要 */}
      {meeting.conclusion && (
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-5 py-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
            <IconCheck size={12} />
            会议纪要
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{meeting.conclusion}</div>
        </div>
      )}

      {ConfirmNode()}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// DraggableParticipantCard — 可拖拽排序 + 上下箭头按钮（v2 2026-09-17）
//
// 设计：HTML5 native drag API（零依赖）
//   - 抓握手柄：左侧 IconGripVertical
//   - 备用：上下箭头按钮（移动端或不能拖的浏览器）
//   - 拖动时显示"…放下"暗色提示
//   - 实际重排逻辑由父组件 onMoveUp / onMoveDown 回调
// ───────────────────────────────────────────────────────────────────────────

interface DraggableParticipantCardProps {
  participantId: string;
  order: number;
  isFirst: boolean;
  isLast: boolean;
  disableDrag: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDropBefore?: (draggedId: string) => void;
  children: React.ReactNode;
}

function DraggableParticipantCard({
  participantId,
  order,
  isFirst,
  isLast,
  disableDrag,
  onMoveUp,
  onMoveDown,
  onDropBefore,
  children,
}: DraggableParticipantCardProps) {
  const [dropHover, setDropHover] = useState(false);
  return (
    <div
      draggable={!disableDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData('participant-id', participantId);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnter={() => !disableDrag && setDropHover(true)}
      onDragOver={(e) => {
        if (disableDrag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        if (disableDrag) return;
        e.preventDefault();
        setDropHover(false);
        const draggedId = e.dataTransfer.getData('participant-id');
        if (draggedId && draggedId !== participantId) {
          onDropBefore?.(draggedId);
        }
      }}
      className={[
        'group relative flex items-center gap-1 rounded-lg',
        disableDrag ? 'opacity-60' : 'cursor-grab active:cursor-grabbing',
      ].join(' ')}
    >
      {/* drop 指示线（左侧） */}
      {dropHover && !disableDrag && (
        <div className="pointer-events-none absolute -left-1 top-0 h-full w-0.5 rounded-full bg-primary" />
      )}

      {/* 拖拽手柄 + 顺序 */}
      <div className="flex shrink-0 flex-col items-center gap-1 self-stretch justify-center pl-1 text-muted-foreground/40">
        <span className="font-mono text-[10px]">#{order}</span>
        <IconGripVertical size={12} className="opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      {/* 主卡片 */}
      <div className="min-w-0 flex-1">{children}</div>

      {/* 上下按钮（运行中禁用） */}
      <div className="flex shrink-0 flex-col gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          aria-label="上移"
          disabled={isFirst || disableDrag}
          onClick={onMoveUp}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <IconArrowUp size={11} />
        </button>
        <button
          type="button"
          aria-label="下移"
          disabled={isLast || disableDrag}
          onClick={onMoveDown}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <IconArrowDown size={11} />
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ProgressBar — 运行中进度条（基于 participants.transcript 数量）
// ───────────────────────────────────────────────────────────────────────────

interface ProgressBarMeeting {
  status: string;
  participants: Array<{ transcript: unknown }>;
}

function ProgressBar({ meeting }: { meeting: ProgressBarMeeting }) {
  const total = meeting.participants.length;
  const done = meeting.participants.filter((p) => {
    const t = p.transcript as TranscriptEntry[] | null;
    return t && t.length > 0;
  }).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          <IconClock size={11} />
          正在发言：第 {Math.min(done + 1, total)} / {total} 位
        </span>
        <span className="font-mono text-primary">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// MeetingParticipantCard — 参与者发言卡片（含展开全文 — v2 2026-09-17）
// ───────────────────────────────────────────────────────────────────────────

interface MeetingParticipantCardProps {
  role: string;
  model: string;
  transcript: TranscriptEntry[];
  hasFailed?: boolean;
  isMultiTurn?: boolean;
}

function MeetingParticipantCard({
  role,
  model,
  transcript,
  hasFailed,
  isMultiTurn,
}: MeetingParticipantCardProps) {
  const [expanded, setExpanded] = useState(false);
  const lastEntry = transcript[transcript.length - 1];

  if (transcript.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{role}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {model}
          </span>
        </div>
        <div className="mt-2 text-xs italic text-muted-foreground">尚未发言</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      {/* header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{role}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {model}
          </span>
          {isMultiTurn && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {transcript.length} 轮
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFailed && (
            <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
              <IconAlertCircle size={10} />
              失败
            </span>
          )}
          {transcript.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-primary"
            >
              {expanded ? '收起全文' : `查看 ${transcript.length} 轮发言`}
            </button>
          )}
        </div>
      </div>

      {/* 发言内容 */}
      {expanded && transcript.length > 1 ? (
        <div className="space-y-3 border-l-2 border-primary/20 pl-3">
          {transcript.map((entry, idx) => (
            <div key={idx} className="relative">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  轮次 {idx + 1}
                </span>
                {idx === transcript.length - 1 && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    最新
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{entry.content}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{lastEntry.content}</div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ExportMenu — 会议纪要下拉菜单（v2 — 2026-09-17）
//
// ───────────────────────────────────────────────────────────────────────────

interface ExportMenuMeeting {
  id: string;
  title: string | null;
  topic: string;
  status: string;
  conclusion: string | null;
  hostModel: string;
  createdAt: string | Date;
  participants: Array<{
    id: string;
    role: string;
    model: string;
    transcript: unknown; // Prisma JsonValue：内部 cast
    order: number;
  }>;
}

function ExportMenu({
  meeting,
  disabled,
  onAfterAction,
  onError,
}: {
  meeting: ExportMenuMeeting;
  disabled: boolean;
  onAfterAction: (fmt: ExportFormat | 'pdf') => void;
  onError: (e: Error) => void;
}) {
  const [open, setOpen] = useState(false);

  function handleSelect(fmt: ExportFormat | 'pdf') {
    setOpen(false);
    if (disabled) return;
    try {
      if (fmt === 'pdf') {
        printMeetingAsPdf(meeting);
      } else {
        downloadMeetingExport(meeting, fmt);
      }
      onAfterAction(fmt);
    } catch (e) {
      onError(e as Error);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        title={disabled ? '需要先执行会议才有内容可导出' : '导出会议纪要'}
      >
        <IconDownload size={14} />
        导出
        <span className="text-[10px] opacity-60">▾</span>
      </button>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <button
            type="button"
            aria-label="关闭"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-card py-1 shadow-lg">
            <button
              type="button"
              onClick={() => handleSelect('md')}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <IconFileText size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium">Markdown</div>
                <div className="text-[10px] text-muted-foreground">纯文本 · 可直接贴 Notion</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelect('html')}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <IconFile size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium">HTML</div>
                <div className="text-[10px] text-muted-foreground">浏览器可打开 · 含样式</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelect('doc')}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <IconFileText size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium">Word (.doc)</div>
                <div className="text-[10px] text-muted-foreground">Word / WPS 可直接打开</div>
              </div>
            </button>
            <div className="border-t border-border/50" />
            <button
              type="button"
              onClick={() => handleSelect('pdf')}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <IconPrinter size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium">打印 PDF</div>
                <div className="text-[10px] text-muted-foreground">新窗口 · 浏览器另存为 PDF</div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
