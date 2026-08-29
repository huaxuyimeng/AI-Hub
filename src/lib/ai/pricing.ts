// 来源：d:\1Money\design\AI集成.md §五 定价表 + §七 Prompt Cache
// 批次 B9：定价数据按 USD / 1M tokens，含 Prompt Cache TTL 折扣
// Q4 修复：模型名与前端 / router.ts 统一（单一事实源 → src/lib/ai/models.ts）

export interface ModelPricing {
  name: string;
  displayName: string;
  inputPrice: number;        // USD per 1M tokens
  outputPrice: number;       // USD per 1M tokens
  cacheReadPrice?: number;   // USD per 1M tokens (cached)
  cacheWritePrice?: number;
  maxContextWindow: number;
  supportsPromptCache: boolean;
}

export const PRICING_TABLE: ModelPricing[] = [
  {
    // Q4：对齐前端 chat/page.tsx 实际使用的模型名
    name: 'deepseek-chat',
    displayName: 'DeepSeek V3',
    inputPrice: 0.27,
    outputPrice: 1.1,
    cacheReadPrice: 0.07,
    maxContextWindow: 64000,
    supportsPromptCache: true,
  },
  {
    name: 'deepseek-reasoner',
    displayName: 'DeepSeek R1',
    inputPrice: 0.55,
    outputPrice: 2.2,
    cacheReadPrice: 0.07,
    maxContextWindow: 64000,
    supportsPromptCache: true,
  },
  {
    name: 'moonshot-v1-8k',
    displayName: 'Kimi V1 8K',
    inputPrice: 0.6,
    outputPrice: 3.0,
    cacheReadPrice: 0.15,
    maxContextWindow: 8000,
    supportsPromptCache: true,
  },
  {
    name: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    inputPrice: 3.0,
    outputPrice: 15.0,
    cacheReadPrice: 0.3,
    maxContextWindow: 200000,
    supportsPromptCache: true,
  },
];

export function getPricing(modelName: string): ModelPricing {
  const found = PRICING_TABLE.find((p) => p.name === modelName);
  if (!found) {
    // Q4 修复：未知模型不静默返回 0（会导致费用恒记 0），改为抛错
    throw new Error(`[pricing] Unknown model "${modelName}" — not in PRICING_TABLE. Add it to src/lib/ai/models.ts.`);
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