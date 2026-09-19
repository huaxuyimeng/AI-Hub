// 来源：d:\1Money\aihub\src\lib\ai\langchain-stream.ts (拆分) + docs/03c-Phase1.5
//
// 职责：chatLCStream 的协议分发 + 3 个 provider 的流式实现。
//   - streamViaLC：根据 protocol 分发
//   - lcelStreamOpenAI：OpenAI 兼容（OpenAI / DeepSeek / Zhipu / Ollama / Qwen / MiniMax）
//   - lcelStreamAnthropic：Anthropic 专用
//   - sdkStreamGemini：Gemini（保留现有 SDK 的 stream API）
//
// 依赖：LangChain ChatOpenAI / ChatAnthropic，usage-callback 的 UsageCallbackHandler，
//       GoogleGenerativeAI（动态 import）
//
// 过期条件：
//   - 新增 Provider 类型 → 在 streamViaLC 中新增分支
//   - LangChain 0.3 → 1.x → 调整 .stream() / callback 行为

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import type { ChatMessage, ChatOptions } from '../router';
import { logger } from '../../observability/logger';
import { UsageCallbackHandler } from '../langchain-adapter/usage-callback';
import type { ChatChunk } from '../langchain-stream';

/** 模型元数据（从 SupportedModel 截取的子集，避免循环依赖） */
type SupportedModelSubset = {
  name: string;
  provider: string;
  displayName: string;
};

// ─── 协议分发 ─────────────────────────────────────────────────────────────

/**
 * 根据 protocol 分发到对应的流式实现。
 *
 * @param protocol    'openai' | 'anthropic' | 'gemini'
 * @param supported   模型元数据
 * @param apiKey      多租户解析后的明文 key
 * @param baseUrl     provider baseUrl（Gemini 可忽略）
 * @param messages    消息数组
 * @param options     含 signal 的扩展 options
 * @param t0          起始时间（用于日志）
 */
export async function* streamViaLC(
  protocol: 'openai' | 'anthropic' | 'gemini',
  supported: SupportedModelSubset,
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  options: ChatOptions & { signal?: AbortSignal },
  t0: number
): AsyncGenerator<ChatChunk, void, undefined> {
  if (protocol === 'openai') {
    yield* lcelStreamOpenAI(supported, apiKey, baseUrl, messages, options, t0);
    return;
  }
  if (protocol === 'anthropic') {
    yield* lcelStreamAnthropic(supported, apiKey, messages, options, t0);
    return;
  }
  if (protocol === 'gemini') {
    yield* sdkStreamGemini(supported, apiKey, messages, options, t0);
    return;
  }

  yield {
    type: 'error',
    error: { message: `[chatLCStream] Unsupported protocol: ${protocol}` },
  };
  yield { type: 'done', done: true };
}

// ─── OpenAI 兼容流式 ────────────────────────────────────────────────────────

/**
 * OpenAI 兼容协议的 LCEL 流式 chain。
 *
 * 实现细节：
 *   1. ChatOpenAI 配置 streaming: true
 *   2. DeepSeek thinking 走 .bind() 透传
 *   3. 用 chain.stream() 而非 chain.invoke()
 *   4. UsageCallbackHandler 在流末尾捕获真实 token
 *
 * 主体走 LCEL 公共骨架 streamLcelChain（仅 provider 特定部分：构造 chatModel）。
 *
 * 导出：仅供 langchain-stream/index.ts 公开 re-export（不建议业务直接调用）
 */
export async function* lcelStreamOpenAI(
  supported: SupportedModelSubset,
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  options: ChatOptions & { signal?: AbortSignal },
  t0: number
): AsyncGenerator<ChatChunk, void, undefined> {
  const isDeepSeek = baseUrl.includes('api.deepseek.com');
  const useThinking = options.thinking ?? isDeepSeek;
  const effectiveTemp = useThinking ? undefined : (options.temperature ?? 0.7);

  // baseURL 在 0.3.x 的 ChatOpenAIFields 类型里被省略（实际存在），用 unknown 绕过
  const chatModelCtor = ChatOpenAI as unknown as new (opts: Record<string, unknown>) => ChatOpenAI;
  const chatModel = new chatModelCtor({
    model: supported.name,
    apiKey,
    baseURL: baseUrl,
    ...(effectiveTemp !== undefined ? { temperature: effectiveTemp } : {}),
    maxTokens: options.maxTokens ?? 2000,
    streaming: true, // ⚠️ 关键：开启流式
  });

  // DeepSeek thinking: 单独走带 thinking 的 chain（不走公共骨架的简化模式）
  if (useThinking && isDeepSeek) {
    const bindable = chatModel as unknown as {
      bind: (opts: Record<string, unknown>) => typeof chatModel;
    };
    const bound = bindable.bind({
      reasoning_effort: options.reasoningEffort ?? 'high',
      thinking: { type: 'enabled' as const },
    });
    yield* streamLcelChain(supported, bound, messages, options, t0, 'OpenAI');
    return;
  }

  yield* streamLcelChain(supported, chatModel, messages, options, t0, 'OpenAI');
}

// ─── Anthropic 流式 ─────────────────────────────────────────────────────────

/**
 * Anthropic 专用协议的流式实现。
 *
 * Anthropic 的 streaming 与 OpenAI 类似：底层用 SSE，LangChain 通过 .stream() 暴露。
 * 主体走公共骨架 streamLcelChain。
 *
 * 导出：仅供 langchain-stream/index.ts 公开 re-export
 */
export async function* lcelStreamAnthropic(
  supported: SupportedModelSubset,
  apiKey: string,
  messages: ChatMessage[],
  options: ChatOptions & { signal?: AbortSignal },
  t0: number
): AsyncGenerator<ChatChunk, void, undefined> {
  const chatModel = new ChatAnthropic({
    anthropicApiKey: apiKey,
    model: supported.name,
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens ?? 4096,
  });

  yield* streamLcelChain(supported, chatModel, messages, options, t0, 'Anthropic');
}

/**
 * streamLcelChain — OpenAI / Anthropic 共用的 LCEL 流式骨架。
 *
 * 不适用的 provider（Gemini）保留独立实现。
 *
 * 职责链：
 *   1. 构造 prompt → pipe(chatModel) → pipe(parser)
 *   2. 初始化 UsageCallbackHandler
 *   3. chain.stream() 拿 AsyncIterable
 *   4. try-init 失败：abort 静默 / 其它 yield error + done + return
 *   5. for-await chunk：signal 检查 + yield text
 *   6. try-iterate 失败：同上
 *   7. yield usage + done
 *
 * @param chatModel LCEL chat model 实例（ChatOpenAI / ChatAnthropic 已经构造好）
 * @param providerName 用于日志的 provider 名
 */
async function* streamLcelChain(
  supported: SupportedModelSubset,
  chatModel: ChatOpenAI | ChatAnthropic,
  messages: ChatMessage[],
  options: ChatOptions & { signal?: AbortSignal },
  t0: number,
  providerName: 'OpenAI' | 'Anthropic',
): AsyncGenerator<ChatChunk, void, undefined> {
  const system = messages.find((m) => m.role === 'system')?.content;
  const userContent = messages
    .filter((m) => m.role !== 'system')
    .map((m) => m.content)
    .join('\n');
  const inputText = system ? `${system}\n\n${userContent}` : userContent;

  const prompt = PromptTemplate.fromTemplate('{input}');
  const parser = new StringOutputParser();
  const chain = prompt.pipe(chatModel).pipe(parser);
  const usageHandler = new UsageCallbackHandler();

  let stream: AsyncIterable<string>;
  try {
    stream = await chain.stream({ input: inputText }, {
      callbacks: [usageHandler],
      signal: options.signal,
    } as Record<string, unknown>);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.info(`[chatLCStream] ${providerName} aborted before stream start`, {
        model: supported.name,
        duration: Date.now() - t0,
      });
      return;
    }
    logger.error(`[chatLCStream] ${providerName} stream init failed`, {
      model: supported.name,
      duration: Date.now() - t0,
      error: (err as Error).message,
    });
    yield { type: 'error', error: { message: (err as Error).message } };
    yield { type: 'done', done: true };
    return;
  }

  try {
    for await (const chunk of stream) {
      if (options.signal?.aborted) {
        logger.info(`[chatLCStream] ${providerName} aborted mid-stream`, {
          model: supported.name,
          duration: Date.now() - t0,
        });
        return;
      }
      if (typeof chunk === 'string' && chunk.length > 0) {
        yield { type: 'text', delta: chunk };
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    logger.error(`[chatLCStream] ${providerName} stream iteration failed`, {
      model: supported.name,
      duration: Date.now() - t0,
      error: (err as Error).message,
    });
    yield { type: 'error', error: { message: (err as Error).message } };
    yield { type: 'done', done: true };
    return;
  }

  const realUsage = usageHandler.getUsage();
  if (realUsage && (realUsage.input > 0 || realUsage.output > 0)) {
    yield {
      type: 'usage',
      usage: {
        input: realUsage.input,
        output: realUsage.output,
        ...(realUsage.cachedInput ? { cachedInput: realUsage.cachedInput } : {}),
      },
    };
  }

  logger.debug(`[chatLCStream] ${providerName} stream completed`, {
    model: supported.name,
    duration: Date.now() - t0,
    hasUsage: !!realUsage,
  });

  yield { type: 'done', done: true };
}

// ─── Gemini SDK 流式 ───────────────────────────────────────────────────────

/**
 * Gemini SDK 的流式实现（保留 SDK，不走 LangChain）。
 *
 * 决策 D4（docs/01 §4.6）：Gemini 暂不迁移 LangChain，直接用 SDK 的 generateContentStream。
 *
 * 导出：仅供 langchain-stream/index.ts 公开 re-export
 */
export async function* sdkStreamGemini(
  supported: SupportedModelSubset,
  apiKey: string,
  messages: ChatMessage[],
  options: ChatOptions & { signal?: AbortSignal },
  t0: number
): AsyncGenerator<ChatChunk, void, undefined> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');

  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({ model: supported.name });

  const system = messages.find((m) => m.role === 'system')?.content;
  const userParts = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  if (options.signal?.aborted) {
    return;
  }

  let streamResult;
  try {
    streamResult = await genModel.generateContentStream({
      contents: userParts,
      ...(system ? { systemInstruction: system } : {}),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 4096,
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    logger.error('[chatLCStream] Gemini stream init failed', {
      model: supported.name,
      duration: Date.now() - t0,
      error: (err as Error).message,
    });
    yield { type: 'error', error: { message: (err as Error).message } };
    yield { type: 'done', done: true };
    return;
  }

  let inputTokens = 0;
  let outputTokens = 0;

  try {
    for await (const item of streamResult.stream) {
      if (options.signal?.aborted) {
        logger.info('[chatLCStream] Gemini aborted', { model: supported.name });
        return;
      }
      const text = item.text();
      if (text) {
        yield { type: 'text', delta: text };
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    logger.error('[chatLCStream] Gemini stream iteration failed', {
      model: supported.name,
      duration: Date.now() - t0,
      error: (err as Error).message,
    });
    yield { type: 'error', error: { message: (err as Error).message } };
    yield { type: 'done', done: true };
    return;
  }

  // Gemini SDK 在 stream 结束后提供 usageMetadata（通过 response）
  try {
    const response = await streamResult.response;
    inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  } catch {
    // response 解析失败不影响主流程
  }

  if (inputTokens > 0 || outputTokens > 0) {
    yield { type: 'usage', usage: { input: inputTokens, output: outputTokens } };
  }

  logger.debug('[chatLCStream] Gemini stream completed', {
    model: supported.name,
    duration: Date.now() - t0,
    inputTokens,
    outputTokens,
  });

  yield { type: 'done', done: true };
}
