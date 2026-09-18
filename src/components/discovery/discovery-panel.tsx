'use client';

/**
 * 需求探索向导 UI
 *
 * 嵌入式卡片：放在工作台欢迎区下方 / 对话页输入框上方
 * 三种状态：idle / asking / ready
 * 进度条 + 置信度数字 + 跳过/接受按钮
 */

import { useState } from 'react';
import {
  IconSparkles,
  IconChevronRight,
  IconCircleCheck,
  IconRefresh,
  IconCheck,
  IconX,
  IconArrowRight,
  IconHelpCircle,
} from '@tabler/icons-react';
import {
  useDiscovery,
  confidenceColor,
  confidenceLabel,
  buildPromptFromBrief,
  type DiscoveryBrief,
  type AnswerValue,
} from './discovery-store';

// 进度条颜色
function barColor(c: number) {
  if (c >= 0.95) return 'bg-success';
  if (c >= 0.75) return 'bg-primary';
  if (c >= 0.50) return 'bg-warning';
  return 'bg-muted-foreground/40';
}

interface DiscoveryPanelProps {
  scope: 'workbench' | 'chat';
  onStartTask?: (prompt: string, brief: Partial<DiscoveryBrief>) => void;
  onOpenChat?: (prompt: string) => void;
  defaultIntent?: string;
}

export function DiscoveryPanel({ scope, onStartTask, onOpenChat, defaultIntent }: DiscoveryPanelProps) {
  const d = useDiscovery(scope);
  const [input, setInput] = useState(defaultIntent ?? '');
  const [textValue, setTextValue] = useState('');

  if (!d.session || d.session.status === 'done') {
    // idle 状态：欢迎语 + 输入框
    return <IdleView input={input} setInput={setInput} scope={scope} onStart={d.start} />;
  }

  return (
    <div className="rounded-xl border bg-gradient-to-br from-card to-card/50 shadow-sm">
      {/* Header：进度条 + 置信度 + 重置 */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <IconSparkles size={13} />
          </span>
          需求探索向导
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {d.session.history.length} 题已答 / 共 {d.questions.length} 题
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">把握度</span>
            <span className={'font-mono text-xs font-semibold tabular-nums ' + confidenceColor(d.confidence)}>
              {(d.confidence * 100).toFixed(0)}%
            </span>
            <span className={'rounded px-1.5 py-0.5 text-[10px] ' + confidenceColor(d.confidence)}>
              {confidenceLabel(d.confidence)}
            </span>
          </div>
          <button
            type="button"
            onClick={d.reset}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="重置"
            title="重置"
          >
            <IconRefresh size={12} />
          </button>
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1 w-full bg-muted">
        <div
          className={'h-full transition-all duration-300 ' + barColor(d.confidence)}
          style={{ width: `${Math.min(100, d.confidence * 100)}%` }}
        />
      </div>

      <div className="px-4 py-4">
        {d.session.status === 'asking' && d.currentQuestion && (
          <AskingView
            question={d.currentQuestion}
            textValue={textValue}
            setTextValue={setTextValue}
            onAnswer={d.answer}
            onSkip={d.skip}
          />
        )}

        {d.session.status === 'ready' && (
          <ReadyView
            intent={d.session.intent}
            brief={d.session.brief}
            confidence={d.confidence}
            onAccept={d.accept}
            onReset={d.reset}
            onStartTask={onStartTask}
            onOpenChat={onOpenChat}
          />
        )}
      </div>
    </div>
  );
}

// ─── Idle View ─────────────────────────────────────────────────────────────

function IdleView({
  input,
  setInput,
  scope,
  onStart,
}: {
  input: string;
  setInput: (v: string) => void;
  scope: 'workbench' | 'chat';
  onStart: (intent: string, scope: 'workbench' | 'chat') => void;
}) {
  const placeholder =
    scope === 'chat'
      ? '例：帮我写一个 Python 脚本批量重命名文件夹里的图片'
      : '例：我想做一个 TypeScript + React 的项目，用于管理客户的发票';

  return (
    <div className="rounded-xl border bg-gradient-to-br from-card to-card/50 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <IconSparkles size={13} />
        </span>
        <div className="text-sm font-medium">需求探索向导</div>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          一问一答 · 把握度 ≥95% 才开始任务
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        简单描述你的需求，我会逐题追问直到完全理解你的目标，再交给 AI 执行。
      </p>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) onStart(input, scope);
          }}
          placeholder={placeholder}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          type="button"
          disabled={!input.trim()}
          onClick={() => onStart(input, scope)}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          开始探索
          <IconArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Asking View ───────────────────────────────────────────────────────────

function AskingView({
  question,
  textValue,
  setTextValue,
  onAnswer,
  onSkip,
}: {
  question: ReturnType<typeof useDiscovery>['currentQuestion'];
  textValue: string;
  setTextValue: (v: string) => void;
  onAnswer: (v: AnswerValue) => void;
  onSkip: () => void;
}) {
  // multi（useState 必须在所有条件判断之前调用）
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  if (!question) return null;

  function toggleMulti(value: string) {
    setMultiSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  return (
    <div>
      {/* 分类标签 */}
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <IconHelpCircle size={11} />
        {question.category}
      </div>

      {/* 问题 */}
      <div className="mb-1 text-sm font-medium leading-relaxed">
        {question.question}
      </div>
      {question.hint && (
        <div className="mb-3 text-[11px] text-muted-foreground">{question.hint}</div>
      )}

      {/* single 选项 */}
      {question.kind === 'single' && question.options && (
        <div className="space-y-1.5">
          {question.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onAnswer(opt.value)}
              className="flex w-full items-start gap-2.5 rounded-md border bg-background px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-accent/50"
            >
              <div className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground/40 transition group-hover:border-primary" />
              <div className="flex-1">
                <div className="font-medium">{opt.label}</div>
                {opt.description && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{opt.description}</div>
                )}
              </div>
              <IconChevronRight size={14} className="self-center text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* multi 选项 */}
      {question.kind === 'multi' && question.options && (
        <div className="space-y-1.5">
          {question.options.map((opt) => {
            const checked = multiSelected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleMulti(opt.value)}
                className={
                  'flex w-full items-start gap-2.5 rounded-md border bg-background px-3 py-2 text-left text-sm transition ' +
                  (checked ? 'border-primary bg-primary/5' : 'hover:border-primary hover:bg-accent/50')
                }
              >
                <div
                  className={
                    'mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-2 transition ' +
                    (checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')
                  }
                >
                  {checked && <IconCheck size={9} stroke={3} />}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{opt.label}</div>
                  {opt.description && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{opt.description}</div>
                  )}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            disabled={multiSelected.length === 0}
            onClick={() => {
              onAnswer(multiSelected);
              setMultiSelected([]);
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            确认（{multiSelected.length}）
            <IconArrowRight size={12} />
          </button>
        </div>
      )}

      {/* text 选项 */}
      {question.kind === 'text' && (
        <div className="space-y-2">
          <textarea
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={question.textPlaceholder}
            rows={3}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onSkip();
                setTextValue('');
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <IconX size={11} />
              跳过
            </button>
            <button
              type="button"
              onClick={() => {
                onAnswer(textValue);
                setTextValue('');
              }}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              确认
              <IconArrowRight size={11} />
            </button>
          </div>
        </div>
      )}

      {/* single 类型跳过 */}
      {question.kind === 'single' && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <IconX size={11} />
            跳过
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Ready View ────────────────────────────────────────────────────────────

function ReadyView({
  intent,
  brief,
  confidence,
  onAccept,
  onReset,
  onStartTask,
  onOpenChat,
}: {
  intent: string;
  brief: Partial<DiscoveryBrief>;
  confidence: number;
  onAccept: () => void;
  onReset: () => void;
  onStartTask?: (prompt: string, brief: Partial<DiscoveryBrief>) => void;
  onOpenChat?: (prompt: string) => void;
}) {
  const prompt = buildPromptFromBrief(brief);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/15 text-success">
          <IconCircleCheck size={16} />
        </span>
        <div>
          <div className="text-sm font-medium">需求已清晰</div>
          <div className="text-[11px] text-muted-foreground">
            把握度 {(confidence * 100).toFixed(0)}% · {intent.slice(0, 30)}{intent.length > 30 ? '…' : ''}
          </div>
        </div>
      </div>

      {/* 结构化 brief 预览 */}
      <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2.5">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">
          {prompt}
        </pre>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2">
        {onOpenChat && (
          <button
            type="button"
            onClick={() => onOpenChat(prompt)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <IconSparkles size={12} />
            带入对话
          </button>
        )}
        {onStartTask && (
          <button
            type="button"
            onClick={() => onStartTask(prompt, brief)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
          >
            <IconArrowRight size={12} />
            开始执行
          </button>
        )}
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="已理解，开始"
        >
          <IconCheck size={11} />
          接受并开始
        </button>
        <button
          type="button"
          onClick={onReset}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconRefresh size={11} />
          重新开始
        </button>
      </div>
    </div>
  );
}