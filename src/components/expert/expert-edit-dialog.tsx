'use client';

/**
 * ExpertEditDialog — 专家编辑弹窗
 *
 * 用途：编辑用户自建专家（isBuiltIn=false）的元数据
 * 二次用途：复制专家时填写新名字（duplicate flow）
 *
 * 来源：腾讯元宝 WorkBuddy 角色设定 + AIHub Workbench 风格
 *
 * 字段：
 *   - name              必填，1~60 字
 *   - description       0~500 字
 *   - systemPrompt      0~4000 字（核心字段，决定专家行为）
 *   - recommendedModel  模型 externalId（可选）
 *   - category          分类（可选，10 个预设）
 *   - accentColor       HEX 颜色 picker（默认 #6366F1）
 *
 * 交互：
 *   - ESC 关闭
 *   - 实时校验（disabled submit）
 *   - 颜色变化时右侧预览卡片实时更新
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as TablerIcons from '@tabler/icons-react';
import {
  IconLoader2,
  IconCheck,
  IconWand,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { formatError } from '@/lib/format-error';
import type { ExpertListItem } from '@/types/expert';

const PRESET_CATEGORIES = [
  '通用', '产品经理', '工程师', '投资人', '法律', '营销',
  'HR', '数据', '设计', '安全', '财务', '运营', '公关',
  '研究', '内容', '翻译', '教育', '健康',
];

const PRESET_COLORS = [
  '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#14B8A6', '#3B82F6', '#F472B6', '#0EA5E9',
];

interface ExpertEditDialogProps {
  open: boolean;
  /** 正在编辑的专家（新建时为 null） */
  expert: ExpertListItem | null;
  /** 复制模式下，从源专家复制 systemPrompt（没有 id） */
  duplicatingFrom?: { systemPrompt: string; name: string } | null;
  onClose: () => void;
  /** 任意成功操作（保存/删除）后回调（用于父组件刷新列表） */
  onAfterAction?: () => void;
}

interface FormState {
  name: string;
  description: string;
  systemPrompt: string;
  recommendedModel: string;
  category: string;
  accentColor: string;
  tags: string;
  scenarios: string;
}

function IconLookup(name: string): React.ComponentType<{ size?: number; stroke?: number }> | undefined {
  const map = TablerIcons as unknown as Record<string, React.ComponentType<{ size?: number; stroke?: number }>>;
  return map[name];
}

export function ExpertEditDialog({
  open,
  expert,
  duplicatingFrom,
  onClose,
  onAfterAction,
}: ExpertEditDialogProps) {
  const toast = useToast();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  // 表单状态
  const [form, setForm] = useState<FormState>({
    name: '',
    description: '',
    systemPrompt: '',
    recommendedModel: '',
    category: '通用',
    accentColor: '#6366F1',
    tags: '',
    scenarios: '',
  });

  // 初始化表单（编辑 / 复制 / 新建三种场景）
  useEffect(() => {
    if (!open) return;
    if (expert) {
      // 编辑现有专家：先填表（不含 systemPrompt）；后续 detailQ 拉到后覆盖
      setForm({
        name: expert.name,
        description: expert.description,
        systemPrompt: '',
        recommendedModel: expert.recommendedModel ?? '',
        category: expert.category,
        accentColor: expert.accentColor,
        tags: expert.tags,
        scenarios: expert.scenarios,
      });
    } else if (duplicatingFrom) {
      // 复制场景
      setForm({
        name: `${duplicatingFrom.name}（副本）`,
        description: '',
        systemPrompt: duplicatingFrom.systemPrompt,
        recommendedModel: '',
        category: '通用',
        accentColor: '#6366F1',
        tags: '',
        scenarios: '',
      });
    } else {
      // 新建（从零）
      setForm({
        name: '',
        description: '',
        systemPrompt: '',
        recommendedModel: '',
        category: '通用',
        accentColor: '#6366F1',
        tags: '',
        scenarios: '',
      });
    }
  }, [open, expert?.id, duplicatingFrom]);

  // mount portal
  useEffect(() => { setMounted(true); }, []);

  // 编辑模式：拉 systemPrompt（用 getWithPrompt）
  const detailQ = trpc.expert.getWithPrompt.useQuery(
    { id: expert?.id ?? '' },
    { enabled: open && !!expert, staleTime: 60_000 },
  );

  // 用 effect 同步数据到表单（React Query 不支持 onSuccess 在 options 里）
  useEffect(() => {
    if (!open) return;
    if (!detailQ.data) return;
    if (!expert) return;
    // 仅在表单为空（首次打开）或 slug 匹配时同步，避免覆盖用户输入
    setForm({
      name: detailQ.data.name,
      description: detailQ.data.description,
      systemPrompt: detailQ.data.systemPrompt,
      recommendedModel: detailQ.data.recommendedModel ?? '',
      category: detailQ.data.category,
      accentColor: detailQ.data.accentColor,
      tags: detailQ.data.tags,
      scenarios: detailQ.data.scenarios,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailQ.data?.id, open, expert?.id]);

  // 删除 mutation
  const deleteMut = trpc.expert.delete.useMutation({
    onSuccess: () => {
      toast.success('专家已删除');
      onAfterAction?.();
      onClose();
    },
    onError: (e) => toast.error(formatError(e)),
  });

  // 提交 mutation（区分 update / duplicate / create）
  const updateMut = trpc.expert.update.useMutation({
    onSuccess: () => {
      toast.success('已保存');
      onAfterAction?.();
      onClose();
    },
    onError: (e) => toast.error(formatError(e)),
  });

  const createMut = trpc.expert.create.useMutation({
    onSuccess: () => {
      toast.success('已创建');
      onAfterAction?.();
      onClose();
    },
    onError: (e) => toast.error(formatError(e)),
  });

  function handleSubmit() {
    if (!form.name.trim() || form.name.length > 60) {
      toast.warning('名称必填，1~60 字');
      return;
    }
    if (!form.description.trim()) {
      toast.warning('请填写角色描述');
      return;
    }
    if (!form.systemPrompt.trim() || form.systemPrompt.trim().length < 20) {
      toast.warning('角色设定至少 20 字（决定专家行为）');
      return;
    }
    if (form.systemPrompt.length > 4000) {
      toast.warning('角色设定最多 4000 字');
      return;
    }

    if (expert) {
      // 更新现有专家（仅非系统内置）
      updateMut.mutate({
        id: expert.id,
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
        recommendedModel: form.recommendedModel.trim() || undefined,
        category: form.category,
        accentColor: form.accentColor,
      });
    } else if (duplicatingFrom) {
      // duplicate 模式：duplicatingFrom 不含源 id（目前没用上）
      // 暂时简化：不通过本表单 duplicate，改走市场页面的「复制」按钮
      toast.warning('请先在市场页点击「复制」按钮，再来编辑');
    } else {
      // 新建（从零）
      createMut.mutate({
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
        recommendedModel: form.recommendedModel.trim() || undefined,
        category: form.category,
        accentColor: form.accentColor,
        tags: form.tags.trim() || undefined,
        scenarios: form.scenarios.trim() || undefined,
      });
    }
  }

  function handleDelete() {
    if (!expert) return;
    if (!confirm(`确定删除「${expert.name}」？此操作不可撤销。`)) return;
    deleteMut.mutate({ id: expert.id });
  }

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isEditing = !!expert;
  const isCreating = !expert && !duplicatingFrom;
  const submitting = updateMut.isPending || createMut.isPending;

  // 实时预览卡片
  const previewIconName = expert?.icon ?? 'IconSparkles';
  const PreviewIcon = IconLookup(previewIconName);

  if (!open || !mounted) return null;

  return (
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        className="gpu fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        style={{ animation: 'analytics-fadeIn 140ms ease-out both' }}
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          className="gpu flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border surface-elevated shadow-2xl"
          style={{
            animation: 'analytics-modalIn 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header className="flex shrink-0 items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: form.accentColor }}
              >
                <IconWand size={16} />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold leading-tight">
                  {isEditing ? '编辑专家' : duplicatingFrom ? '复制专家' : '新建专家'}
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {isEditing
                    ? '修改名称、描述、模型、分类与配色'
                    : isCreating
                      ? '从零开始创建一个全新的专家'
                      : '基于预设专家创建你的私有副本'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ESC 关闭
            </button>
          </header>

          {/* Body — 左右分栏：表单 + 预览 */}
          <div className="flex flex-1 min-h-0">
            {/* 左：表单 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Name */}
              <Field label="名称" required>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例：法务顾问"
                  maxLength={60}
                  className="w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                />
                <Hint>{form.name.length}/60</Hint>
              </Field>

              {/* Category + Model */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="分类">
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  >
                    {PRESET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="推荐模型">
                  <input
                    value={form.recommendedModel}
                    onChange={(e) => setForm({ ...form, recommendedModel: e.target.value })}
                    placeholder="gpt-4o / claude-4 / ..."
                    className="w-full rounded-md border bg-card px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </Field>
              </div>

              {/* Description */}
              <Field label="角色描述">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="一句话说清楚这位专家擅长什么、适合什么场景"
                  maxLength={500}
                  rows={2}
                  className="w-full resize-none rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                />
                <Hint>{form.description.length}/500</Hint>
              </Field>

              {/* System Prompt */}
              <Field label="角色设定（System Prompt）" hint="决定专家在会议中的发言风格">
                <textarea
                  value={form.systemPrompt}
                  onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                  placeholder="例如：你是一位资深法务顾问，擅长从法律合规、合同风险角度分析问题。每次回答 200-400 字。"
                  maxLength={4000}
                  rows={5}
                  disabled={isEditing && !detailQ.data}
                  className="w-full resize-none rounded-md border bg-card px-3 py-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <Hint>{form.systemPrompt.length}/4000</Hint>
              </Field>

              {/* Accent Color */}
              <Field label="主题色">
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, accentColor: c })}
                      className={[
                        'h-8 w-8 rounded-md border-2 transition-base',
                        form.accentColor === c ? 'border-foreground scale-110' : 'border-transparent',
                      ].join(' ')}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </Field>

              {/* Tags + Scenarios（新建/编辑场景都展示） */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="标签（逗号分隔）">
                  <input
                    value={form.tags}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    placeholder="例：投资,商业,财务"
                    maxLength={200}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </Field>
                <Field label="适用场景（逗号分隔）">
                  <input
                    value={form.scenarios}
                    onChange={(e) => setForm({ ...form, scenarios: e.target.value })}
                    placeholder="例：商业模式评估,投资决策"
                    maxLength={500}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  />
                </Field>
              </div>
            </div>

            {/* 右：实时预览 */}
            <aside className="hidden w-[280px] shrink-0 border-l bg-muted/20 px-5 py-4 lg:block">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                实时预览
              </div>
              <div
                className="overflow-hidden rounded-xl border bg-card"
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: form.accentColor,
                }}
              >
                <div className="flex gap-2.5 p-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: `${form.accentColor}1A`,
                      color: form.accentColor,
                    }}
                  >
                    {PreviewIcon ? <PreviewIcon size={20} stroke={1.6} /> : <TablerIcons.IconSparkles size={20} stroke={1.6} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13px] font-semibold">
                      {form.name || '未命名专家'}
                    </h3>
                    <p className="text-[10px] text-muted-foreground">{form.category}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {form.description || '暂无描述'}
                    </p>
                  </div>
                </div>
                <div className="border-t bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
                  {form.recommendedModel ? `推荐模型 ${form.recommendedModel}` : '模型：跟随系统'}
                </div>
              </div>

              <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
                <p>• 名字改动会更新市场展示</p>
                <p>• 主题色影响卡片 UI 渲染</p>
                <p>• 分类决定 Tab 分组位置</p>
                <p>• systemPrompt 决定专家的发言行为</p>
              </div>
            </aside>
          </div>

          {/* Footer */}
          <footer className="flex shrink-0 items-center justify-between border-t bg-background px-5 py-3">
            <div>
              {isEditing && !expert?.isBuiltIn && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteMut.isPending}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-destructive transition-base hover:bg-destructive/10 disabled:opacity-50"
                >
                  {deleteMut.isPending ? (
                    <IconLoader2 size={12} className="animate-spin" />
                  ) : (
                    <TablerIcons.IconTrash size={12} />
                  )}
                  删除
                </button>
              )}
              {expert?.isBuiltIn && (
                <span className="text-[10px] text-muted-foreground">
                  系统内置专家不可删除
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border bg-background px-4 py-1.5 text-sm font-medium hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !form.name.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? (
                  <IconLoader2 size={13} className="animate-spin" />
                ) : (
                  <IconCheck size={13} />
                )}
                {isEditing ? '保存' : isCreating ? '创建专家' : '复制并编辑'}
              </button>
            </div>
          </footer>
        </div>
      </div>,
      document.body,
    )
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Field 子组件：简化 label + 内容 + hint 排版
// ───────────────────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
        {hint && <span className="ml-1 text-[10px] font-normal opacity-70">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[10px] text-muted-foreground">{children}</div>;
}
