// 来源：d:\1Money\aihub\src\lib\meeting\meeting-graph.ts (拆分批次 3)
//
// 职责：MeetingGraph 的构图与执行层。
//   - buildMeetingGraph：构造 StateGraph（节点 + 边 + 条件边）
//   - runMeetingGraph：执行图，注入运行时上下文
//
// 依赖：state.ts（Annotation）、nodes.ts（节点函数）、types.ts
//
// 过期条件：
//   - LangGraph StateGraph / compile API 变更 → 调整
//   - 新增节点 / 边 → 同步 buildMeetingGraph

import { StateGraph, END } from '@langchain/langgraph';
import { MeetingAnnotation } from './state';
import { logger } from '../observability/logger';
import {
  nextSpeakerNode,
  callLLMNode,
  decideContinueNode,
  concludeNode,
} from './nodes';
import type { MeetingState } from './types';
import { DEFAULT_DECISION_MODEL } from './types';

// ─── Graph Build ──────────────────────────────────────────────────────────

/**
 * buildMeetingGraph — 构造会议状态机图
 */
export function buildMeetingGraph() {
  const workflow = new StateGraph(MeetingAnnotation)
    // ── Nodes ──────────────────────────────────────────────
    .addNode('nextSpeaker', nextSpeakerNode)
    .addNode('callLLM', callLLMNode)
    .addNode('decideContinue', decideContinueNode)
    .addNode('conclude', concludeNode)

    // ── Edges ──────────────────────────────────────────────
    .addEdge('__start__', 'nextSpeaker')
    .addEdge('nextSpeaker', 'callLLM')
    .addEdge('callLLM', 'decideContinue')

    // ── Conditional Edge ────────────────────────────────────
    // decideContinue 返回 continueMeeting，conditional edge 据此决定下一步
    .addConditionalEdges(
      'decideContinue',
      (state: { continueMeeting?: boolean }) => (state.continueMeeting ? 'nextSpeaker' : 'conclude'),
      {
        nextSpeaker: 'nextSpeaker',
        conclude: 'conclude',
      }
    )

    .addEdge('conclude', END);

  return workflow.compile();
}

// ─── Run ─────────────────────────────────────────────────────────────────

/**
 * runMeetingGraph — 运行会议状态机
 *
 * @param initial 初始状态（topic + participants）
 * @param ctx     运行时上下文（tenantId + hostModel + 可选 decisionModel + maxRounds）
 * @returns       最终状态（包含 conclusion + errors + usageTotal）
 */
export async function runMeetingGraph(
  initial: Pick<MeetingState, 'topic' | 'participants'>,
  ctx: {
    tenantId: string;
    hostModel: string;
    decisionModel?: string;
    /** Bug5 修复：用户指定的最大轮数（1-MAX_MEETING_ROUNDS） */
    maxRounds?: number;
  }
): Promise<MeetingState> {
  const t0 = Date.now();
  const graph = buildMeetingGraph();

  logger.info('[meeting-graph] starting', {
    topic: initial.topic,
    participantCount: initial.participants.length,
    hostModel: ctx.hostModel,
    maxRounds: ctx.maxRounds,
  });

  const result = await graph.invoke(
    {
      topic: initial.topic,
      participants: initial.participants,
      transcripts: {},
      currentIndex: 0,
      round: 1,
      errors: [],
    },
    {
      configurable: {
        thread_id: `meeting-${Date.now()}`,
        tenantId: ctx.tenantId,
        hostModel: ctx.hostModel,
        decisionModel: ctx.decisionModel ?? DEFAULT_DECISION_MODEL,
        maxRounds: ctx.maxRounds,
      },
    }
  );

  const duration = Date.now() - t0;

  logger.info('[meeting-graph] completed', {
    topic: initial.topic,
    totalRounds: result.round,
    totalErrors: result.errors.length,
    hasConclusion: !!result.conclusion,
    duration,
  });

  return result;
}
