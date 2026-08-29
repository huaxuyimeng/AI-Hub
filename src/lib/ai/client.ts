// 来源：d:\1Money\design\AI集成.md §三 LiteLLM 路由 + §四 模型选择
// 批次 B8：模型名迁移到当前可用版本（K2→K2.7-code、DeepSeek V3→V4）
// 批次 C25：删除 anthropic 死代码（MVP 阶段全部走 LiteLLM，Anthropic 直连 client 未被引用）

import OpenAI from 'openai';

/**
 * LiteLLM 通过 OpenAI 兼容协议暴露多模型路由
 * 客户端只需配置 baseURL，无需关心具体 provider
 */
export const litellm = new OpenAI({
  apiKey: 'anything',  // LiteLLM 自身鉴权
  baseURL: process.env.LITELLM_BASE_URL ?? 'http://localhost:4000/v1',
});

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};