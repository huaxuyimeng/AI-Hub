// 来源：d:\1Money\aihub\src\lib\ai\langchain-adapter.ts (拆分批次 5 — 入口)
//
// 职责：langchain-adapter 模块的公共 API 入口。
//   - re-export 所有公开 API
//   - 旧 import 路径 '@lib/ai/langchain-adapter' 通过 shim 文件兼容
//
// 过期条件：
//   - 旧 shim 文件完全无引用 → 删除

// 公共 API
export { chatLC, recordUsageIfNeeded } from './chatLC';
export { UsageCallbackHandler, parseLLMUsage } from './usage-callback';
export { estimateTokens, mergeMessages } from './utils';
export { chatViaLC, lcelChatOpenAI, lcelChatAnthropic, sdkChatGemini } from './protocols';
