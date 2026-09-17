// ⚠️ DEPRECATED 2026-09-17：meeting-graph.ts 已拆分为 4 个文件
//   - ./state.ts（Annotation + MeetingContext）
//   - ./nodes.ts（节点实现 + 纯函数）
//   - ./graph.ts（buildMeetingGraph + runMeetingGraph）
//   - ./index.ts（新入口，re-export 所有公共 API）
//
//   本文件仅作 backward-compat shim，新代码请直接 import './graph' 等。
//   过期条件：所有调用方迁移到分文件 import 后删除此文件。

export * from './index';
