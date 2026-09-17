// 来源：d:\1Money\aihub\src\lib\ai\langchain-adapter.ts (拆分批次 4)
//
// 职责：协议分发 + 3 个 provider 路径的具体实现。
//   - chatViaLC：根据 protocol 分发
//   - lcelChatOpenAI：OpenAI 兼容（OpenAI / DeepSeek / Zhipu / Ollama / Qwen / MiniMax）
//   - lcelChatAnthropic：Anthropic 专用
//   - sdkChatGemini：Gemini（保留现有 SDK，不走 LangChain）
//
// 依赖：LangChain ChatOpenAI / ChatAnthropic / PromptTemplate / StringOutputParser
//       utils（mergeMessages / estimateTokens）、usage-callback（UsageCallbackHandler）
//
// 过期条件：
//   - 新增 Provider 类型 → 在 chatViaLC 中新增分支 + 新增 path 实现
//   - LangChain 0.3 → 1.x → 调整 ChatOpenAI / ChatAnthropic 构造

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import type { ChatMessage, ChatOptions, ChatResult } from '../router';
import { logger } from '../../observability/logger';
import { mergeMessages, estimateTokens } from './utils';
import { UsageCallbackHandler } from './usage-callback';

// ─── 协议分发 ─────────────────────────────────────────────────────────────

/**
 * 根据 protocol 分发到对应的 LangChain 或 SDK 实现。
 */
export async function chatViaLC(
  protocol: 'openai' | 'anthropic' | 'gemini',
  apiKey: string,
  baseUrl: string,
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  if (protocol === 'openai') {
    return lcelChatOpenAI(apiKey, baseUrl, modelName, messages, options);
  }
  if (protocol === 'anthropic') {
    return lcelChatAnthropic(apiKey, modelName, messages, options);
  }
  // Gemini 保留现状 SDK 调用（理由见文档 01 §4.6 决策 D4）
  if (protocol === 'gemini') {
    return sdkChatGemini(apiKey, baseUrl, modelName, messages, options);
  }

  throw new Error(`[chatLC] Unsupported protocol: ${protocol}`);
}

// ─── OpenAI 兼容路径（LCEL chain）─────────────────────────────────────────

/**
 * OpenAI 兼容协议的 LCEL chain 实现。
 *
 * 支持：
 * - 基础 OpenAI 兼容（openai / zhipu / ollama / qwen / minimax）
 * - DeepSeek thinking 模式（.bind() 透传 reasoning_effort + thinking.type）
 * - temperature / maxTokens 配置
 * - baseURL 自定义（支持代理/内网）
 */
export async function lcelChatOpenAI(
  apiKey: string,
  baseUrl: string,
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const isDeepSeek = baseUrl.includes('api.deepseek.com');
  const useThinking = options.thinking ?? isDeepSeek;
  // DeepSeek thinking 模式下 temperature 必须传 undefined（官方要求）
  const effectiveTemp = useThinking ? undefined : (options.temperature ?? 0.7);

  // ── Step 1: 构造 ChatOpenAI ─────────────────────────────────────
  // baseURL 在 0.3.x 的 ChatOpenAIFields 类型里被省略（实际存在），
  // 这里用 unknown 绕过类型检查，让 openai SDK 透传到底层 HTTP client。
  const chatModelCtor = ChatOpenAI as unknown as new (opts: Record<string, unknown>) => ChatOpenAI;
  const chatModel = new chatModelCtor({
    model: modelName,
    apiKey,
    baseURL: baseUrl,
    ...(effectiveTemp !== undefined ? { temperature: effectiveTemp } : {}),
    maxTokens: options.maxTokens ?? 2000,
    // LangChain 的 streaming 默认关闭，Phase 2 流式时才开
  });

  // ── Step 2: DeepSeek thinking 模式（via .bind()）────────────────
  // DeepSeek 要求 extra_body.reasoning_effort + extra_body.thinking.type
  // LangChain ChatOpenAI 支持 .bind() 透传任意参数
  let callable = chatModel;

  if (useThinking && isDeepSeek) {
    // 类型体操：LangChain 的 bind() 有严格类型，DeepSeek 字段不在标准类型里
    // 用 as 绕过类型检查（运行时由 SDK 转发到 OpenAI 兼容端点）
    const bindable = chatModel as unknown as {
      bind: (opts: Record<string, unknown>) => typeof chatModel;
    };
    callable = bindable.bind({
      reasoning_effort: options.reasoningEffort ?? 'high',
      thinking: { type: 'enabled' as const },
    });
  }

  // ── Step 3: 构造 LCEL chain ─────────────────────────────────────
  // system prompt + user content 合并为单个 {input} 变量
  // Phase 1 简化：PromptTemplate 单变量；Phase 2 可升级为 ChatPromptTemplate + MessagesPlaceholder
  const { system, user } = mergeMessages(messages);
  const inputText = system ? `${system}\n\n${user}` : user;

  const prompt = PromptTemplate.fromTemplate('{input}');
  const parser = new StringOutputParser();
  const chain = prompt.pipe(callable).pipe(parser);

  // ── Step 4: 执行链（附带 UsageCallbackHandler 捕获真实 token）───
  const usageHandler = new UsageCallbackHandler();
  const t0 = Date.now();

  let content: string;
  try {
    content = await chain.invoke({ input: inputText }, { callbacks: [usageHandler] });
  } catch (err) {
    logger.error('[chatLC] LCEL chain failed', {
      model: modelName,
      provider: isDeepSeek ? 'deepseek' : 'openai-compatible',
      duration: Date.now() - t0,
      error: (err as Error).message,
    });
    throw err;
  }

  const duration = Date.now() - t0;

  // ── Step 5: usage — 优先 callback 真实值，fallback 估算 ────────
  const realUsage = usageHandler.getUsage();
  // Bug19 修复：input/output 都基于实际文本估算
  const estimated = estimateTokens(inputText, content);
  const usage = realUsage ?? estimated;

  logger.debug('[chatLC] OpenAI chain completed', {
    model: modelName,
    contentLen: content.length,
    usageSource: realUsage ? 'callback' : 'estimate',
    usage,
    duration,
  });

  return {
    content,
    usage: { input: usage.input, output: usage.output },
  };
}

// ─── Anthropic 路径（LCEL chain）─────────────────────────────────────────

/**
 * Anthropic 专用协议的 LCEL chain 实现。
 *
 * Anthropic 协议特点：
 * - system prompt 必须单独字段（不能在 messages 里）
 * - messages 是 user/assistant 交替的 ContentBlock[]
 * - max_tokens 必须传
 */
export async function lcelChatAnthropic(
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  // ── Step 1: 构造 ChatAnthropic ──────────────────────────────────
  const chatModel = new ChatAnthropic({
    anthropicApiKey: apiKey,
    model: modelName,
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens ?? 4096,
  });

  // ── Step 2: 构造 LCEL chain ─────────────────────────────────────
  // Anthropic protocol: system 单独传，user 拼成 {input}
  const system = messages.find((m) => m.role === 'system')?.content;
  const userContent = messages
    .filter((m) => m.role !== 'system')
    .map((m) => m.content)
    .join('\n');

  const inputText = system ? `${system}\n\n${userContent}` : userContent;

  const prompt = PromptTemplate.fromTemplate('{input}');
  const parser = new StringOutputParser();
  const chain = prompt.pipe(chatModel).pipe(parser);

  // ── Step 3: 执行链（附带 UsageCallbackHandler 捕获真实 token）───
  const usageHandler = new UsageCallbackHandler();
  const t0 = Date.now();

  let content: string;
  try {
    content = await chain.invoke({ input: inputText }, { callbacks: [usageHandler] });
  } catch (err) {
    logger.error('[chatLC] Anthropic chain failed', {
      model: modelName,
      duration: Date.now() - t0,
      error: (err as Error).message,
    });
    throw err;
  }

  const duration = Date.now() - t0;

  // ── Step 4: usage — 优先 callback 真实值，fallback 估算 ────────
  const realUsage = usageHandler.getUsage();
  // Bug19 修复：input/output 都基于实际文本估算
  const estimated = estimateTokens(inputText, content);
  const usage = realUsage ?? estimated;

  logger.debug('[chatLC] Anthropic chain completed', {
    model: modelName,
    contentLen: content.length,
    usageSource: realUsage ? 'callback' : 'estimate',
    usage,
    duration,
  });

  return {
    content,
    usage: { input: usage.input, output: usage.output },
  };
}

// ─── Gemini 路径（保留现有 SDK）───────────────────────────────────────────

/**
 * Gemini 协议的 SDK 实现。
 *
 * 决策 D4（见文档 01 §4.6）：Gemini 暂不迁移到 LangChain，保留现有 @google/generative-ai SDK。
 * 理由：LangChain 的 ChatGoogleGenerativeAI 功能等价，迁移无收益。
 *
 * 此函数基本复用 router.ts 的 chatGemini() 逻辑。
 */
export async function sdkChatGemini(
  apiKey: string,
  _baseUrl: string, // Gemini SDK 不需要 baseURL（保留参数以匹配 chatViaLC 签名）
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  // 动态 import（避免顶层依赖，减少非 Gemini 路径的 bundle 大小）
  const { GoogleGenerativeAI } = await import('@google/generative-ai');

  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({ model: modelName });

  // Gemini protocol: systemInstruction 单独传，contents 是 Content[]
  const system = messages.find((m) => m.role === 'system')?.content;
  const userParts = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const t0 = Date.now();

  try {
    const result = await genModel.generateContent({
      contents: userParts,
      // Gemini 0.24 SDK 的 systemInstruction 是 string，不是 Part[] 对象（与 v1 不同的设计）
      ...(system ? { systemInstruction: system } : {}),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 4096,
      },
    });

    const resp = result.response;
    const duration = Date.now() - t0;

    logger.debug('[chatLC] Gemini SDK call completed', {
      model: modelName,
      contentLen: resp.text().length,
      usage: {
        input: resp.usageMetadata?.promptTokenCount ?? 0,
        output: resp.usageMetadata?.candidatesTokenCount ?? 0,
      },
      duration,
    });

    // Gemini SDK 直接返回 usageMetadata，是三条路径里唯一能拿到真实 usage 的
    return {
      content: resp.text(),
      usage: {
        input: resp.usageMetadata?.promptTokenCount ?? 0,
        output: resp.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  } catch (err) {
    logger.error('[chatLC] Gemini SDK call failed', {
      model: modelName,
      duration: Date.now() - t0,
      error: (err as Error).message,
    });
    throw err;
  }
}
