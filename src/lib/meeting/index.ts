// 来源：d:\1Money\aihub\src\lib\meeting\meeting-graph.ts (拆分批次 4 — 入口)
//
// 职责：MeetingGraph 模块的公共 API 入口。
//   - re-export 所有公开 API（向后兼容旧 import 路径 '@lib/meeting/meeting-graph'）
//   - 推荐新调用方直接 import './graph' / './nodes' / './state'
//
// 过期条件：
//   - 旧 import 路径全部下线（所有调用方迁移到分文件 import）→ 可删除此文件

// 公共 API（保持向后兼容）
export {
  buildMeetingGraph,
  runMeetingGraph,
} from './graph';

export {
  accumulateUsage,
  buildDecisionSummary,
  buildPriorSpeeches,
  buildCallLLMMessages,
  buildErrorFallback,
  callLLMNode,
  concludeNode,
  decideContinueNode,
  nextSpeakerNode,
} from './nodes';

export type { MeetingContext } from './state';

// 类型（types.ts 已经是独立文件，无需 re-export）
// export { ... } from './types';
