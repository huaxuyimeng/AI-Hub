// 来源：d:\1Money\aihub\src\lib\meeting\meeting-graph.ts (拆分批次 1)
//
// 职责：MeetingGraph 的状态定义层。
//   - MeetingContext：LangGraph configurable 的运行时上下文
//   - MeetingAnnotation：LangGraph StateGraph 的 Annotation schema（含 reducers）
//
// 不依赖任何 node 实现，可独立演进。
//
// 过期条件：
//   - LangGraph 升级到 1.x → 检查 Annotation.Root() / reducer 签名
//   - 新增 state 字段 → 同步更新 MeetingState / reducer / runMeetingGraph 初始值

import { Annotation } from '@langchain/langgraph';
import type { MeetingState, ParticipantConfig, TranscriptEntry } from './types';

// ─── Config helpers ────────────────────────────────────────────────────────

/** LangGraph configurable 的运行时上下文（由 runMeetingGraph 注入） */
export interface MeetingContext {
  tenantId: string;
  hostModel?: string;
  decisionModel?: string;
  /**
   * 用户指定的最大轮数（1-MAX_MEETING_ROUNDS）。
   * undefined 时用 MAX_MEETING_ROUNDS 作为硬上限（默认 3）。
   * 2026-09-17 Bug5 修复：原来 maxRounds 入参被丢弃，graph 永远跑满 3 轮。
   */
  maxRounds?: number;
}

// ─── Annotation 定义 ────────────────────────────────────────────────────────

/**
 * LangGraph StateGraph 的 Annotation 定义。
 * Annotation.Root() 定义状态的 schema + reducer。
 * reducer 决定多个节点更新同一字段时如何合并。
 *
 * 关键 reducer 行为：
 * - transcripts：spread merge（新 key 覆盖旧 key）
 * - currentIndex / round：取最新值
 * - errors：拼接数组
 */
export const MeetingAnnotation = Annotation.Root({
  topic: Annotation<string>(),

  participants: Annotation<ParticipantConfig[]>(),

  transcripts: Annotation<Record<string, TranscriptEntry[]>>({
    reducer: (prev, next) => {
      // 合并策略：保留 prev 的所有 key + value，叠加 next 的更新
      return { ...prev, ...next };
    },
    default: () => ({}),
  }),

  currentIndex: Annotation<number>({
    reducer: (prev, next) => next ?? prev,
    default: () => 0,
  }),

  round: Annotation<number>({
    reducer: (prev, next) => next ?? prev,
    default: () => 1,
  }),

  currentParticipant: Annotation<ParticipantConfig | undefined>(),

  continueMeeting: Annotation<boolean | undefined>(),

  conclusion: Annotation<string | undefined>(),

  errors: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  /**
   * 累计 usage（运行时，不写 DB）。由 callLLMNode / makeDecision / concludeNode
   * 累加；runMeetingGraph 结束后读出供 recordUsage(kind: 'meeting') 使用。
   * 2026-09-17 Bug2 修复引入。
   * 2026-09-18 Bug38 扩展：新增 cachedTokens + cachedByModel 用于 prompt cache 计费。
   *
   * reducer 选「next ?? prev」与 currentIndex/round 同形：节点返回完整新对象时
   * 用 next；节点不返回时回退 prev（配合 default 永远不为 undefined）。
   */
  usageTotal: Annotation<NonNullable<MeetingState['usageTotal']>>({
    reducer: (prev, next) => next ?? prev,
    default: () => ({
      inputTokens: 0,
      outputTokens: 0,
      costByModel: {},
      cachedTokens: 0,
      cachedByModel: {},
    }),
  }),
});
