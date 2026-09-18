'use client';

/**
 * AI 对话风格设置面板
 * 路径：src/components/settings/ChatStylePanel.tsx
 *
 * 对应 Phase 3.1 AI 对话风格 section
 * 字段：presetStyle / openingLine / personaRole / customRules / responseLang / reasoningDepth
 */

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';

type PresetStyle = 'rigorous' | 'humorous' | 'friendly' | 'concise' | 'literary';
type Lang = 'zh' | 'en' | 'auto';
type Depth = 'normal' | 'detailed' | 'none';

const PRESETS: { value: PresetStyle; label: string; desc: string }[] = [
  { value: 'rigorous', label: '严谨', desc: '逻辑严密、引用数据、术语精准' },
  { value: 'humorous', label: '幽默', desc: '轻松语气、举生活例子、偶尔插科打诨' },
  { value: 'friendly', label: '友善', desc: '像朋友一样、有温度、不端着' },
  { value: 'concise', label: '简洁', desc: '一两句直击重点、不啰嗦' },
  { value: 'literary', label: '文学', desc: '排比、比喻、文气讲究' },
];

export function ChatStylePanel() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data, isLoading } = trpc.preferences.getChatStyle.useQuery();
  const { data: promptData } = trpc.preferences.getAnalysisPrompt.useQuery();
  const updateChatMut = trpc.preferences.updateChatStyle.useMutation({
    onSuccess: () => utils.preferences.getChatStyle.invalidate(),
  });
  const updatePromptMut = trpc.preferences.updateAnalysisPrompt.useMutation({
    onSuccess: () => utils.preferences.getAnalysisPrompt.invalidate(),
  });

  const [preset, setPreset] = useState<PresetStyle>('friendly');
  const [opening, setOpening] = useState('');
  const [persona, setPersona] = useState('');
  const [rules, setRules] = useState('');
  const [lang, setLang] = useState<Lang>('auto');
  const [depth, setDepth] = useState<Depth>('normal');
  const [analysisPrompt, setAnalysisPrompt] = useState('');

  useEffect(() => {
    if (!data) return;
    setPreset(data.chatPresetStyle as PresetStyle);
    setOpening(data.chatOpeningLine ?? '');
    setPersona(data.chatPersonaRole ?? '');
    setRules(data.chatCustomRules);
    setLang(data.chatResponseLang as Lang);
    setDepth(data.chatReasoningDepth as Depth);
  }, [data]);

  useEffect(() => {
    if (promptData) setAnalysisPrompt(promptData.prompt ?? '');
  }, [promptData]);

  const savedPrompt = promptData?.prompt ?? '';
  const hasChanges = () => {
    if (!data) return false;
    return (
      preset !== data.chatPresetStyle ||
      (opening || null) !== data.chatOpeningLine ||
      (persona || null) !== data.chatPersonaRole ||
      rules !== data.chatCustomRules ||
      lang !== data.chatResponseLang ||
      depth !== data.chatReasoningDepth ||
      analysisPrompt !== savedPrompt
    );
  };

  /** chat 风格字段是否发生改动（独立判断，避免误保存） */
  const hasChatStyleChanges = () => {
    if (!data) return false;
    return (
      preset !== data.chatPresetStyle ||
      (opening || null) !== data.chatOpeningLine ||
      (persona || null) !== data.chatPersonaRole ||
      rules !== data.chatCustomRules ||
      lang !== data.chatResponseLang ||
      depth !== data.chatReasoningDepth
    );
  };

  /** 评审 prompt 是否发生改动（独立判断） */
  const hasPromptChanges = () => analysisPrompt !== savedPrompt;

  function handleSave() {
    // Fix #4：只有 chat 风格确实改动了才调 updateChatMut
    if (hasChatStyleChanges()) {
      updateChatMut.mutate(
        {
          chatPresetStyle: preset,
          chatOpeningLine: opening.trim() || null,
          chatPersonaRole: persona.trim() || null,
          chatCustomRules: rules,
          chatResponseLang: lang,
          chatReasoningDepth: depth,
        },
        {
          onSuccess: () => toast.success('对话风格已保存'),
          onError: (e) => toast.error(e.message),
        }
      );
    }
    // Fix #7：只有 prompt 真的改动了才调，且 null/'' 等价处理
    if (hasPromptChanges()) {
      updatePromptMut.mutate(
        { prompt: analysisPrompt || null },
        {
          onSuccess: () => toast.success('评审提示词已保存'),
          onError: (e) => toast.error(e.message),
        }
      );
    }
  }

  function handleReset() {
    // Fix #5：恢复默认 = 清 state + 把 DB 同步到默认
    //   - 对话风格：updateChatStyle(默认值)
    //   - 评审提示词：updateAnalysisPrompt(null) → 恢复 deep-code-audit 默认
    setPreset('friendly');
    setOpening('');
    setPersona('');
    setRules('');
    setLang('auto');
    setDepth('normal');
    setAnalysisPrompt('');

    updateChatMut.mutate(
      {
        chatPresetStyle: 'friendly',
        chatOpeningLine: null,
        chatPersonaRole: null,
        chatCustomRules: '',
        chatResponseLang: 'auto',
        chatReasoningDepth: 'normal',
      },
      {
        onSuccess: () => toast.success('已恢复默认（对话风格）'),
        onError: (e) => toast.error(e.message),
      }
    );
    // 仅当 prompt 原本不是 null（用户之前设过自定义）时才发起清空请求
    if (savedPrompt !== '') {
      updatePromptMut.mutate(
        { prompt: null },
        {
          onSuccess: () => toast.success('已恢复默认（评审提示词 → deep-code-audit）'),
          onError: (e) => toast.error(e.message),
        }
      );
    }
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }

  return (
    <div className="space-y-6">
      {/* 预设风格 */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-medium">预设风格</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">选择基础基调，所有对话都会沿用</p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              className={
                'flex flex-col items-start rounded-md border px-3 py-2.5 text-left transition ' +
                (preset === p.value
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                  : 'hover:bg-accent/30')
              }
            >
              <div className="text-sm font-medium">{p.label}</div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{p.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 角色 + 开场白 */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-medium">角色与开场</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">告诉 AI「你是谁」和「每次怎么打招呼」</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">角色设定（选填）</label>
            <input
              type="text"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="例：你是 10 年经验的产品经理"
              maxLength={200}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">开场白（选填）</label>
            <input
              type="text"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              placeholder="例：你好，今天想聊点什么？"
              maxLength={200}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">留空 = AI 自由开场</p>
          </div>
        </div>
      </section>

      {/* 规则 */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-medium">自定义规则</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">每行一条规则，会插入到 system prompt</p>
        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={'不要使用 emoji\n回答必须带 markdown 引用\n例子要简洁，不超过两句话'}
          className="mt-3 w-full rounded-md border bg-background px-3 py-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-ring/30"
        />
        <div className="mt-1 text-right text-[10px] text-muted-foreground">{rules.length} / 2000</div>
      </section>

      {/* 代码评审提示词 */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-medium">代码评审提示词</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          自定义 AI 评审规则。留空 = 使用 deep-code-audit 默认八大类审查（安全/CRUD/并发/错误处理/边界/资源/测试/架构）
        </p>
        <textarea
          value={analysisPrompt}
          onChange={(e) => setAnalysisPrompt(e.target.value)}
          rows={8}
          maxLength={8000}
          placeholder={DEFAULT_PROMPT_PLACEHOLDER}
          className="mt-3 w-full rounded-md border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">建议参考 <span className="font-mono text-[10px]">.cursor/skills/deep-code-audit/SKILL.md</span></p>
          <p className="text-[10px] text-muted-foreground">{analysisPrompt.length} / 8000</p>
        </div>
        {analysisPrompt !== savedPrompt && (
          <p className="mt-1 text-[10px] text-primary">● 有未保存的修改</p>
        )}
      </section>

      {/* 回复语言 + 思考深度 */}
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-medium">回复偏好</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">回复语言</label>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="auto">自动（跟随问题）</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">思考深度</label>
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value as Depth)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="normal">正常</option>
              <option value="detailed">详细（展示推理过程）</option>
              <option value="none">简洁（直答）</option>
            </select>
          </div>
        </div>
      </section>

      {/* 操作 */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent"
        >
          恢复默认
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges() || updateChatMut.isPending || updatePromptMut.isPending}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {(updateChatMut.isPending || updatePromptMut.isPending) ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}

// 默认提示词占位符（与 analysis.ts 的 DEFAULT_ANALYSIS_PROMPT 保持完全一致：含评分标准）
const DEFAULT_PROMPT_PLACEHOLDER = `你是资深代码审查员。请对以下代码文件进行深度审查，覆盖八大类问题：
安全漏洞、CRUD完整性、并发竞态、错误处理、边界条件、资源管理、测试质量、架构一致性。

评分标准（必须严格遵守）：
- 基础分 100，每发现一个 CRITICAL 问题扣 25 分，HIGH 扣 10 分，MEDIUM 扣 5 分，LOW 扣 1 分
- 如果有任何 CRITICAL 或 HIGH 级别问题，最终分数不能超过 75
- 如果有任何 MEDIUM 级别问题，最终分数不能超过 90
- 如果没有发现任何问题，才可以给 95-100 分
- 零问题代码极罕见，大多数代码应在 40-85 分区间

输出严格 JSON 格式：
{
  "issues": [{"severity":"LOW|MEDIUM|HIGH|CRITICAL","category":"安全|CRUD|并发|错误处理|边界|资源|测试|架构|代码质量","message":"...","suggestion":"...","startLine":1,"endLine":2,"filePath":"..."}],
  "overall": 0-100,
  "summary": "整体评价（2-3句话）"
}`;