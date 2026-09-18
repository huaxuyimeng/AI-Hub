/**
 * AI Provider 适配器工厂
 *
 * 架构：决策 Q6 选择 proto-A（混合协议）
 *   - OpenAI 兼容（deepseek / zhipu / openai / ollama / xai / mistral / qwen / doubao / kimi / hunyuan）：
 *     用 openai 包构造客户端，统一 chat.completions.create 协议
 *   - Anthropic 专用（anthropic）：
 *     用 @anthropic-ai/sdk，调用 /v1/messages（OpenAI 不兼容）
 *   - Gemini 专用（gemini）：
 *     用 @google/generative-ai，调用 generateContent（OpenAI 不兼容）
 *
 * stub 实现策略：6 个 Provider（xai / mistral / qwen / doubao / kimi / hunyuan）
 *   testConnection 抛出 '暂未适配，留 TODO'，UI 上标灰 + 徽标
 *
 * dev-mode mock：开发环境无 key 时，testConnection 返回 ok: true（不真正发请求）
 */

import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../env';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini';

export interface ProviderAdapter {
  id: string;
  displayName: string;
  /** openai | anthropic | gemini */
  protocol: ProviderProtocol;
  baseUrl: string;
  defaultModel: string;
  /** 常用模型列表（用于 UI 下拉） */
  models: string[];
  docsUrl: string;
  /**
   * 测试连接。
   * - dev-mode（无 key）：返回 { ok: true, latencyMs: 0 }
   * - stub：抛出 Error('暂未适配，留 TODO')
   * - 真实：发 chat.completions（OpenAI）或等效调用，返回延迟（ms）
   */
  testConnection(opts: { apiKey: string; model?: string }): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

// ─── Env key resolver ───────────────────────────────────────────────────────

/** 从环境变量读取各 Provider 的兜底 key */
function envKey(provider: string): string | undefined {
  const map: Record<string, string> = {
    deepseek: 'DEEPSEEK_API_KEY',
    zhipu: 'ZHIPU_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    ollama: 'OLLAMA_API_KEY',
    xai: 'XAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    qwen: 'DASHSCOPE_API_KEY',
    doubao: 'DOUBAO_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    kimi: 'KIMI_API_KEY',
    hunyuan: 'HUNYUAN_API_KEY',
  };
  const envName = map[provider];
  if (!envName) return undefined;
  return process.env[envName] ?? undefined;
}

// ─── OpenAI-compatible helpers ───────────────────────────────────────────────

/** dev-mode 下返回 mock 结果（不真正发请求） */
function devMock(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  return Promise.resolve({ ok: true, latencyMs: 0 });
}

async function testOpenAICompatible(opts: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model?: string;
  defaultModel: string;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (process.env.NODE_ENV !== 'production' && !opts.apiKey) {
    return devMock();
  }

  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl });
  const model = opts.model ?? opts.defaultModel;
  const t0 = Date.now();

  try {
    await client.chat.completions.create({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 });
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}

// ─── Anthropic ─────────────────────────────────────────────────────────────

async function testAnthropic(opts: {
  apiKey: string;
  model?: string;
  defaultModel: string;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (process.env.NODE_ENV !== 'production' && !opts.apiKey) {
    return devMock();
  }

  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = opts.model ?? opts.defaultModel;
  const t0 = Date.now();

  try {
    await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}

// ─── Gemini ────────────────────────────────────────────────────────────────

async function testGemini(opts: {
  apiKey: string;
  model?: string;
  defaultModel: string;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (process.env.NODE_ENV !== 'production' && !opts.apiKey) {
    return devMock();
  }

  const client = new GoogleGenerativeAI(opts.apiKey);
  const model = opts.model ?? opts.defaultModel;
  const t0 = Date.now();

  try {
    const genModel = client.getGenerativeModel({ model });
    await genModel.generateContent('ping');
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message };
  }
}

// ─── Stub ──────────────────────────────────────────────────────────────────

function stubAdapter(id: string, displayName: string, defaultModel: string, docsUrl: string): ProviderAdapter {
  return {
    id, displayName, protocol: 'openai', baseUrl: '', defaultModel, models: [defaultModel], docsUrl,
    async testConnection() {
      throw new Error('暂未适配，留 TODO');
    },
  };
}

// ─── 12 Provider adapters ───────────────────────────────────────────────────

const ADAPTERS: Record<string, ProviderAdapter> = {
  // ── ✅ 完整实现（7 个） ──────────────────────────────────────────────

  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    docsUrl: 'https://api.deepseek.com/docs',
    testConnection(opts) {
      return testOpenAICompatible({ ...opts, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-flash' });
    },
  },

  zhipu: {
    id: 'zhipu',
    displayName: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-7-flash',
    models: ['glm-4-7-flash', 'glm-4-flash', 'glm-4-plus'],
    docsUrl: 'https://open.bigmodel.cn/dev/api',
    testConnection(opts) {
      return testOpenAICompatible({ ...opts, provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-7-flash' });
    },
  },

  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    docsUrl: 'https://platform.openai.com/docs',
    testConnection(opts) {
      return testOpenAICompatible({ ...opts, provider: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' });
    },
  },

  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5', 'claude-3-5-sonnet', 'claude-3-5-opus'],
    docsUrl: 'https://docs.anthropic.com/claude/reference',
    testConnection(opts) {
      return testAnthropic({ apiKey: opts.apiKey, model: opts.model, defaultModel: 'claude-sonnet-4-5' });
    },
  },

  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    docsUrl: 'https://ai.google.dev/docs',
    testConnection(opts) {
      return testGemini({ apiKey: opts.apiKey, model: opts.model, defaultModel: 'gemini-2.0-flash' });
    },
  },

  ollama: {
    id: 'ollama',
    displayName: 'Ollama（本地）',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'llama3', 'codellama', 'mistral', 'qwen2', 'deepseek-v4-flash'],
    docsUrl: 'https://github.com/ollama/ollama',
    testConnection(opts) {
      return testOpenAICompatible({ ...opts, provider: 'ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1' });
    },
  },

  // ── ⏳ Stub 实现（6 个） ──────────────────────────────────────────────

  xai: stubAdapter('xai', 'xAI Grok', 'grok-4-fast', 'https://docs.x.ai'),

  mistral: stubAdapter('mistral', 'Mistral', 'mistral-large-3', 'https://docs.mistral.ai'),

  qwen: {
    id: 'qwen',
    displayName: '阿里 Qwen（百炼）',
    protocol: 'openai',
    // 国内版：dashscope.aliyuncs.com（实测可通）
    // 国际版：dashscope-intl.aliyuncs.com（实测 401，key 不兼容）
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    // 实测可用模型（2026-09）
    models: ['qwen3.8-max', 'qwen-plus', 'qwen3.5-flash', 'qwen-coder-plus'],
    docsUrl: 'https://help.aliyun.com/zh/model-studio',
    testConnection(opts) {
      return testOpenAICompatible({
        ...opts,
        provider: 'qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen3.8-max',
      });
    },
  },

  doubao: stubAdapter('doubao', '字节豆包', 'doubao-pro-32k', 'https://www.volcengine.com/product/doubao'),

  minimax: {
    id: 'minimax',
    displayName: 'MiniMax 海螺',
    protocol: 'openai',
    // OpenAI 兼容端点（platform.minimax.io，与 minimax.chat 不同）
    baseUrl: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-M2.7-highspeed',
    // 官方 OpenAI 兼容接口支持的模型（2026-09 实测）
    models: ['MiniMax-M2.7-highspeed', 'MiniMax-M2.7', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.5', 'MiniMax-M2-highspeed', 'MiniMax-M2', 'MiniMax-M3'],
    docsUrl: 'https://platform.minimax.io/docs/guides/text-chat',
    testConnection(opts) {
      return testOpenAICompatible({
        ...opts,
        provider: 'minimax',
        baseUrl: 'https://api.minimax.io/v1',
        defaultModel: 'MiniMax-M2.7-highspeed',
      });
    },
  },

  kimi: stubAdapter('kimi', '月之暗面 Kimi', 'moonshot-v1-128k', 'https://platform.moonshot.cn/docs'),

  hunyuan: stubAdapter('hunyuan', '腾讯混元', 'hunyuan-pro', 'https://cloud.tencent.com/document/product'),
};

// ─── Exports ─────────────────────────────────────────────────────────────────

export function getProviderAdapter(id: string): ProviderAdapter | null {
  return ADAPTERS[id] ?? null;
}

export function listProviders(): ProviderAdapter[] {
  return Object.values(ADAPTERS);
}

/** 完整实现的 Provider IDs（可用于 UI 筛选） */
export const FULL_ADAPTER_IDS = ['deepseek', 'zhipu', 'openai', 'anthropic', 'gemini', 'ollama', 'qwen', 'minimax'] as const;

/** stub 实现数量（用于 UI 展示） */
export const STUB_COUNT = Object.keys(ADAPTERS).length - FULL_ADAPTER_IDS.length;
