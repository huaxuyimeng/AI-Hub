// 来源：d:\1Money\aihub\src\lib\ai\langchain-adapter.ts (拆分批次 2)
//
// 职责：捕获 LangChain LLM 真实 token usage 的 callback + 解析器。
//
// 字段映射（不同 provider 的 usage 字段名不同，统一为 input/output）：
//   - OpenAI 兼容（OpenAI / DeepSeek / Zhipu / Ollama / Qwen / MiniMax）：
//     llmOutput.tokenUsage = { promptTokens, completionTokens, totalTokens }
//   - Anthropic：
//     llmOutput.usage = { input_tokens, output_tokens }
//     response_metadata.usage = { input_tokens, output_tokens }
//   - Gemini：直接走 SDK（不通过 callback）
//
// 依赖：BaseCallbackHandler（@langchain/core）、LLMResult 类型、logger
//
// 过期条件：
//   - LangChain 0.3 → 1.x callback API 变更 → handleLLMEnd 签名调整
//   - 新增 provider 类型 → parseLLMUsage 新增字段提取分支

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import { logger } from '../../observability/logger';

/**
 * UsageCallbackHandler — 拦截 LLM 响应，捕获真实 token usage。
 *
 * 设计动机（2026-09-17 优化）：
 *   StringOutputParser 会丢失原始 AIMessage（含 usage_metadata）。
 *   通过 callback 在 handleLLMEnd 阶段直接读 tokenUsage，零侵入。
 *
 * 使用方式：
 *   const handler = new UsageCallbackHandler();
 *   await chain.invoke({ input }, { callbacks: [handler] });
 *   const usage = handler.getUsage(); // { input, output }
 */
export class UsageCallbackHandler extends BaseCallbackHandler {
  name = 'UsageCallbackHandler';

  private _usage: { input: number; output: number } | null = null;

  /** 读出捕获到的 usage（无则返回 null，调用方应 fallback 到估算） */
  getUsage(): { input: number; output: number } | null {
    return this._usage;
  }

  /** LLM 调用结束回调 */
  override async handleLLMEnd(output: LLMResult): Promise<void> {
    try {
      const parsed = parseLLMUsage(output);
      if (parsed) {
        this._usage = parsed;
      }
    } catch (err) {
      // 解析失败不抛错（callback 静默失败原则）
      logger.debug('[chatLC] UsageCallbackHandler: parse failed', {
        error: (err as Error).message,
      });
    }
  }
}

/**
 * 从 LangChain LLMResult 提取标准 usage { input, output }。
 *
 * 三种 provider 的 usage 位置（实测 2026-09-17）：
 *   - output.llmOutput?.tokenUsage   ← OpenAI 兼容（OpenAI / DeepSeek / Zhipu 等）
 *   - output.llmOutput?.usage        ← Anthropic
 *   - output.generations[0][0].message.usage_metadata  ← AIMessage 上的 usage_metadata
 *
 * 优先级：tokenUsage > llmOutput.usage > message.usage_metadata > response_metadata.usage
 */
export function parseLLMUsage(output: LLMResult): { input: number; output: number } | null {
  const llmOutput = output.llmOutput as Record<string, unknown> | undefined;

  // 1) OpenAI 兼容路径：llmOutput.tokenUsage
  const tokenUsage = llmOutput?.tokenUsage as Record<string, number> | undefined;
  if (tokenUsage) {
    const input = tokenUsage.promptTokens ?? tokenUsage.input_tokens ?? 0;
    const out = tokenUsage.completionTokens ?? tokenUsage.output_tokens ?? 0;
    if (input > 0 || out > 0) {
      return { input, output: out };
    }
  }

  // 2) Anthropic 路径：llmOutput.usage
  const anthropicUsage = llmOutput?.usage as Record<string, number> | undefined;
  if (anthropicUsage) {
    const input = anthropicUsage.input_tokens ?? 0;
    const out = anthropicUsage.output_tokens ?? 0;
    if (input > 0 || out > 0) {
      return { input, output: out };
    }
  }

  // 3) AIMessage.usage_metadata（部分 provider 走这里）
  const generations = output.generations?.[0];
  const firstGen = generations?.[0] as { message?: { usage_metadata?: Record<string, number> } } | undefined;
  const usageMetadata = firstGen?.message?.usage_metadata;
  if (usageMetadata) {
    const input = usageMetadata.input_tokens ?? 0;
    const out = usageMetadata.output_tokens ?? 0;
    if (input > 0 || out > 0) {
      return { input, output: out };
    }
  }

  // 4) response_metadata.usage（Anthropic 备选位置）
  const responseMetadata = firstGen?.message as unknown as { response_metadata?: { usage?: Record<string, number> } } | undefined;
  const responseUsage = responseMetadata?.response_metadata?.usage;
  if (responseUsage) {
    const input = responseUsage.input_tokens ?? 0;
    const out = responseUsage.output_tokens ?? 0;
    if (input > 0 || out > 0) {
      return { input, output: out };
    }
  }

  return null;
}
