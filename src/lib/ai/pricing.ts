// 来源：审查报告_v0.2 Q4 + 审查报告_v0.3 Q4 深度分析
// 决策 model-A：定价表与 SUPPORTED_MODELS 一一对应（单一事实源 → models.ts）
// 未知模型不静默返回 0，改为抛错（Q4 修复）
// 定价单位：USD / 1M tokens

import type { SupportedModelName } from './models';

export interface ModelPricing {
  /** 必须与 SupportedModelName 一致（zod tuple 强约束） */
  name: SupportedModelName;
  displayName: string;
  provider: string;
  /** USD / 1M input tokens */
  inputPrice: number;
  /** USD / 1M output tokens */
  outputPrice: number;
  /** USD / 1M cached input tokens（不支持则 undefined） */
  cacheReadPrice?: number;
  /** USD / 1M cache write tokens */
  cacheWritePrice?: number;
  maxContextWindow: number;
  supportsPromptCache: boolean;
}

/**
 * 定价表（与 SUPPORTED_MODELS 一一对应）
 *
 * ⚠️ 改定价数据时同步修改此处；改模型时同步修改 SUPPORTED_MODELS。
 * TypeScript 的 zod tuple 会确保漏改被 tsc 捕获。
 */
export const PRICING_TABLE: ModelPricing[] = [
  // ── DeepSeek 系列 ────────────────────────────────────────────────────
  {
    name: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    provider: 'DeepSeek',
    inputPrice: 0.27,
    outputPrice: 1.10,
    cacheReadPrice: 0.07,
    maxContextWindow: 128000,
    supportsPromptCache: true,
  },
  {
    name: 'deepseek-chat',
    displayName: 'DeepSeek V3',
    provider: 'DeepSeek',
    inputPrice: 0.27,
    outputPrice: 1.10,
    cacheReadPrice: 0.07,
    maxContextWindow: 64000,
    supportsPromptCache: true,
  },
  {
    name: 'deepseek-reasoner',
    displayName: 'DeepSeek R1',
    provider: 'DeepSeek',
    inputPrice: 0.55,
    outputPrice: 2.20,
    cacheReadPrice: 0.07,
    maxContextWindow: 64000,
    supportsPromptCache: true,
  },

  // ── 智谱 GLM 系列 ───────────────────────────────────────────────────
  {
    name: 'glm-4-7-flash',
    displayName: 'GLM 4-7 Flash',
    provider: '智谱 GLM',
    inputPrice: 0.10,
    outputPrice: 0.10,
    maxContextWindow: 128000,
    supportsPromptCache: false,
  },

  // ── Anthropic 系列 ──────────────────────────────────────────────────
  {
    name: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    inputPrice: 3.00,
    outputPrice: 15.00,
    cacheReadPrice: 0.30,
    cacheWritePrice: 3.75,
    maxContextWindow: 200000,
    supportsPromptCache: true,
  },

  // ── OpenAI 系列 ─────────────────────────────────────────────────────
  {
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    provider: 'OpenAI',
    inputPrice: 0.15,
    outputPrice: 0.60,
    cacheReadPrice: 0.075,
    maxContextWindow: 128000,
    supportsPromptCache: true,
  },

  // ── Google Gemini 系列 ─────────────────────────────────────────────
  {
    name: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    provider: 'Google',
    inputPrice: 0.075,
    outputPrice: 0.30,
    maxContextWindow: 1000000,
    supportsPromptCache: false,
  },

  // ── Ollama 本地 ─────────────────────────────────────────────────────
  {
    name: 'llama3.1',
    displayName: 'Llama 3.1 (本地)',
    provider: 'Ollama',
    inputPrice: 0,
    outputPrice: 0,
    maxContextWindow: 8192,
    supportsPromptCache: false,
  },
];

/** 模型名 → ModelPricing 映射（O(1) 查询） */
const PRICING_MAP = new Map<string, ModelPricing>(PRICING_TABLE.map((p) => [p.name, p]));

export function getPricing(modelName: string): ModelPricing {
  const found = PRICING_MAP.get(modelName);
  if (!found) {
    // Q4 修复：未知模型不静默返回 0（会导致费用恒记 0），改为抛错
    throw new Error(
      `[pricing] Unknown model "${modelName}" — not in PRICING_TABLE. ` +
        `Add it to src/lib/ai/pricing.ts.`
    );
  }
  return found;
}

export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0
): number {
  const p = getPricing(modelName);
  const uncachedInput = inputTokens - cachedTokens;
  const inputCost = (uncachedInput / 1_000_000) * p.inputPrice;
  const outputCost = (outputTokens / 1_000_000) * p.outputPrice;
  const cacheCost = p.cacheReadPrice
    ? (cachedTokens / 1_000_000) * p.cacheReadPrice
    : 0;
  return inputCost + outputCost + cacheCost;
}
