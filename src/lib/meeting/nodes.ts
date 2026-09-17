// 来源：d:\1Money\aihub\src\lib\meeting\meeting-graph.ts (拆分批次 2)
//
// 职责：MeetingGraph 的节点层。
//   包含 5 个 node 实现 + accumulateUsage 纯函数 + buildDecisionSummary 纯函数 + makeDecision 辅助函数。
//
// 拆分原则（按 04-no-bloat-refactor.mdc）：
//   - 文件级横切优先，不重写节点内部逻辑（保持行为 100% 等价）
//   - callLLMNode 等长函数的内部 step 抽取留待下批次（避免一次改动过大）
//
// 依赖：state.ts（MeetingContext）、types.ts、chatLC、calculateCost、logger
//
// 过期条件：
//   - LangGraph node API 变更 → 同步调整签名
//   - chatLC / calculateCost 签名变化 → 同步调用

import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { chatLC } from '../../lib/ai/langchain-adapter';
import { calculateCost } from '../ai/pricing';
import { logger } from '../observability/logger';
import type { MeetingState, ParticipantConfig, TranscriptEntry } from './types';
import { MAX_MEETING_ROUNDS, DEFAULT_DECISION_MODEL } from './types';
import type { MeetingContext } from './state';
import type { ChatMessage } from '../ai/router';

// ─── Usage 累加 ──────────────────────────────────────────────────────────────

/**
 * 累加单次 chatLC 调用产生的 usage 到 MeetingState.usageTotal。
 * 2026-09-17 Bug2 修复：替换 chatLC 内部 recordUsage，改在 router 层一次性聚合。
 */
export function accumulateUsage(
  prev: MeetingState['usageTotal'],
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): MeetingState['usageTotal'] {
  const base = prev ?? { inputTokens: 0, outputTokens: 0, costByModel: {} };
  const cost = calculateCost(modelName, inputTokens, outputTokens, 0);
  return {
    inputTokens: base.inputTokens + inputTokens,
    outputTokens: base.outputTokens + outputTokens,
    costByModel: {
      ...base.costByModel,
      [modelName]: (base.costByModel[modelName] ?? 0) + cost,
    },
  };
}

// ─── Node 实现 ─────────────────────────────────────────────────────────────

/**
 * nextSpeaker — 同步节点
 *
 * 职责：根据 currentIndex 取出当前参与者配置。
 * 副作用：无（纯函数，仅更新 state.currentParticipant）
 */
export function nextSpeakerNode(state: MeetingState): Partial<MeetingState> {
  const participant = state.participants[state.currentIndex];

  if (!participant) {
    // 防御：索引越界时直接结束（理论上不会发生，因为 decideContinue 会重置 index）
    logger.warn('[meeting-graph] nextSpeaker: participant not found', {
      currentIndex: state.currentIndex,
      total: state.participants.length,
    });
    return { currentParticipant: undefined };
  }

  return { currentParticipant: participant };
}

/**
 * callLLM — 异步节点（核心）
 *
 * 职责（拆分后）：
 * - 前置守卫：缺 currentParticipant / tenantId 时早返回
 * - 调用 4 个 helper：buildPriorSpeeches / buildCallLLMMessages / invokeAndAccumulate / buildErrorFallback
 *
 * 拆分动机（2026-09-18）：
 *   原 127 行超 50 行上限 2.5x，混合 6 步骤职责。
 *   现按 Extract Function 模式抽 4 个子函数，主节点 ≤ 50 行。
 */
export async function callLLMNode(
  state: MeetingState,
  config: LangGraphRunnableConfig
): Promise<Partial<MeetingState>> {
  const p = state.currentParticipant;
  if (!p) {
    // 没有 currentParticipant，理论上不该发生
    logger.warn('[meeting-graph] callLLM: no currentParticipant');
    return { transcripts: state.transcripts };
  }

  // 从 configurable 读取 tenantId
  const tenantId = (config.configurable as MeetingContext | undefined)?.tenantId;
  if (!tenantId) {
    logger.warn('[meeting-graph] callLLM: missing tenantId in config');
    return {
      transcripts: state.transcripts,
      errors: [...state.errors, 'callLLM: missing tenantId'],
    };
  }

  // ── 构造上下文 + 调用 LLM ────────────────────────────
  const priorSpeeches = buildPriorSpeeches(state);
  const messages = buildCallLLMMessages(p, state, priorSpeeches);

  try {
    return await invokeAndAccumulate(p, state, tenantId, messages);
  } catch (err) {
    return buildErrorFallback(p, state, (err as Error).message);
  }
}

// ─── callLLMNode 子函数 ────────────────────────────────────────────────

/**
 * buildPriorSpeeches — 把 state.transcripts 渲染成「之前所有发言」纯文本。
 *
 * 用于传给当前发言者作为「上下文」参考。Bug1 修复：用 participants.find() 把 pid 映射到 role。
 *
 * 导出供测试使用（生产代码应通过 callLLMNode 调用）。
 */
export function buildPriorSpeeches(state: MeetingState): string {
  return Object.entries(state.transcripts)
    .map(([pid, entries]) => {
      const participant = state.participants.find((pp) => pp.id === pid);
      const role = participant?.role ?? pid;
      const content = entries.map((e) => e.content).join('\n\n');
      return `【${role}】\n${content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * buildCallLLMMessages — 构造 chatLC() 用的 system + user messages。
 *
 * 分支：priorSpeeches 为空（第一个发言者）时用简化 prompt。
 *
 * 导出供测试使用。
 */
export function buildCallLLMMessages(
  p: ParticipantConfig,
  state: MeetingState,
  priorSpeeches: string,
): ChatMessage[] {
  const systemContent = p.systemPrompt;
  const userContent = priorSpeeches
    ? `会议主题：${state.topic}\n\n目前所有参与者的发言：\n\n${priorSpeeches}\n\n你作为 ${p.role}，请基于以上内容，给出你的专业观点（200-400 字）。`
    : `会议主题：${state.topic}\n\n你是第一个发言者（${p.role}），请给出你的专业观点（200-400 字）。`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

/**
 * invokeAndAccumulate — try 分支：调 LLM → 追加 transcript → 累加 usage。
 *
 * 失败时 throw，由 callLLMNode 的 catch 转给 buildErrorFallback。
 */
async function invokeAndAccumulate(
  p: ParticipantConfig,
  state: MeetingState,
  tenantId: string,
  messages: ChatMessage[],
): Promise<Partial<MeetingState>> {
  const result = await chatLC(p.model, tenantId, messages, {
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    // Bug2 修复：由 runMultiTurn mutation 按 meeting 语义聚合 recordUsage
    skipUsage: true,
  });

  // 构造发言记录
  const entry: TranscriptEntry = {
    role: 'assistant',
    content: result.content,
    model: p.model,
    speaker: p.role,
    timestamp: new Date().toISOString(),
  };

  // 更新 transcripts（追加到该 participant）
  const existingEntries = state.transcripts[p.id] ?? [];
  const newTranscripts: Record<string, TranscriptEntry[]> = {
    ...state.transcripts,
    [p.id]: [...existingEntries, entry],
  };

  logger.debug('[meeting-graph] callLLM completed', {
    participantId: p.id,
    role: p.role,
    model: p.model,
    contentLen: result.content.length,
    round: state.round,
    entryCount: newTranscripts[p.id].length,
    usage: result.usage,
  });

  // Bug2 修复：累加 usage 到 state（最终由 router 层一次性 recordUsage）
  const usageTotal = accumulateUsage(
    state.usageTotal,
    p.model,
    result.usage.input,
    result.usage.output,
  );

  return { transcripts: newTranscripts, usageTotal };
}

/**
 * buildErrorFallback — catch 分支：写错误占位条目 + 累加 errors。
 *
 * 导出供测试使用。
 */
export function buildErrorFallback(
  p: ParticipantConfig,
  state: MeetingState,
  errorMsg: string,
): Partial<MeetingState> {
  logger.warn('[meeting-graph] callLLM failed', {
    participantId: p.id,
    role: p.role,
    model: p.model,
    error: errorMsg,
    round: state.round,
  });

  const errorEntry: TranscriptEntry = {
    role: 'assistant',
    content: `[发言失败] ${errorMsg}`,
    model: p.model,
    speaker: p.role,
    timestamp: new Date().toISOString(),
  };

  return {
    transcripts: {
      ...state.transcripts,
      [p.id]: [...(state.transcripts[p.id] ?? []), errorEntry],
    },
    errors: [...state.errors, `${p.role}: ${errorMsg}`],
  };
}

/**
 * decideContinue — 异步节点（决策核心）
 *
 * 职责：判断是否继续下一轮。
 *
 * 三种情形：
 * 1. 本轮还有其他人没发言 → 继续下一位（更新 currentIndex）
 * 2. 本轮所有人都发完，但 round < MAX → 用 LLM 判断是否继续
 * 3. 达到 MAX_ROUNDS → 强制结束
 */
export async function decideContinueNode(
  state: MeetingState,
  config: LangGraphRunnableConfig
): Promise<Partial<MeetingState>> {
  const nextIndex = state.currentIndex + 1;
  const totalParticipants = state.participants.length;

  // ── 情形 1：本轮还有其他人 ──────────────────────────────
  if (nextIndex < totalParticipants) {
    return {
      currentIndex: nextIndex,
      continueMeeting: true,
    };
  }

  // ── 情形 2：本轮结束，判断是否继续下一轮 ─────────────────
  // 从 configurable 读取 ctx（包括 maxRounds）
  const ctx = (config.configurable as Partial<MeetingContext>) ?? {};
  // Bug5 修复：用户指定的 maxRounds 优先（不能超过硬上限 MAX_MEETING_ROUNDS）
  const effectiveMaxRounds = Math.min(
    ctx.maxRounds ?? MAX_MEETING_ROUNDS,
    MAX_MEETING_ROUNDS,
  );

  if (state.round >= effectiveMaxRounds) {
    // 达到最大轮数，强制结束
    logger.debug('[meeting-graph] decideContinue: hit maxRounds, forcing DONE', {
      round: state.round,
      maxRounds: effectiveMaxRounds,
    });
    return { continueMeeting: false };
  }

  // 从 configurable 读取 tenantId / decisionModel
  const ctx2 = (config.configurable as Partial<MeetingContext>) ?? {};
  const tenantId = ctx2.tenantId;
  if (!tenantId) {
    logger.warn('[meeting-graph] decideContinue: missing tenantId, defaulting to DONE');
    return { continueMeeting: false };
  }
  const decisionModel = ctx2.decisionModel ?? DEFAULT_DECISION_MODEL;
  const decisionTemp = 0;

  try {
    const decisionResult = await makeDecision(
      state.topic,
      state.round,
      state.participants.length,
      state.transcripts,
      state.participants,
      decisionModel,
      tenantId,
      decisionTemp
    );

    // Bug2 修复：累加决策模型的 usage
    const usageTotal = accumulateUsage(
      state.usageTotal,
      decisionModel,
      decisionResult.usage.input,
      decisionResult.usage.output,
    );

    if (decisionResult.decision === 'CONTINUE') {
      // 开始下一轮
      logger.debug('[meeting-graph] decideContinue: CONTINUE', {
        round: state.round,
        nextRound: state.round + 1,
      });
      return {
        currentIndex: 0,
        round: state.round + 1,
        continueMeeting: true,
        usageTotal,
      };
    }

    logger.debug('[meeting-graph] decideContinue: DONE', { round: state.round });
    return { continueMeeting: false, usageTotal };

  } catch (err) {
    // 决策 LLM 调用失败 → 默认结束（保守策略：避免无限循环）
    logger.warn('[meeting-graph] decideContinue LLM failed, defaulting to DONE', {
      error: (err as Error).message,
      round: state.round,
    });
    return { continueMeeting: false };
  }
}

/**
 * buildDecisionSummary — 构造决策 prompt 的「各参与者本轮观点摘要」段落。
 *
 * 设计动机（Bug1 修复 2026-09-17）：
 *   原代码用 pid (uuid) 代替 role，决策模型无法分辨发言者。
 *   现抽成独立纯函数，便于单测 + 用 participants 映射查 role。
 *
 * @param participants 参与者配置列表（用于 pid → role 映射）
 * @param transcripts  当前 transcripts（pid → 发言数组）
 * @returns            多行字符串，每行 `${role}: 发言摘要`
 */
export function buildDecisionSummary(
  participants: ParticipantConfig[],
  transcripts: Record<string, TranscriptEntry[]>
): string {
  return Object.entries(transcripts)
    .map(([pid, entries]) => {
      const latestEntry = entries[entries.length - 1];
      const participant = participants.find((pp) => pp.id === pid);
      const role = participant?.role ?? pid;
      return `${role}: ${latestEntry?.content.slice(0, 150) ?? ''}`;
    })
    .join('\n');
}

/**
 * makeDecision — 调用决策模型判断是否继续
 *
 * 用便宜的 flash 模型判断（默认 glm-4-flash）
 */
async function makeDecision(
  topic: string,
  round: number,
  totalParticipants: number,
  transcripts: Record<string, TranscriptEntry[]>,
  participants: ParticipantConfig[],
  model: string,
  tenantId: string,
  temperature: number
): Promise<{ decision: 'CONTINUE' | 'DONE'; usage: { input: number; output: number } }> {
  // 修复 Bug1：使用 participants 映射 pid → role，让决策模型能正确分辨发言者
  const summary = buildDecisionSummary(participants, transcripts);

  const promptText = `会议主题：${topic}
当前第 ${round} 轮结束，共 ${totalParticipants} 位参与者已发言。

各参与者本轮观点摘要：
${summary}

请判断：是否需要再进行一轮深入讨论（让参与者互相回应分歧）？

请输出：
- "CONTINUE"：如果讨论还不够深入，需要更多轮次
- "DONE"：如果已有足够共识/分歧，可以汇总

只输出一个词（CONTINUE 或 DONE）。`;

  // 用 chatLC（统一走 LangChain 路径，保持多租户/dev mock 一致性）
  const messages = [
    {
      role: 'system' as const,
      content: '你是一个客观的会议主持人，判断是否需要更多讨论。',
    },
    { role: 'user' as const, content: promptText },
  ];

  // Bug2 修复：返回 decision + usage 双结果，让 decideContinue 累加到 state.usageTotal
  const { content, usage } = await chatLC(model, tenantId, messages, {
    temperature,
    maxTokens: 10, // 只需要一个词
    // Bug2 修复：决策模型也算 meeting 的一部分
    skipUsage: true,
  });

  const normalized = content.trim().toUpperCase();

  logger.debug('[meeting-graph] decision made', {
    round,
    decision: normalized,
    model,
    usage,
  });

  return {
    decision: normalized.includes('CONTINUE') ? 'CONTINUE' : 'DONE',
    usage,
  };
}

/**
 * conclude — 异步节点
 *
 * 职责：调用主持人模型，汇总所有轮次的发言，生成结构化纪要。
 */
export async function concludeNode(
  state: MeetingState,
  config: LangGraphRunnableConfig
): Promise<Partial<MeetingState>> {
  const ctx = (config.configurable as Partial<MeetingContext>) ?? {};
  const tenantId = ctx.tenantId;
  const hostModel = ctx.hostModel;
  // Bug4 修复：与 catch 分支一致，缺失 ctx 时也写入 errors
  if (!tenantId || !hostModel) {
    const msg = `conclude: missing ${!tenantId ? 'tenantId' : 'hostModel'}`;
    logger.error('[meeting-graph] ' + msg);
    return {
      conclusion: `[会议纪要生成失败] ${msg}\n\n请手动查看上方所有发言记录。`,
      errors: [...state.errors, msg],
    };
  }

  // ── Step 1: 收集所有发言 ────────────────────────────────
  const allSpeeches = state.participants
    .map((p) => {
      const entries = state.transcripts[p.id] ?? [];
      const content = entries.map((e) => e.content).join('\n\n---\n\n');
      return `【${p.role}（${p.model}）】\n${content}`;
    })
    .join('\n\n═══════════════════════════════\n\n');

  // ── Step 2: 构造主持人消息 ──────────────────────────────
  const systemContent = `你是会议主持人。请基于所有参与者的发言，生成一份结构化会议纪要，必须包含以下三部分：

1. 核心共识：所有参与者都认同的观点
2. 主要分歧：参与者之间存在争议的点
3. 可执行的下一步建议：基于讨论的具体行动项

要求：客观中立、不偏袒任何一方。`;

  const userContent = `会议主题：${state.topic}

所有发言（共 ${state.round} 轮 ${Object.values(state.transcripts).flat().length} 条）：

${allSpeeches}`;

  const messages = [
    { role: 'system' as const, content: systemContent },
    { role: 'user' as const, content: userContent },
  ];

  // ── Step 3: 调用主持人模型 ─────────────────────────────
  try {
    const result = await chatLC(hostModel, tenantId, messages, {
      temperature: 0.5, // 主持人不需要太有创意
      maxTokens: 1500, // 会议纪要约 500-1000 字
      // Bug2 修复：主持人 conclusion 也是 meeting 的一部分
      skipUsage: true,
    });

    logger.info('[meeting-graph] meeting concluded', {
      topic: state.topic,
      totalRounds: state.round,
      totalEntries: Object.values(state.transcripts).flat().length,
      conclusionLen: result.content.length,
      usage: result.usage,
    });

    // Bug2 修复：累加主持人 usage 到 state
    const usageTotal = accumulateUsage(
      state.usageTotal,
      hostModel,
      result.usage.input,
      result.usage.output,
    );

    return { conclusion: result.content, usageTotal };

  } catch (err) {
    // 主持人调用失败 → 生成占位结论 + 写入 errors
    // Bug4 修复：把错误计入 state.errors，router 层据此决定不写 COMPLETED。
    const errorMsg = (err as Error).message;

    logger.error('[meeting-graph] conclude failed', {
      topic: state.topic,
      error: errorMsg,
    });

    return {
      conclusion: `[会议纪要生成失败] ${errorMsg}\n\n请手动查看上方所有发言记录。`,
      errors: [...state.errors, `conclude: ${errorMsg}`],
    };
  }
}
