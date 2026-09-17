// 来源：docs/AI模块/langchain接入/03-Phase1-chatLC实现.md
//
// 职责：LangChain 版 chat() 封装，提供统一多模型调用能力。
// 与 chat() 行为完全等价：多租户 / dev mock / usage tracking 全保留。
//
// 架构：
//   chatLC()
//     ├─ resolveModelAlias / getModel / getProviderAdapter  ← 与 chat() 相同
//     ├─ dev mock 检查（与 chat() 相同）
//     ├─ resolveApiKey(tenantId, provider)                  ← 多租户 key
//     └─ chatViaLC(protocol, apiKey, baseUrl, model, messages, options)
//           ├─ protocol === 'openai' → lcelChatOpenAI()
//           ├─ protocol === 'anthropic' → lcelChatAnthropic()
//           └─ protocol === 'gemini' → sdkChatGemini()（保留现状）
//
// 使用示例：
//   const result = await chatLC('deepseek-flash', tenantId, messages, { temperature: 0.7 });
//   // result.content === string, result.usage.input/output === number
//
// 过期条件：
//   - LangChain 主版本升级（0.3 → 1.x） → 重写所有 LangChain 调用点
//   - 新增 Provider 类型（不是 openai/anthropic/gemini） → 在 chatViaLC 中新增分支
//   - recordUsage / calculateCost / resolveApiKey 签名变更 → 同步调整 Step 5

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import type { ChatMessage, ChatOptions, ChatResult } from './router';
import { resolveModelAlias, getModel } from './models';
import { getProviderAdapter } from './providers';
import { resolveApiKey } from './key-resolver';
import { recordUsage } from '../usage';
import { calculateCost } from './pricing';
import { logger } from '../observability/logger';

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * 估算 token 数（按中文字符 ~1.5 token / 字，英文 ~1.25 token / 词）。
 *
 * 仅在 callback 未捕获到真实 usage 时作为兜底（精度 ±20%）。
 * 真实 usage 应由 UsageCallbackHandler 在 LLM 响应后捕获。
 *
 * 2026-09-17 Bug19 修复：原签名只接收 content（output），input 永远返回 0
 *                   导致 fallback 时计费 input 漏算。现改为分别接收 inputText 和 outputText。
 */
function estimateTokens(inputText: string, outputText: string): { input: number; output: number } {
  const estimate = (text: string): number => {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/\S+/g) || []).length;
    return Math.ceil(chineseChars * 1.5 + englishWords * 1.25);
  };
  return {
    input: estimate(inputText),
    output: estimate(outputText),
  };
}

/** 合并 messages 为 system + user 两段文本（PromptTemplate 单变量用） */
function mergeMessages(messages: ChatMessage[]): { system: string | undefined; user: string } {
  const system = messages.find((m) => m.role === 'system')?.content;
  const userParts = messages
    .filter((m) => m.role !== 'system')
    .map((m) => m.content)
    .join('\n');
  return { system, user: userParts };
}

// ─── Usage Callback Handler ───────────────────────────────────────────────

/**
 * UsageCallbackHandler — 拦截 LLM 响应，捕获真实 token usage。
 *
 * 设计动机（2026-09-17 优化）：
 *   StringOutputParser 会丢失原始 AIMessage（含 usage_metadata）。
 *   通过 callback 在 handleLLMEnd 阶段直接读 tokenUsage，零侵入。
 *
 * 字段映射（不同 provider 的 usage 字段名不同，统一为 input/output）：
 *   - OpenAI 兼容（OpenAI / DeepSeek / Zhipu / Ollama / Qwen / MiniMax）：
 *     llmOutput.tokenUsage = { promptTokens, completionTokens, totalTokens }
 *   - Anthropic：
 *     llmOutput.usage = { input_tokens, output_tokens }
 *     response_metadata.usage = { input_tokens, output_tokens }
 *   - Gemini：直接走 SDK（不通过 callback）
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
function parseLLMUsage(output: LLMResult): { input: number; output: number } | null {
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

// ─── 入口函数 ─────────────────────────────────────────────────────────────

/**
 * chatLC — LangChain 版的 chat()
 *
 * 行为与 chat() 等价：
 * - 多租户 key 解析（resolveApiKey）
 * - Dev mode mock（NODE_ENV !== 'production' 且无 key）
 * - Usage tracking（recordUsage）
 *
 * 内部差异：
 * - OpenAI 兼容 / Anthropic 用 LangChain ChatModel + LCEL chain
 * - Gemini 暂用现有 SDK（保留现状）
 *
 * @param model        模型名（必须 in SUPPORTED_MODELS）
 * @param tenantId     租户 ID（用于解析 ApiKey）
 * @param messages     消息数组（OpenAI 协议格式）
 * @param options      温度 / maxTokens / devMock / thinking / reasoningEffort
 * @returns            ChatResult { content: string, usage: { input, output } }
 */
export async function chatLC(
  model: string,
  tenantId: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const t0 = Date.now();

  // ── Step 1: 解析模型元数据 ──────────────────────────────────────────
  const resolvedName = resolveModelAlias(model);
  const supported = getModel(resolvedName);
  if (!supported) {
    throw new Error(`[chatLC] Unknown model "${model}" — not in SUPPORTED_MODELS.`);
  }

  const adapter = getProviderAdapter(supported.provider);
  if (!adapter) {
    throw new Error(`[chatLC] Unknown provider "${supported.provider}".`);
  }

  // ── Step 2: Dev mode mock（与 router.ts L99-L108 完全一致）─────────
  // 修复 Bug3：原 chatLC 把 dev-mock 当成"只检查"，落入 Step 3 又 resolveApiKey 一次（重复 DB 查询）
  // 现改为：命中 dev-mock 直接 return placeholder（与 router.ts 一致）
  if (options.devMock !== false && process.env.NODE_ENV !== 'production') {
    const resolvedDev = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
    if (!resolvedDev?.apiKey) {
      logger.debug('[chatLC] dev mock: no api key, returning placeholder', {
        model,
        provider: supported.provider,
      });
      return {
        content: `[dev-mode mock] Provider "${supported.displayName}" (${supported.name}) 暂无可用 key。生产环境请配置 API Key。`,
        usage: { input: 0, output: 0 },
      };
    }
    // dev mock 路径：已有 key，直接进入真实调用（不重复 resolve）
    const devResult = await chatViaLC(
      adapter.protocol,
      resolvedDev.apiKey,
      adapter.baseUrl,
      supported.name,
      messages,
      options
    );
    // dev mock 也走 recordUsage（除非 skipUsage），保持与 chat() 行为一致
    return await recordUsageIfNeeded(devResult, supported, options, tenantId, t0);
  }

  // ── Step 3: 生产环境解析多租户 API key ────────────────────────────
  const resolved = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
  if (!resolved?.apiKey) {
    throw new Error(
      `[chatLC] 未配置 API Key（请在设置页「AI 模型 Key」添加，或设置环境变量）。Provider: ${supported.provider}`,
    );
  }

  // ── Step 4: 分协议调用 ────────────────────────────────────────────
  const result = await chatViaLC(
    adapter.protocol,
    resolved.apiKey,
    adapter.baseUrl,
    supported.name,
    messages,
    options
  );

  return await recordUsageIfNeeded(result, supported, options, tenantId, t0);
}

/**
 * recordUsageIfNeeded — Bug3 修复抽出的 helper
 *
 * 行为：
 * - skipUsage=true → 不记
 * - usage.input+output=0 → 不记
 * - 其它 → recordUsage（失败 warn 但不抛）
 *
 * @returns 始终返回原 ChatResult（无论 recordUsage 成功与否）
 */
async function recordUsageIfNeeded(
  result: ChatResult,
  supported: { name: string; provider: string; displayName: string },
  options: ChatOptions,
  tenantId: string,
  t0: number,
): Promise<ChatResult> {
  const duration = Date.now() - t0;

  logger.debug('[chatLC] call completed', {
    model: supported.name,
    provider: supported.provider,
    contentLen: result.content.length,
    usage: result.usage,
    duration,
  });

  if (options.skipUsage) {
    logger.debug('[chatLC] skipUsage=true, 跳过内部 recordUsage（由调用方负责）', {
      model: supported.name,
      provider: supported.provider,
    });
    return result;
  }

  if (result.usage.input + result.usage.output > 0) {
    try {
      await recordUsage({
        tenantId,
        modelId: supported.name,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cost: calculateCost(supported.name, result.usage.input, result.usage.output, 0),
        kind: 'chat',
      });
    } catch (err) {
      logger.warn('[chatLC] recordUsage failed', { error: (err as Error).message });
    }
  }

  return result;
}

// ─── 协议分发 ─────────────────────────────────────────────────────────────

/**
 * 根据 protocol 分发到对应的 LangChain 或 SDK 实现。
 */
async function chatViaLC(
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
async function lcelChatOpenAI(
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
async function lcelChatAnthropic(
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
async function sdkChatGemini(
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
