'use client';

/**
 * 需求探索器 store（client-side）
 *
 * 核心规则（用户约定 2026-08-30）：
 *   1. 每次只问 1 个问题
 *   2. 支持 single / multi / text 三种回答类型
 *   3. 持续追问，直到置信度 ≥ 95% 才允许"开始任务"
 *   4. 用户可主动"接受当前结论"（即使 < 95%）跳过追问
 *
 * 设计取舍：
 *   - 不依赖真实 AI：内置 question bank + 规则化置信度计算，
 *     避免在没配 LLM key 的开发环境崩溃。
 *   - 状态持久化到 localStorage（key: `aihub-discovery-v1`），刷新不丢
 *   - 完成后生成 structured `brief`，交给对话页生成对话 / 交给项目页预填字段
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TablerIconType } from '@/lib/icon-type';
import {
  IconFolders,
  IconMessages,
  IconCode,
  IconPlug,
  IconNews,
  IconChartBar,
  IconSparkles,
  IconRocket,
  IconShield,
  IconBolt,
  IconFileText,
  IconUsers,
  IconWorld,
} from '@tabler/icons-react';

// ─── Types ────────────────────────────────────────────────────────────────

export type AnswerValue = string | string[] | undefined;

export type QuestionKind = 'single' | 'multi' | 'text';

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
  /** 选中这条带来的置信度增量（0..1），默认 0.1 */
  confidenceBoost?: number;
  /** 选项对应的影响标签，用于 brief 生成 */
  impacts?: Partial<DiscoveryBrief>;
}

export interface DiscoveryQuestion {
  id: string;
  /** 分类标签（显示在卡片顶部） */
  category: string;
  question: string;
  hint?: string;
  kind: QuestionKind;
  options?: QuestionOption[];
  /** 当 kind === 'text' 时的占位符 */
  textPlaceholder?: string;
  /** 适用场景：仅工作台 / 仅对话 / 全部 */
  scope: 'workbench' | 'chat' | 'all';
  /** 回答此问题后是否要追问（基于答案决定） */
  followUps?: Record<string, string>;
}

export interface DiscoveryBrief {
  /** 用户原始需求 */
  intent: string;
  /** 推断的领域（project / chat / analysis / etc.） */
  domain: string;
  /** 目标场景 */
  scenario: string;
  /** 关键技术 / 工具 */
  tech: string[];
  /** 优先级（low / medium / high / critical） */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** 期望产出形式 */
  deliverable: string;
  /** 受众（个人 / 团队 / 公开） */
  audience: 'individual' | 'team' | 'public';
  /** 时间约束 */
  timeline: string;
  /** 风险偏好 */
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  /** 自由文本补充 */
  extraContext: string;
}

export interface DiscoverySession {
  /** 当前领域上下文：'workbench' | 'chat' */
  scope: 'workbench' | 'chat';
  /** 用户的初始需求 */
  intent: string;
  /** 已问问题 + 答案 */
  history: Array<{
    questionId: string;
    answer: AnswerValue;
    category: string;
  }>;
  /** 当前问题索引 */
  currentIndex: number;
  /** 累积置信度（0..1） */
  confidence: number;
  /** 状态 */
  status: 'idle' | 'asking' | 'ready' | 'done';
  /** 生成的 brief（status === 'ready' 或 'done' 时填充） */
  brief: Partial<DiscoveryBrief>;
  /** 开始时间 */
  startedAt: string;
  /** 完成时间 */
  completedAt?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const CONFIDENCE_INITIAL = 0.30;
const CONFIDENCE_THRESHOLD = 0.95;
const CONFIDENCE_MAX = 0.98;
const STORAGE_KEY = 'aihub-discovery-v1';

// ─── Question Bank ────────────────────────────────────────────────────────
// 内置问题库；按 scope 过滤；按顺序追问。

const QUESTIONS: DiscoveryQuestion[] = [
  // ─── Phase 1: 定位场景（必须问，覆盖率高） ─────────────────
  {
    id: 'scope-select',
    category: '场景',
    question: '你想做什么类型的任务？',
    hint: '我会根据场景匹配最佳工作流',
    kind: 'single',
    scope: 'all',
    options: [
      {
        value: 'new-project',
        label: '新建一个项目',
        description: '从零开始创建一个项目（含工作空间、插件、提示词）',
        confidenceBoost: 0.18,
        impacts: { domain: 'project', scenario: 'create' },
      },
      {
        value: 'start-chat',
        label: '开始一个 AI 对话',
        description: '针对某个问题或任务开启多轮 AI 对话',
        confidenceBoost: 0.18,
        impacts: { domain: 'chat', scenario: 'conversation' },
      },
      {
        value: 'run-analysis',
        label: '运行代码分析',
        description: '在已有项目上跑 AI 代码审查 / 评分',
        confidenceBoost: 0.15,
        impacts: { domain: 'analysis', scenario: 'review' },
      },
      {
        value: 'research',
        label: '研究 / 调研',
        description: '了解 AI 新闻、模型对比、价格趋势',
        confidenceBoost: 0.15,
        impacts: { domain: 'research', scenario: 'browse' },
      },
      {
        value: 'integrate',
        label: '集成 / 接入第三方',
        description: '把外部服务（GitHub / Slack / Webhook）接进来',
        confidenceBoost: 0.12,
        impacts: { domain: 'plugin', scenario: 'integrate' },
      },
    ],
  },

  // ─── Phase 2: 项目 / 对话细节 ─────────────────────────────
  {
    id: 'project-tech',
    category: '技术栈',
    question: '项目主要使用什么技术栈？',
    hint: '多选；不熟悉的可以跳过',
    kind: 'multi',
    scope: 'workbench',
    options: [
      { value: 'ts-react', label: 'TypeScript + React', confidenceBoost: 0.08 },
      { value: 'ts-vue', label: 'TypeScript + Vue', confidenceBoost: 0.08 },
      { value: 'ts-node', label: 'TypeScript + Node.js (后端)', confidenceBoost: 0.08 },
      { value: 'python', label: 'Python (FastAPI / Django)', confidenceBoost: 0.08 },
      { value: 'go', label: 'Go', confidenceBoost: 0.08 },
      { value: 'rust', label: 'Rust', confidenceBoost: 0.08 },
      { value: 'mobile', label: '移动端 (Swift / Kotlin / RN)', confidenceBoost: 0.08 },
      { value: 'other', label: '其他 / 不确定', confidenceBoost: 0.04 },
    ],
  },

  {
    id: 'chat-topic',
    category: '主题',
    question: '对话主要想聊哪类话题？',
    hint: '决定我会调用哪些专家',
    kind: 'multi',
    scope: 'chat',
    options: [
      { value: 'code', label: '代码 / 编程问题', confidenceBoost: 0.10, impacts: { scenario: 'code-help' } },
      { value: 'design', label: '产品 / 设计 / UX', confidenceBoost: 0.08 },
      { value: 'data', label: '数据分析 / 报表', confidenceBoost: 0.08 },
      { value: 'writing', label: '写作 / 文案', confidenceBoost: 0.08 },
      { value: 'research', label: '调研 / 资料整理', confidenceBoost: 0.08 },
      { value: 'ops', label: '运维 / 部署 / 监控', confidenceBoost: 0.08 },
      { value: 'learning', label: '学习 / 教程', confidenceBoost: 0.06 },
    ],
  },

  // ─── Phase 3: 优先级与时间 ─────────────────────────────────
  {
    id: 'priority',
    category: '优先级',
    question: '这个任务的紧急程度？',
    kind: 'single',
    scope: 'all',
    options: [
      { value: 'critical', label: '🔥 紧急 (今天必须搞定)', confidenceBoost: 0.10, impacts: { priority: 'critical' } },
      { value: 'high', label: '高 (本周)', confidenceBoost: 0.08, impacts: { priority: 'high' } },
      { value: 'medium', label: '中 (本季度)', confidenceBoost: 0.06, impacts: { priority: 'medium' } },
      { value: 'low', label: '低 (有空闲时)', confidenceBoost: 0.05, impacts: { priority: 'low' } },
    ],
  },

  {
    id: 'timeline',
    category: '时间',
    question: '期望的工作时间范围？',
    kind: 'single',
    scope: 'all',
    options: [
      { value: '1h', label: '1 小时内出结果', confidenceBoost: 0.06, impacts: { timeline: '1h' } },
      { value: '1d', label: '当天完成', confidenceBoost: 0.06, impacts: { timeline: '1d' } },
      { value: '1w', label: '本周内', confidenceBoost: 0.05, impacts: { timeline: '1w' } },
      { value: 'flexible', label: '灵活 / 不限', confidenceBoost: 0.04, impacts: { timeline: 'flexible' } },
    ],
  },

  // ─── Phase 4: 产出与受众 ───────────────────────────────────
  {
    id: 'deliverable',
    category: '产出',
    question: '期望的产出形式？',
    kind: 'single',
    scope: 'all',
    options: [
      { value: 'code', label: '💻 代码 / 脚本', confidenceBoost: 0.06, impacts: { deliverable: 'code' } },
      { value: 'doc', label: '📄 文档 / 报告', confidenceBoost: 0.06, impacts: { deliverable: 'doc' } },
      { value: 'ppt', label: '🎯 PPT / 演示', confidenceBoost: 0.06, impacts: { deliverable: 'ppt' } },
      { value: 'analysis', label: '📊 分析 / 评估', confidenceBoost: 0.06, impacts: { deliverable: 'analysis' } },
      { value: 'plan', label: '🗓️ 计划 / 路线图', confidenceBoost: 0.05, impacts: { deliverable: 'plan' } },
      { value: 'chat', label: '💬 继续对话即可', confidenceBoost: 0.04, impacts: { deliverable: 'chat' } },
    ],
  },

  {
    id: 'audience',
    category: '受众',
    question: '这个产出物的受众？',
    kind: 'single',
    scope: 'all',
    options: [
      { value: 'individual', label: '仅自己', confidenceBoost: 0.04, impacts: { audience: 'individual' } },
      { value: 'team', label: '团队成员', confidenceBoost: 0.05, impacts: { audience: 'team' } },
      { value: 'public', label: '公开发布', confidenceBoost: 0.05, impacts: { audience: 'public' } },
    ],
  },

  // ─── Phase 5: 风险偏好 ─────────────────────────────────────
  {
    id: 'risk',
    category: '偏好',
    question: '你接受方案中的哪些权衡？',
    hint: '多选；决定我推荐的实现风格',
    kind: 'multi',
    scope: 'all',
    options: [
      { value: 'fast', label: '🚀 速度优先（牺牲精度）', confidenceBoost: 0.04 },
      { value: 'cheap', label: '💰 成本优先（用小模型）', confidenceBoost: 0.04 },
      { value: 'safe', label: '🛡️ 安全优先（更多校验）', confidenceBoost: 0.04, impacts: { riskTolerance: 'conservative' } },
      { value: 'novel', label: '✨ 创新优先（用最新模型）', confidenceBoost: 0.03, impacts: { riskTolerance: 'aggressive' } },
      { value: 'standard', label: '🎯 标准稳健（主流选择）', confidenceBoost: 0.04, impacts: { riskTolerance: 'balanced' } },
    ],
  },

  // ─── Phase 6: 自由补充 ─────────────────────────────────────
  {
    id: 'extra',
    category: '补充',
    question: '还有什么我应该知道的信息？',
    hint: '可空；填了会显著提升准确度',
    kind: 'text',
    scope: 'all',
    textPlaceholder: '例：之前用过的类似工具、关键限制条件、参考项目链接…',
  },
];

// ─── State Helpers ────────────────────────────────────────────────────────

function loadSession(): DiscoverySession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiscoverySession;
    if (parsed.status === 'done' && Date.now() - new Date(parsed.completedAt ?? parsed.startedAt).getTime() > 24 * 3600_000) {
      // 24h 前的已完成会话自动归档
      return null;
    }
    return parsed;
  } catch (e) {
    // P2 修复：JSON 解析失败（数据损坏）静默降级为新会话
    // 仅影响当前 tab 持久化，用户可正常开启新会话
    console.warn('[discovery-store] loadSession failed:', (e as Error).message);
    return null;
  }
}

function saveSession(session: DiscoverySession) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    // P2 修复：写入失败仅丢失本地缓存，会话仍可在内存中继续
    console.warn('[discovery-store] saveSession failed:', (e as Error).message);
  }
}

function clearSession() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // P2 修复：清除失败仅影响下次启动，仍可继续新会话
    console.warn('[discovery-store] clearSession failed:', (e as Error).message);
  }
}

function filterQuestions(scope: 'workbench' | 'chat'): DiscoveryQuestion[] {
  return QUESTIONS.filter((q) => q.scope === 'all' || q.scope === scope);
}

/**
 * 合并 impacts：
 * - 数组字段：合并去重（适用于 tags / roles / audiences 等）
 * - 标量字段：只在 brief 中尚未设值时写入，避免"先到先得"导致用户后续
 *   改答案后旧值仍残留。若由 computeBrief 的去重逻辑保证同一问题只走一次，
 *   这里"未设才写"就等价于"最后改的赢"。
 */
function mergeImpacts(brief: Partial<DiscoveryBrief>, impacts?: Partial<DiscoveryBrief>): Partial<DiscoveryBrief> {
  if (!impacts) return brief;
  const next = { ...brief };
  for (const [k, v] of Object.entries(impacts)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && Array.isArray(next[k as keyof DiscoveryBrief])) {
      // 数组合并去重
      const merged = [...((next[k as keyof DiscoveryBrief] as unknown as string[]) ?? []), ...v];
      (next as Record<string, unknown>)[k] = Array.from(new Set(merged));
    } else if (next[k as keyof DiscoveryBrief] === undefined) {
      // 后到的覆盖空字段（同一问题由 computeBrief 去重保证只走一次）
      (next as Record<string, unknown>)[k] = v;
    }
  }
  return next;
}

function computeBrief(
  intent: string,
  history: DiscoverySession['history']
): Partial<DiscoveryBrief> {
  let brief: Partial<DiscoveryBrief> = { intent };

  // H-23 修复：同一问题被多次回答时（用户改了主意），旧值会"先到先得"残留。
  // 这里按 questionId 去重，只保留最后一次作答再合并，确保"最后改的赢"。
  const latestByQuestion = new Map<string, (typeof history)[number]>();
  for (const h of history) latestByQuestion.set(h.questionId, h);

  for (const h of latestByQuestion.values()) {
    const q = QUESTIONS.find((x) => x.id === h.questionId);
    if (!q) continue;
    if (q.options) {
      // 把每个选项的 impacts 合并进去（多选时合并所有选项的 impacts）
      const values = Array.isArray(h.answer) ? h.answer : h.answer ? [h.answer as string] : [];
      for (const v of values) {
        const opt = q.options.find((o) => o.value === v);
        if (opt?.impacts) brief = mergeImpacts(brief, opt.impacts);
      }
    }
    if (q.id === 'extra' && typeof h.answer === 'string') {
      brief.extraContext = h.answer;
    }
  }
  return brief;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export interface UseDiscoveryReturn {
  session: DiscoverySession | null;
  questions: DiscoveryQuestion[];
  currentQuestion: DiscoveryQuestion | null;
  confidence: number;
  isReady: boolean;
  /** 开始一个新的会话（intent 是用户输入的初始需求） */
  start: (intent: string, scope: 'workbench' | 'chat') => void;
  /** 回答当前问题 */
  answer: (value: AnswerValue) => void;
  /** 跳过当前问题（不增加置信度） */
  skip: () => void;
  /** 用户主动"接受当前结论"（即使 < 95%） */
  accept: () => void;
  /** 完成会话（生成 brief 后调用） */
  complete: () => void;
  /** 重置 */
  reset: () => void;
}

export function useDiscovery(scope: 'workbench' | 'chat' = 'workbench'): UseDiscoveryReturn {
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const sessionRef = useRef<DiscoverySession | null>(null);

  // hydrate
  useEffect(() => {
    const loaded = loadSession();
    if (loaded && loaded.scope === scope && loaded.status !== 'done') {
      sessionRef.current = loaded;
      setSession(loaded);
    } else if (loaded && loaded.scope !== scope) {
      // 切换 scope 时清掉
      clearSession();
    }
  }, [scope]);

  const persist = useCallback((next: DiscoverySession | null) => {
    sessionRef.current = next;
    if (next) saveSession(next);
    else clearSession();
    setSession(next);
  }, []);

  const questions = useMemo(() => filterQuestions(scope), [scope]);
  const currentQuestion = useMemo(() => {
    if (!session) return null;
    return questions[session.currentIndex] ?? null;
  }, [session, questions]);

  const confidence = session?.confidence ?? 0;
  const isReady = confidence >= CONFIDENCE_THRESHOLD;

  const start = useCallback(
    (intent: string, startScope: 'workbench' | 'chat') => {
      const trimmed = intent.trim();
      if (!trimmed) return;
      const next: DiscoverySession = {
        scope: startScope,
        intent: trimmed,
        history: [],
        currentIndex: 0,
        confidence: CONFIDENCE_INITIAL,
        status: 'asking',
        brief: { intent: trimmed },
        startedAt: new Date().toISOString(),
      };
      persist(next);
    },
    [persist]
  );

  const answer = useCallback(
    (value: AnswerValue) => {
      const cur = sessionRef.current;
      if (!cur || cur.status !== 'asking') return;
      const q = questions[cur.currentIndex];
      if (!q) return;

      // 计算置信度增量
      let boost = 0;
      if (q.options && value) {
        const values = Array.isArray(value) ? value : [value as string];
        for (const v of values) {
          const opt = q.options.find((o) => o.value === v);
          if (opt?.confidenceBoost) boost += opt.confidenceBoost;
        }
      } else if (q.kind === 'text' && typeof value === 'string' && value.trim()) {
        // 文本答案默认 +0.05
        boost = 0.05 + Math.min(0.10, value.length / 1000);
      } else if (!value || (Array.isArray(value) && value.length === 0)) {
        // 空答案 = 跳过，不加分
        boost = 0;
      }

      const newHistory = [
        ...cur.history,
        {
          questionId: q.id,
          answer: value,
          category: q.category,
        },
      ];

      let newBrief = cur.brief;
      // 把选项 impacts 合并进 brief
      if (q.options && value) {
        const values = Array.isArray(value) ? value : [value as string];
        for (const v of values) {
          const opt = q.options.find((o) => o.value === v);
          if (opt?.impacts) newBrief = mergeImpacts(newBrief, opt.impacts);
        }
      }
      if (q.id === 'extra' && typeof value === 'string') {
        newBrief = { ...newBrief, extraContext: value };
      }

      const newConfidence = Math.min(CONFIDENCE_MAX, cur.confidence + boost);
      const nextIndex = cur.currentIndex + 1;
      const noMoreQuestions = nextIndex >= questions.length;
      const reachedThreshold = newConfidence >= CONFIDENCE_THRESHOLD;

      const next: DiscoverySession = {
        ...cur,
        history: newHistory,
        currentIndex: nextIndex,
        confidence: newConfidence,
        status: reachedThreshold || noMoreQuestions ? 'ready' : 'asking',
        brief: newBrief,
      };

      // 计算最终 brief（合并所有历史）
      const finalBrief = computeBrief(cur.intent, newHistory);
      next.brief = { ...finalBrief };

      persist(next);
    },
    [questions, persist]
  );

  const skip = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur || cur.status !== 'asking') return;
    const next: DiscoverySession = {
      ...cur,
      currentIndex: cur.currentIndex + 1,
      status: cur.currentIndex + 1 >= questions.length ? 'ready' : 'asking',
    };
    persist(next);
  }, [questions.length, persist]);

  const accept = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const next: DiscoverySession = {
      ...cur,
      status: 'ready',
      confidence: Math.max(cur.confidence, CONFIDENCE_THRESHOLD),
    };
    persist(next);
  }, [persist]);

  const complete = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    persist({
      ...cur,
      status: 'done',
      completedAt: new Date().toISOString(),
    });
  }, [persist]);

  const reset = useCallback(() => {
    persist(null);
  }, [persist]);

  return {
    session,
    questions,
    currentQuestion,
    confidence,
    isReady,
    start,
    answer,
    skip,
    accept,
    complete,
    reset,
  };
}

// ─── Render Helpers ────────────────────────────────────────────────────────

export function confidenceColor(c: number): string {
  if (c >= 0.95) return 'text-success';
  if (c >= 0.75) return 'text-primary';
  if (c >= 0.50) return 'text-warning';
  return 'text-muted-foreground';
}

export function confidenceLabel(c: number): string {
  if (c >= 0.95) return '已就绪';
  if (c >= 0.75) return '清晰';
  if (c >= 0.50) return '进展中';
  return '起步';
}

export function buildPromptFromBrief(brief: Partial<DiscoveryBrief>): string {
  const parts: string[] = [];
  if (brief.intent) parts.push(`【需求】${brief.intent}`);
  if (brief.scenario) parts.push(`【场景】${brief.scenario}`);
  if (brief.domain) parts.push(`【领域】${brief.domain}`);
  if (brief.tech && brief.tech.length) parts.push(`【技术栈】${brief.tech.join('、')}`);
  if (brief.deliverable) parts.push(`【产出】${brief.deliverable}`);
  if (brief.priority) parts.push(`【优先级】${brief.priority}`);
  if (brief.timeline) parts.push(`【时间】${brief.timeline}`);
  if (brief.audience) parts.push(`【受众】${brief.audience}`);
  if (brief.riskTolerance) parts.push(`【风险偏好】${brief.riskTolerance}`);
  if (brief.extraContext) parts.push(`【补充】${brief.extraContext}`);
  return parts.join('\n');
}

export const DISCOVERY_QUESTIONS = QUESTIONS;
export const DISCOVERY_THRESHOLD = CONFIDENCE_THRESHOLD;