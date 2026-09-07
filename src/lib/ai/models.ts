// 来源：决策 model-A（统一改为报告名）+ 单一事实源
// 改模型只需改这一处，所有下游（pricing / chooseModel / router / 前端下拉）自动同步
// 防回归：SUPPORTED_MODEL_NAMES 是 zod tuple，新名漏改会被 tsc 捕获

/**
 * 单个支持模型的元数据。
 *
 * 注意：定价数据（inputPrice/outputPrice）在 src/lib/ai/pricing.ts 中维护，
 * 本文件只做「单一事实源 - 模型名 / Provider / 上下文窗口 / 任务类型」。
 * pricing 通过 getModel(name) 反向查找避免重复。
 */

export type TaskType = 'chat' | 'code-analysis' | 'score';

export interface SupportedModel {
  /** 标准模型名（lowercase kebab-case），如 'deepseek-v4-flash' */
  name: string;
  /** UI 展示名（中文/英文混合） */
  displayName: string;
  /** Provider ID（对应 src/lib/ai/providers.ts 的 ADAPTERS key） */
  provider: string;
  /** 上下文窗口大小（tokens） */
  contextWindow: number;
  /** 默认用于哪类任务 */
  task: TaskType;
  /** 是否为该 Provider 的默认模型（UI 优先展示） */
  isDefault?: boolean;
}

/** 所有支持模型（route-A：所有任务默认 deepseek-v4-flash） */
export const SUPPORTED_MODELS = [
  // ── DeepSeek 系列（默认 provider） ────────────────────────────────
  {
    name: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    contextWindow: 128000,
    task: 'chat' as const,
    isDefault: true,
  },
  {
    name: 'deepseek-chat',
    displayName: 'DeepSeek V3',
    provider: 'deepseek',
    contextWindow: 64000,
    task: 'chat' as const,
  },
  {
    name: 'deepseek-reasoner',
    displayName: 'DeepSeek R1',
    provider: 'deepseek',
    contextWindow: 64000,
    task: 'chat' as const,
  },

  // ── 智谱 GLM 系列（默认兜底备选） ──────────────────────────────────
  {
    name: 'glm-4-7-flash',
    displayName: 'GLM 4-7 Flash',
    provider: 'zhipu',
    contextWindow: 128000,
    task: 'chat' as const,
    isDefault: true,
  },

  // ── Anthropic 系列 ─────────────────────────────────────────────────
  {
    name: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
    task: 'chat' as const,
    isDefault: true,
  },

  // ── OpenAI 系列 ────────────────────────────────────────────────────
  {
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    provider: 'openai',
    contextWindow: 128000,
    task: 'chat' as const,
    isDefault: true,
  },

  // ── Google Gemini 系列 ─────────────────────────────────────────────
  {
    name: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    provider: 'gemini',
    contextWindow: 1000000,
    task: 'chat' as const,
    isDefault: true,
  },

  // ── Ollama 本地 ────────────────────────────────────────────────────
  {
    name: 'llama3.1',
    displayName: 'Llama 3.1 (本地)',
    provider: 'ollama',
    contextWindow: 8192,
    task: 'chat' as const,
    isDefault: true,
  },
] as const satisfies readonly SupportedModel[];

/** 前端下拉选择器的类型-safe 枚举 */
export type SupportedModelName = (typeof SUPPORTED_MODELS)[number]['name'];

/** zod 校验用的 tuple（chat.ts 后端入参白名单） */
export const SUPPORTED_MODEL_NAMES = SUPPORTED_MODELS.map((m) => m.name) as unknown as readonly [string, ...string[]];

/** 校验模型名是否在白名单内 */
export function isSupportedModel(name: string): name is SupportedModelName {
  return SUPPORTED_MODELS.some((m) => m.name === name);
}

/** 按模型名查模型元数据 */
export function getModel(name: string): SupportedModel | undefined {
  return SUPPORTED_MODELS.find((m) => m.name === name);
}

/** 按 Provider 查所有模型 */
export function getModelsByProvider(provider: string): readonly SupportedModel[] {
  return SUPPORTED_MODELS.filter((m) => m.provider === provider);
}

/** 默认 Provider（用于"无配置时使用"） */
export const DEFAULT_MODEL = 'deepseek-v4-flash';

/**
 * 别名映射（向后兼容）
 *
 * 背景：Phase 0/Phase 1.1 之前历史调用可能仍传旧名（如 'gpt-4o-mini'）。
 * Phase 5.2 (2026-09-03) 提供别名转发：旧名 → 新名，并保留一次 warn 提示。
 *
 * 如果 DB 里 ModelSnapshot / usage 表有旧名字段，依然可以加载，但前端展示会重定向到新名。
 */
export const MODEL_ALIASES: Readonly<Record<string, SupportedModelName>> = {
  'gpt-4o-mini': 'gpt-4o-mini',     // 保留同名为新名（已存在于 SUPPORTED_MODELS）
  'deepseek-v3-flash': 'deepseek-v4-flash', // 历史 typo
};

let __warnedAlias: Set<string> | null = null;
function warnedAliases(): Set<string> {
  if (!__warnedAlias) __warnedAlias = new Set();
  return __warnedAlias;
}

/** 把旧名字解析为新名字（找不到则原样返回） */
export function resolveModelAlias(name: string): string {
  const aliased = MODEL_ALIASES[name];
  if (aliased && aliased !== name) {
    const set = warnedAliases();
    if (!set.has(name)) {
      set.add(name);
      if (typeof console !== 'undefined') {
        console.warn(`[models] 已弃用的模型名「${name}」已自动转发为「${aliased}」，请尽快迁移`);
      }
    }
    return aliased;
  }
  return name;
}

/**
 * 按任务类型选模型
 * 决策 route-A：所有任务统一默认 deepseek-v4-flash
 * 调用方可传入 model 参数覆盖
 */
export const CHOOSE_MODEL = {
  score: DEFAULT_MODEL,
  'code-analysis': DEFAULT_MODEL,
  chat: DEFAULT_MODEL,
} as const;
