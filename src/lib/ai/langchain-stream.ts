// 来源：d:\1Money\aihub\docs\AI模块\langchain接入\03c-Phase1.5-流式输出.md
//
// 职责：chatLC 流式版（chatLCStream）—— 返回 AsyncIterable<ChatChunk>。
//
// 与 chatLC 区别：
//   - chatLC 返回 ChatResult（一次性）
//   - chatLCStream 返回 AsyncIterable<ChatChunk>（流式，逐 chunk）
//
// 协议支持：
//   - OpenAI 兼容（OpenAI / DeepSeek / Zhipu / Ollama / Qwen / MiniMax）：LangChain .stream()
//   - Anthropic：LangChain .stream()
//   - Gemini：GoogleGenerativeAI.generateContentStream()
//
// 依赖：
//   - @langchain/openai, @langchain/anthropic
//   - @google/generative-ai（动态 import，节省 bundle）
//   - 内部：../router (types), ../models, ../providers, ../key-resolver, ../../observability/logger
//
// 过期条件：
//   - LangChain 0.3 → 1.x：调整 .stream() / callback API
//   - 新增 Provider 类型：在 streamViaLC 中新增分支
//   - ChatChunk schema 变化：调整 ChatChunk interface

import type { ChatMessage, ChatOptions } from './router';
import { resolveModelAlias, getModel } from './models';
import { getProviderAdapter } from './providers';
import { resolveApiKey } from './key-resolver';
import { logger } from '../observability/logger';
import { streamViaLC } from './langchain-stream/protocols';

// ─── ChatChunk ──────────────────────────────────────────────────────────────

/**
 * 流式输出事件类型。
 *
 * 事件序列（正常完成）：
 *   { type: 'text', delta: '你' }
 *   { type: 'text', delta: '好' }
 *   ...
 *   { type: 'usage', usage: { input: 12, output: 8 } }   // 调用结束后
 *   { type: 'done', done: true }
 *
 * 异常序列：
 *   { type: 'text', delta: '...' }
 *   { type: 'error', error: { message: '...' } }
 *   { type: 'done', done: true }
 */
export type ChatChunk =
  | { type: 'text'; delta: string }
  | { type: 'usage'; usage: { input: number; output: number; cachedInput?: number } }
  | { type: 'error'; error: { message: string } }
  | { type: 'done'; done: true };

// ─── chatLCStream ───────────────────────────────────────────────────────────

/**
 * chatLCStream — 流式版的 chatLC
 *
 * @param model      模型名（必须 in SUPPORTED_MODELS）
 * @param tenantId   租户 ID（用于解析 ApiKey）
 * @param messages   消息数组（OpenAI 协议格式）
 * @param options    temperature / maxTokens / thinking / reasoningEffort / signal
 *
 * @returns          AsyncIterable<ChatChunk>
 *
 * 使用方式：
 *   for await (const chunk of chatLCStream(model, tenantId, messages, opts)) {
 *     if (chunk.type === 'text') socket.write(chunk.delta);
 *     if (chunk.type === 'usage') socket.emit('usage', chunk.usage);
 *     if (chunk.type === 'error') socket.emit('error', chunk.error);
 *     if (chunk.type === 'done') socket.end();
 *   }
 */
export async function* chatLCStream(
  model: string,
  tenantId: string,
  messages: ChatMessage[],
  options: ChatOptions & { signal?: AbortSignal } = {}
): AsyncGenerator<ChatChunk, void, undefined> {
  const t0 = Date.now();

  // ── Step 1: 解析模型元数据 ──────────────────────────────────────────
  const resolvedName = resolveModelAlias(model);
  const supported = getModel(resolvedName);
  if (!supported) {
    yield {
      type: 'error',
      error: { message: `[chatLCStream] Unknown model "${model}"` },
    };
    yield { type: 'done', done: true };
    return;
  }

  const adapter = getProviderAdapter(supported.provider);
  if (!adapter) {
    yield {
      type: 'error',
      error: { message: `[chatLCStream] Unknown provider "${supported.provider}"` },
    };
    yield { type: 'done', done: true };
    return;
  }

  // ── Step 2: Dev mode mock（与 chatLC 行为一致）───────────────────
  if (options.devMock !== false && process.env.NODE_ENV !== 'production') {
    const resolvedDev = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
    if (!resolvedDev?.apiKey) {
      logger.debug('[chatLCStream] dev mock: no api key, returning placeholder', {
        model,
        provider: supported.provider,
      });
      yield {
        type: 'text',
        delta: `[dev-mode mock] Provider "${supported.displayName}" (${supported.name}) 暂无可用 key。生产环境请配置 API Key。`,
      };
      yield { type: 'usage', usage: { input: 0, output: 0 } };
      yield { type: 'done', done: true };
      return;
    }
    // dev 路径：已有 key，进入真实流式调用
    yield* streamViaLC(
      adapter.protocol,
      supported,
      resolvedDev.apiKey,
      adapter.baseUrl,
      messages,
      options,
      t0
    );
    return;
  }

  // ── Step 3: 生产环境解析多租户 API key ────────────────────────────
  const resolved = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
  if (!resolved?.apiKey) {
    yield {
      type: 'error',
      error: {
        message: `[chatLCStream] 未配置 API Key（请在设置页「AI 模型 Key」添加，或设置环境变量）。Provider: ${supported.provider}`,
      },
    };
    yield { type: 'done', done: true };
    return;
  }

  yield* streamViaLC(
    adapter.protocol,
    supported,
    resolved.apiKey,
    adapter.baseUrl,
    messages,
    options,
    t0
  );
}

// ─── Helper: 把 chatLCStream 转 SSE 事件字符串 ─────────────────────────────

/**
 * sseEncode — 把 ChatChunk 编码为 SSE 协议字符串。
 *
 * SSE 格式：
 *   data: {json}\n\n
 *
 * 注意：用 Buffer 模式编码 JSON（避免 in-band 控制字符被破坏）。
 */
export function sseEncode(chunk: ChatChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * sseEnd — SSE 流结束标记（client 用 event === 'done' 或 data === '[DONE]' 识别）
 */
export const SSE_END_MARKER = 'data: [DONE]\n\n';
