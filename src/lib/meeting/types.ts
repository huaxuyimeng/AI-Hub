// 来源：docs/AI模块/langchain接入/04-Phase2-MeetingGraph实现.md
//
// 职责：MeetingGraph 的 TypeScript 类型定义。
// 所有 MeetingGraph 相关的类型集中在此，不与 meeting router 共享。
//
// 约束：
// - 仅供 meeting-graph.ts 使用（独立演进）
// - 不引用 Prisma 类型（保持纯 TS，便于测试时 mock）
//
// 过期条件：
//   - LangGraph Annotation API 重大变更（升级到 1.x）→ 调整 reducer 签名
//   - TranscriptEntry shape 变化 → meeting.ts 的 get query 也要改

// ─── Participant ────────────────────────────────────────────────────────────

/**
 * 参与者在会议中的配置。
 * 从 MeetingParticipant DB model 映射而来。
 */
export interface ParticipantConfig {
  /** MeetingParticipant.id */
  id: string;

  /** 角色名（pm / engineer / critic / summarizer 等） */
  role: string;

  /** 模型名（deepseek-flash / claude-sonnet-4-5 / gpt-4o-mini） */
  model: string;

  /** system prompt */
  systemPrompt: string;

  /** 发言最大 token 数 */
  maxTokens: number;

  /** 温度 */
  temperature: number;
}

// ─── Transcript ─────────────────────────────────────────────────────────────

/**
 * 单条发言记录。
 * 对应 Prisma MeetingParticipant.transcript JSON 字段中的条目。
 *
 * 兼容现有 transcript 格式：role / content / model / speaker? / timestamp
 */
export interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  model: string;
  /** 发言者角色（仅 assistant 有） */
  speaker?: string;
  timestamp: string;
}

// ─── MeetingState ────────────────────────────────────────────────────────────

/**
 * LangGraph StateGraph 的状态类型。
 *
 * 设计原则：
 * - 所有字段必须可序列化（跨 node 传递）
 * - 复杂对象用 Record/Array 表示
 * - 不包含 Prisma 引用（纯 TS）
 *
 * 字段分类：
 * - 初始化时传入（不变）：topic / participants
 * - 中间状态（每轮更新）：transcripts / currentIndex / round
 * - 运行时状态（node 间传递）：currentParticipant
 * - 输出状态：conclusion / errors
 */
export interface MeetingState {
  /** 会议主题 */
  topic: string;

  /** 参与者配置（按发言顺序排列） */
  participants: ParticipantConfig[];

  /** participantId → 发言记录数组 */
  transcripts: Record<string, TranscriptEntry[]>;

  /** 当前轮中，正在发言的参与者的 index */
  currentIndex: number;

  /** 当前第几轮（1-based） */
  round: number;

  /** 当前轮到谁（运行时，非序列化） */
  currentParticipant?: ParticipantConfig;

  /** 是否继续下一轮（由 decideContinueNode 返回，conditional edge 读取） */
  continueMeeting?: boolean;

  /** 最终结论（仅在 concludeNode 完成后有值） */
  conclusion?: string;

  /** 错误记录 */
  errors: string[];

  /**
   * 累计 usage（运行时，不写 DB）。由 callLLMNode / makeDecision / concludeNode
   * 累加；runMeetingGraph 结束后读出供 recordUsage(kind: 'meeting') 使用。
   * 2026-09-17 Bug2 修复引入。
   */
  usageTotal?: {
    inputTokens: number;
    outputTokens: number;
    /** 按 model 分组的 cost（calculateCost 输出） */
    costByModel: Record<string, number>;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * 多轮最大轮数上限（防止无限循环）。
 * 用户可在 UI 设 1-5，但实际硬上限为 3（避免成本失控）。
 */
export const MAX_MEETING_ROUNDS = 3;

/** 每轮最大发言 token 数（兜底，防止过长输出） */
export const DEFAULT_MAX_TOKENS = 600;

/** 默认温度 */
export const DEFAULT_TEMPERATURE = 0.7;

/** 默认决策模型（用于 decideContinue LLM 判断，配置便宜的 flash 模型） */
export const DEFAULT_DECISION_MODEL = 'glm-4-7-flash';
