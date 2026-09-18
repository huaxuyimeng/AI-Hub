/**
 * AI 模型性价比算法
 *
 * 来源：整合 plan §4.1 + 原 llm-value-ranking-lite 算法
 *
 * 算法说明（Batch 9：4 维度加权）：
 *   混合价 = (0.7 × 输入价 + 0.3 × 输出价) USD/M
 *   性价比 = f(能力) × 速度^0.8 × 上下文权重 × 价格倒数
 *   上下文权重 = log10(ctx/1K) / log10(2000K)  （归一化到 0-1，最大 2M）
 *   f(x): x ≥ μ 时 (μ+(x−μ)²)²；x < μ 时 (μ−(μ−x)²)²
 *   μ = 55.9（参排模型能力均分）
 *   能力分 < 25 不参排
 *
 * Batch 9 新增：
 *   - 上下文窗口作为第 4 维度，权重 0.25（与价格 0.25/能力 0.35/速度 0.15 联合加权）
 *   - 缺数据时（undefined）→ 中性值 0.5（不奖不罚）
 */

export interface ModelScoreInput {
  priceInput: number;       // USD/M tokens
  priceOutput: number;      // USD/M tokens
  intelligence: number;     // 0-100
  speed: number;            // 相对速度（tokens/s）
  /** Batch 9：上下文窗口 tokens（如 128000），undefined 表示未提供，给中性值 */
  contextWindow?: number | null;
  weights?: {
    input: number;          // 输入价权重
    output: number;         // 输出价权重
    context?: number;       // Batch 9：contextWindow 权重（默认 0.25）
  };
  mu?: number;
}

export interface ScoringResult {
  blendPrice: number;
  abilityScore: number;
  valueScore: number;
  contextWindowFactor: number; // Batch 9：上下文因子（0-1）
  rank: number;
  isExcluded: boolean;
  reason?: string;
}

const DEFAULT_MU = 55.9;
const MIN_INTELLIGENCE = 25;
const SPEED_EXPONENT = 0.8;
/** Batch 9：contextWindow 权重默认值（与价格 0.7+0.3 等价权重相对） */
const DEFAULT_CONTEXT_WEIGHT = 0.25;
/** 归一化基准：log10(2_000_000) ≈ 6.30，1K ≈ 3.00 → 比例映射 0-1 */
const CONTEXT_REFERENCE_MAX = 2_000_000; // 2M tokens（Gemini 2.5 Pro 水平）

/**
 * Batch 9：上下文窗口归一化因子
 * 把 tokens 数映射到 0-1，2M = 1.0，1K = 0
 * 缺数据（null/undefined）返回 0.5（中性）
 */
export function contextWindowFactor(tokens: number | null | undefined): number {
  if (tokens == null || tokens <= 0) return 0.5; // 中性
  // log scale: log10(2000) / log10(2_000_000) ≈ 3.30 / 6.30 ≈ 0.524
  // 简单钳制到 [0, 1]
  const ratio = Math.log10(Math.max(tokens, 1)) / Math.log10(CONTEXT_REFERENCE_MAX);
  return Math.max(0, Math.min(1, ratio));
}

/**
 * 计算能力分变换 f(x)
 */
function transformAbility(x: number, mu: number): number {
  const diff = x - mu;
  if (diff >= 0) {
    return Math.pow(mu + diff * diff, 2);
  } else {
    const inner = mu - diff * diff;
    return inner < 0 ? 0 : Math.pow(inner, 2);
  }
}

/** Batch 9：综合 4 维度分数 */
function combinedFactor(args: {
  abilityScore: number;
  speedFactor: number;
  contextWindowFactor: number;
  blendPrice: number;
  contextWeight: number;
}): number {
  const { abilityScore, speedFactor, contextWindowFactor, blendPrice, contextWeight } = args;

  // 价格越低越好 → 倒数
  const priceFactor = 1 / blendPrice;

  // 上下文用加权和（contextWeight 占比），剩余 (1 - contextWeight) 在 (ability × speed) 里按比例分配
  // 旧公式：abilityScore * speedFactor / blendPrice
  // 新公式：abilityScore^α * speedFactor^β * contextWindowFactor^γ / blendPrice
  //       其中 α + β = 1 - γ
  // 简化：把 contextWindow 当成"乘性加成"
  const nonContextWeight = 1 - contextWeight;
  // 把能力+速度按 nonContextWeight 缩放（保持相对比例）
  const combinedAbilitySpeed = Math.pow(abilityScore, nonContextWeight * 0.65) * Math.pow(speedFactor, nonContextWeight * 0.35);
  const combinedContext = Math.pow(contextWindowFactor, contextWeight);

  return (combinedAbilitySpeed * combinedContext) * priceFactor;
}

/**
 * 计算单个模型的性价比
 */
export function calculateValueScore(input: ModelScoreInput): ScoringResult {
  const weights = input.weights ?? { input: 0.7, output: 0.3 };
  const mu = input.mu ?? DEFAULT_MU;
  const contextWeight = weights.context ?? DEFAULT_CONTEXT_WEIGHT;

  // 能力分过低不参排
  if (input.intelligence < MIN_INTELLIGENCE) {
    return {
      blendPrice: 0,
      abilityScore: 0,
      valueScore: 0,
      contextWindowFactor: 0.5,
      rank: 0,
      isExcluded: true,
      reason: `能力分 ${input.intelligence} < ${MIN_INTELLIGENCE}`,
    };
  }

  const blendPrice = weights.input * input.priceInput + weights.output * input.priceOutput;

  // 价格为零或负数视为无效
  if (blendPrice <= 0) {
    return {
      blendPrice: 0,
      abilityScore: 0,
      valueScore: 0,
      contextWindowFactor: 0.5,
      rank: 0,
      isExcluded: true,
      reason: '价格未设置',
    };
  }

  const abilityScore = transformAbility(input.intelligence, mu);
  const speedFactor = Math.pow(Math.max(input.speed, 0.1), SPEED_EXPONENT);
  const ctxFactor = contextWindowFactor(input.contextWindow);
  const valueScore = combinedFactor({
    abilityScore,
    speedFactor,
    contextWindowFactor: ctxFactor,
    blendPrice,
    contextWeight,
  });

  return {
    blendPrice,
    abilityScore,
    valueScore,
    contextWindowFactor: ctxFactor,
    rank: 0,
    isExcluded: false,
  };
}

/**
 * 归一化分数（榜首 = 100）
 * 保留原始字段，仅更新 valueScore
 */
export function normalizeScores<T extends { valueScore: number; isExcluded: boolean }>(
  results: T[]
): T[] {
  const included = results.filter((r) => !r.isExcluded);
  if (included.length === 0) return results;

  const maxScore = Math.max(...included.map((r) => r.valueScore));
  if (maxScore <= 0) return results;

  return results.map((r) => ({
    ...r,
    valueScore: r.isExcluded ? 0 : (r.valueScore / maxScore) * 100,
  }));
}

/**
 * 提取帕累托前沿
 * 规则：在同价位（或更低）下，能力分最高的点
 */
export function paretoFrontier<T extends { priceInput: number; intelligence: number | null }>(
  items: T[]
): T[] {
  const valid = items.filter((m) => m.intelligence !== null && m.priceInput > 0);
  if (valid.length === 0) return [];

  // 按价格升序
  const sorted = [...valid].sort((a, b) => a.priceInput - b.priceInput);

  const frontier: T[] = [];
  let maxAbility = 0;

  for (const item of sorted) {
    const ability = item.intelligence!;
    if (ability > maxAbility) {
      frontier.push(item);
      maxAbility = ability;
    }
  }

  return frontier;
}
