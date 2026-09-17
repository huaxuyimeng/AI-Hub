// ⚠️ DEPRECATED 2026-09-18：langchain-adapter.ts 已拆分为 4 个文件
//   - ./langchain-adapter/utils.ts（estimateTokens / mergeMessages）
//   - ./langchain-adapter/usage-callback.ts（UsageCallbackHandler / parseLLMUsage）
//   - ./langchain-adapter/chatLC.ts（chatLC 入口 + recordUsageIfNeeded）
//   - ./langchain-adapter/protocols.ts（chatViaLC + 3 个 provider 路径）
//   - ./langchain-adapter/index.ts（新入口，re-export 公共 API）
//
//   本文件仅作 backward-compat shim，新代码请直接 import '@lib/ai/langchain-adapter' 或 '@lib/ai/langchain-adapter/chatLC' 等。
//   过期条件：所有调用方迁移到分文件 import 后删除此文件。

// 显式指向 ./langchain-adapter/index.ts 避免 TS bundler 解析歧义
export {
  chatLC,
  recordUsageIfNeeded,
  UsageCallbackHandler,
  parseLLMUsage,
  estimateTokens,
  mergeMessages,
  chatViaLC,
  lcelChatOpenAI,
  lcelChatAnthropic,
  sdkChatGemini,
} from './langchain-adapter/index';
