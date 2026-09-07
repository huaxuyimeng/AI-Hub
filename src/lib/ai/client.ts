// 来源：设计/AI集成.md §三 LiteLLM 路由（已弃用）
// 决策 scope-C：替换 LiteLLM 为直连 Provider（src/lib/ai/router.ts）
// 2026-09-02 R-2 修复：dev 不依赖 LiteLLM proxy，提供 deepseek 直连
//
// 当前状态：保留 litellm / deepseek 占位导出 + ChatMessage 类型，
//          让旧调用方（news/intent-search.ts 等）继续编译。
// Phase 2.6/2.7 会彻底替换这些调用方；Phase 2.9 删除本文件。

import OpenAI from 'openai';

// DeepSeek API（dev 直连，绕过 LiteLLM proxy）
// ⚠️ 此处仅作为"兜底兜底"占位 —— 真正调用请用 src/lib/ai/router.ts 的 chat()
export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? 'sk-placeholder',
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
});

/**
 * LiteLLM proxy 客户端（已弃用，逐步迁移到 src/lib/ai/router.ts 的 chat()）
 *
 * ⚠️ Phase 2.6/2.7/2.9 会彻底替换所有 litellm 调用方。
 * 暂时保留此实例，避免编译失败。
 */
export const litellm = new OpenAI({
  apiKey: process.env.LITELLM_API_KEY ?? 'anything',
  baseURL: process.env.LITELLM_BASE_URL ?? 'http://localhost:4000/v1',
});

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};