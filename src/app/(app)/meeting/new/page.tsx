'use client';

// RAG-P2-B：新建会议页（接入专家市场 v1.0 — 2026-09-17）
//
// 流程：
//   1. 用户输入会议主题
//   2. 点「选专家」按钮 → 打开 ExpertSelectorDrawer
//   3. 选好 2~5 位专家 → 自动填充 participants 列表
//   4. 点「创建会议」→ 调 expert.createMeeting → 跳转会议详情

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconArrowLeft,
  IconUsers,
  IconLoader2,
  IconCheck,
  IconTrash,
  IconPlus,
  IconSparkles,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { formatError } from '@/lib/format-error';
import { ExpertSelectorDrawer } from '@/components/expert/expert-selector-drawer';
import { TemplateSelector } from '@/components/meeting/template-selector';
import type { ExpertListItem } from '@/types/expert';

export default function NewMeetingPage() {
  const router = useRouter();
  const toast = useToast();

  const [topic, setTopic] = useState('');
  const [selectedExperts, setSelectedExperts] = useState<ExpertListItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hostModel, setHostModel] = useState('deepseek-flash');
  // v2：当前选中的模板 ID（用于高亮）
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  // Phase 3 (2026-09-17)：多轮模式开关
  const [mode, setMode] = useState<'single' | 'multi'>('single');
  const [maxRounds, setMaxRounds] = useState(2);

  // 加载市场所有专家（用于模板 slug → ExpertListItem 解析）
  const expertsQ = trpc.expert.list.useQuery(
    { take: 50, sort: 'featured' as const },
    { staleTime: 60_000 },
  );

  // 直接从专家市场创建会议（核心 mutation）
  const createMut = trpc.expert.createMeeting.useMutation({
    onSuccess: (m) => {
      toast.success('会议已创建');
      router.push(`/meeting/${m.id}`);
    },
    onError: (e) => toast.error(formatError(e)),
  });

  function removeExpert(id: string) {
    setSelectedExperts((prev) => prev.filter((e) => e.id !== id));
  }

  function handleCreate() {
    if (!topic.trim() || selectedExperts.length < 2) return;
    createMut.mutate({
      topic: topic.trim(),
      hostModel,
      expertIds: selectedExperts.map((e) => e.id),
      // Phase 3 (2026-09-17)：传递 mode + maxRounds
      mode,
      maxRounds,
    });
  }

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-4 py-8 sm:px-6">
      {/* 返回 */}
      <button
        type="button"
        onClick={() => router.push('/meeting')}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft size={12} />
        返回会议列表
      </button>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight">新建会议</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        从专家市场挑选 2-5 位专家，每个专家会用其专属角色和提示词参与讨论
      </p>

      {/* v2 模板选择器（主题上方） */}
      {!expertsQ.isLoading && expertsQ.data && (
        <TemplateSelector
          experts={expertsQ.data.experts}
          selectedTemplateId={selectedTemplateId}
          onSelect={(t, resolved) => {
            setTopic(t);
            setSelectedExperts(resolved);
            setSelectedTemplateId(undefined); // 手动改主题时清空高亮
          }}
        />
      )}

      {/* 主题 */}
      <div className="mb-6">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          会议主题 <span className="text-destructive">*</span>
        </label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例如：是否要做一个面向独立开发者的 AI 知识库产品？"
          rows={3}
          maxLength={2000}
          className="w-full resize-none rounded-md border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <div className="mt-1 text-[10px] text-muted-foreground">{topic.length} / 2000</div>
      </div>

      {/* 参与者 = 选中的专家 */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            参与者 <span className="text-destructive">*</span>（2-5 位专家）
          </label>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary transition-base hover:bg-primary/20"
          >
            {selectedExperts.length === 0 ? (
              <>
                <IconUsers size={12} />
                选专家
              </>
            ) : (
              <>
                <IconPlus size={12} />
                添加/调整专家
              </>
            )}
          </button>
        </div>

        {selectedExperts.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
            <IconUsers size={28} className="mx-auto mb-2 text-muted-foreground/50" stroke={1.4} />
            <p className="text-[13px] text-muted-foreground">还没有选择专家</p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              点上方「选专家」按钮，从专家市场挑选参与者
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedExperts.map((e, idx) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-base hover:border-primary/40"
                style={{ borderLeftWidth: 3, borderLeftColor: e.accentColor }}
              >
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  #{idx + 1}
                </span>
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: e.accentColor }}
                >
                  <span className="text-[13px] font-bold">{e.name.slice(0, 1)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h4 className="truncate text-[13px] font-semibold">{e.name}</h4>
                    <span className="text-[11px] text-muted-foreground">{e.category}</span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {e.recommendedModel ? `推荐模型 ${e.recommendedModel}` : '系统自动选模型'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeExpert(e.id)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="移除"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 主持人模型选择 */}
      <div className="mb-6">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          主持人模型（用于汇总所有专家发言）
        </label>
        <input
          value={hostModel}
          onChange={(e) => setHostModel(e.target.value)}
          placeholder="deepseek-flash"
          className="w-40 rounded-md border bg-card px-3 py-2 font-mono text-[12px] outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {/* Phase 3 (2026-09-17)：执行模式 toggle + 多轮轮数设置 */}
      <div className="mb-6 rounded-lg border bg-card p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          执行模式
        </h3>

        {/* 模式单选 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label
            className={[
              'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
              mode === 'single'
                ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                : 'hover:border-muted-foreground/40',
            ].join(' ')}
          >
            <input
              type="radio"
              name="meeting-mode"
              value="single"
              checked={mode === 'single'}
              onChange={() => setMode('single')}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">单轮模式</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                所有参与者按顺序各说一次，简单快速
              </p>
            </div>
          </label>

          <label
            className={[
              'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
              mode === 'multi'
                ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                : 'hover:border-muted-foreground/40',
            ].join(' ')}
          >
            <input
              type="radio"
              name="meeting-mode"
              value="multi"
              checked={mode === 'multi'}
              onChange={() => setMode('multi')}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">多轮模式</span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  更深入
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                参与者可回应其他人的观点（最多 3 轮）
              </p>
            </div>
          </label>
        </div>

        {/* 多轮模式下显示轮数滑块 */}
        {mode === 'multi' && (
          <div className="mt-4 space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">最大轮数</label>
              <span className="text-sm font-medium">{maxRounds} 轮</span>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">
              每轮每个参与者都会发言。{selectedExperts.length || '?'} 位专家 × {maxRounds} 轮
              ≈ {(selectedExperts.length || 0) * maxRounds + 1} 次 LLM 调用
            </p>
          </div>
        )}
      </div>

      {/* 提交 */}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/meeting')}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={!topic.trim() || selectedExperts.length < 2 || createMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {createMut.isPending ? (
            <>
              <IconLoader2 size={14} className="animate-spin" />
              创建中…
            </>
          ) : (
            <>
              <IconCheck size={14} />
              创建会议（{selectedExperts.length} 位专家）
            </>
          )}
        </button>
      </div>

      {/* Drawer */}
      <ExpertSelectorDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onConfirm={(experts) => setSelectedExperts(experts)}
      />
    </div>
  );
}
