// 来源：审查报告_v0.2 Q4 + 审查报告_v0.3 Q4 深度分析 + 决策 scope-C（替换 LiteLLM）
// chat() 多协议分发：OpenAI 兼容 / Anthropic / Gemini 三条路径
// 决策 route-A：所有任务默认 deepseek-v4-flash
// 决策 hist-A：调用方传 history，system prompt 在调用方注入（这里不感知）

import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../env';
import { logger } from '../observability/logger';
import { resolveApiKey } from './key-resolver';
import { getModel, CHOOSE_MODEL, DEFAULT_MODEL, resolveModelAlias } from './models';
import { getProviderAdapter } from './providers';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** dev mode 下没有 key 时是否走 mock（默认 true） */
  devMock?: boolean;
  /**
   * 是否启用 thinking 模式（deepseek 等推理模型）
   * - true：删 temperature，传 reasoning_effort
   * - false：保留 temperature
   * - undefined：自动按 provider（deepseek=true，其它=false）
   */
  thinking?: boolean;
  /** DeepSeek thinking 模式推理强度：low / high / max（默认 high） */
  reasoningEffort?: 'low' | 'high' | 'max';
  /**
   * 是否跳过 chatLC 内部的 recordUsage（默认 false）。
   *
   * 用途（2026-09-17 Bug2 修复）：
   *   调用方需要按自定义 kind（如 'meeting' / 'analysis'）聚合记录 usage 时，
   *   关闭 chatLC 内部的 kind:'chat' 自动记录，避免双重计 cost。
   *
   * 调用方责任：
   *   传 skipUsage:true 时，必须在调用点附近按自己的业务语义 recordUsage。
   *   失败不能阻塞主流程（与 chatLC 内部一致）。
   */
  skipUsage?: boolean;
}

export interface ChatResult {
  content: string;
  usage: { input: number; output: number };
}

export interface RouteDecision {
  model: string;
  reason: string;
}

// ─── chooseModel ────────────────────────────────────────────────────────────

export type TaskType = keyof typeof CHOOSE_MODEL;

export function chooseModel(task: TaskType): RouteDecision {
  return {
    model: CHOOSE_MODEL[task],
    reason: `任务「${task}」默认使用 ${CHOOSE_MODEL[task]}（route-A：所有任务统一默认）`,
  };
}

// ─── chat() 多协议分发 ─────────────────────────────────────────────────────

/**
 * 多 Provider chat 调用。
 * @param model 模型名（必须 in SUPPORTED_MODELS）
 * @param tenantId 租户 ID（用于解析 ApiKey）
 * @param messages 消息数组（OpenAI 协议格式）
 * @param options 温度 / maxTokens / devMock
 */
export async function chat(
  model: string,
  tenantId: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  // P5.2 别名解析（兼容旧 call sites）
  const resolvedName = resolveModelAlias(model);
  const supported = getModel(resolvedName);
  if (!supported) {
    throw new Error(`[router] Unknown model "${model}" — not in SUPPORTED_MODELS.`);
  }

  const adapter = getProviderAdapter(supported.provider);
  if (!adapter) {
    throw new Error(`[router] Unknown provider "${supported.provider}".`);
  }

  // dev-mode mock：没配 key 且允许 mock，直接返回占位
  if (options.devMock !== false && process.env.NODE_ENV !== 'production') {
    const resolved = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
    if (!resolved || !resolved.apiKey) {
      logger.debug('[router] dev mock: no api key, returning placeholder', { model, provider: supported.provider });
      return {
        content: `[dev-mode mock] Provider "${supported.displayName}" (${supported.name}) 暂无可用 key。生产环境请配置 API Key。`,
        usage: { input: 0, output: 0 },
      };
    }
    return chatViaProvider(adapter, supported.provider, resolved.apiKey, supported.name, messages, options);
  }

  // 真实调用流程
  const resolved = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
  if (!resolved || !resolved.apiKey) {
    throw new TRPCErrorLike('未配置 API Key（请在设置页「AI 模型 Key」添加，或设置环境变量）');
  }
  return chatViaProvider(adapter, supported.provider, resolved.apiKey, supported.name, messages, options);
}

// ─── Provider dispatch ─────────────────────────────────────────────────────

async function chatViaProvider(
  adapter: ReturnType<typeof getProviderAdapter>,
  providerId: string,
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  if (!adapter) throw new Error(`[router] No adapter for provider ${providerId}`);

  if (adapter.protocol === 'openai') {
    return chatOpenAI(adapter.baseUrl, apiKey, modelName, messages, options);
  }
  if (adapter.protocol === 'anthropic') {
    return chatAnthropic(apiKey, modelName, messages, options);
  }
  if (adapter.protocol === 'gemini') {
    return chatGemini(apiKey, modelName, messages, options);
  }

  throw new Error(`[router] Unsupported protocol: ${adapter.protocol}`);
}

async function chatOpenAI(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const t0 = Date.now();

  // ── DeepSeek thinking 模式支持（官方 2026-09 文档）
  //   thinking 默认 enabled（reasoning_effort=high），
  //   temperature / presence_penalty / frequency_penalty 在 thinking 模式下不生效
  //   通过 extra_body.thinking.type 控制开/关
  const isDeepSeek = baseUrl.includes('api.deepseek.com');
  const useThinking = options.thinking ?? isDeepSeek; // 默认 deepseek 开 thinking
  const temperature = useThinking ? undefined : (options.temperature ?? 0.7);

  try {
    // DeepSeek 推理参数通过 extra_body 传递（官方文档要求）
    // ⚠️ extra_body 仅放 thinking/reasoning_effort，绝不能放 model/messages
    const extraBody: Record<string, unknown> | undefined = useThinking && isDeepSeek
      ? { reasoning_effort: options.reasoningEffort ?? 'high', thinking: { type: 'enabled' } }
      : undefined;

    const requestBody: Record<string, unknown> = {
      model: modelName,
      messages,
    };
    if (temperature !== undefined) requestBody.temperature = temperature;
    if (options.maxTokens) requestBody.max_tokens = options.maxTokens;

    // 用 unknown 绕过 SDK TS 类型树（thinking/reasoning_effort 不在 SDK 类型里）
    const clientAny = client as unknown as {
      chat: {
        completions: {
          create: (
            args: Record<string, unknown>,
            options?: { extra_body?: Record<string, unknown> }
          ) => Promise<{
            choices: Array<{
              message: {
                content: string | null;
                reasoning_content?: string;
              };
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          }>;
        };
      };
    };

    const resp = await clientAny.chat.completions.create(
      requestBody,
      extraBody ? { extra_body: extraBody } : undefined,
    );
    const choice = resp.choices[0]?.message;
    // 防御 #19：推理模型（如 deepseek-flash）的 reasoning_content 会用满 token，
    //          message.content 可能是空字符串 —— 给调用方一个警告日志便于排查
    if ((!choice?.content || choice.content.length === 0) && (choice as { reasoning_content?: string })?.reasoning_content) {
      logger.warn('[router] OpenAI-compatible response had empty content but non-empty reasoning_content (likely reasoning model). Use a non-reasoning model for structured-output tasks.', {
        model: modelName,
        reasoningLen: ((choice as { reasoning_content?: string }).reasoning_content ?? '').length,
        usage: resp.usage,
      });
    }
    return {
      content: choice?.content ?? '',
      usage: {
        input: resp.usage?.prompt_tokens ?? 0,
        output: resp.usage?.completion_tokens ?? 0,
      },
    };
  } catch (e) {
    logger.error('[router] OpenAI-compatible call failed', {
      model: modelName,
      duration: Date.now() - t0,
      error: (e as Error).message,
    });
    throw e;
  }
}

async function chatAnthropic(
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const client = new Anthropic({ apiKey });
  // Anthropic 协议：system 必须单独传，不能在 messages 里
  const systemMsg = messages.find((m) => m.role === 'system');
  const userMsgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const t0 = Date.now();
  try {
    const resp = await client.messages.create({
      model: modelName,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: userMsgs,
    });
    // Anthropic 返回 content 是 ContentBlock[]，取第一个 text block
    const textBlock = resp.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined;
    return {
      content: textBlock?.text ?? '',
      usage: {
        input: resp.usage.input_tokens,
        output: resp.usage.output_tokens,
      },
    };
  } catch (e) {
    logger.error('[router] Anthropic call failed', {
      model: modelName,
      duration: Date.now() - t0,
      error: (e as Error).message,
    });
    throw e;
  }
}

async function chatGemini(
  apiKey: string,
  modelName: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const client = new GoogleGenerativeAI(apiKey);
  const genModel = client.getGenerativeModel({ model: modelName });

  // Gemini 协议：systemInstruction 单独传
  const systemMsg = messages.find((m) => m.role === 'system');
  const userMsgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
      parts: [{ text: m.content }],
    }));

  const t0 = Date.now();
  try {
    const result = await genModel.generateContent({
      contents: userMsgs,
      ...(systemMsg ? { systemInstruction: systemMsg.content } : {}),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 4096,
      },
    });
    const resp = result.response;
    return {
      content: resp.text(),
      usage: {
        input: resp.usageMetadata?.promptTokenCount ?? 0,
        output: resp.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  } catch (e) {
    logger.error('[router] Gemini call failed', {
      model: modelName,
      duration: Date.now() - t0,
      error: (e as Error).message,
    });
    throw e;
  }
}

// ─── 兼容旧的 chat() 签名 ────────────────────────────────────────────────

/** TRPCError-like 用于 chat() 内部抛出 */
class TRPCErrorLike extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TRPCError';
  }
}

// 让旧的 chat() 调用兼容：保留 litellm 兼容入口（仅在 DEV 模式下用）
export const litellm = {
  chat: {
    completions: {
      async create(opts: { model: string; messages: ChatMessage[]; temperature?: number; max_tokens?: number }) {
        // 旧 LiteLLM 调用统一走本地直连（不再有 LiteLLM proxy）
        // 调用方需要传 tenantId（这里没有 ctx，会走 dev-mock）
        logger.warn('[router] litellm.chat.completions.create 是旧接口，请改用 chat()', { model: opts.model });
        return {
          choices: [{ message: { content: '' } }],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        };
      },
    },
  },
};

// 默认导出（保持向后兼容 src/server/routers/chat.ts）
export { DEFAULT_MODEL };
