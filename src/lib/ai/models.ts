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

/** 所有支持模型（route-A：所有任务默认 deepseek-flash） */
export const SUPPORTED_MODELS = [
  // ── DeepSeek 系列（默认 provider） — 官方 /v1/models 实测仅 2 个 ────
  {
    name: 'deepseek-flash',
    displayName: 'DeepSeek Flash',
    provider: 'deepseek',
    contextWindow: 128000,
    task: 'chat' as const,
    isDefault: true,
  },
  {
    name: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
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

  // ── 阿里 Qwen 系列 ────────────────────────────────────────────────
  {
    name: 'qwen3.8-max',
    displayName: 'Qwen 3.8 Max',
    provider: 'qwen',
    contextWindow: 1000000,
    task: 'chat' as const,
    isDefault: true,
  },
  {
    name: 'qwen-plus',
    displayName: 'Qwen Plus',
    provider: 'qwen',
    contextWindow: 32000,
    task: 'chat' as const,
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

  // ── MiniMax 海螺（OpenAI 兼容端点 api.minimax.io/v1）────────────────────
  {
    name: 'MiniMax-M2.7-highspeed',
    displayName: 'MiniMax M2.7 Highspeed',
    provider: 'minimax',
    contextWindow: 128000,
    task: 'chat' as const,
    isDefault: true,
  },
  {
    name: 'MiniMax-M2.7',
    displayName: 'MiniMax M2.7',
    provider: 'minimax',
    contextWindow: 128000,
    task: 'chat' as const,
  },
  {
    name: 'MiniMax-M2.5-highspeed',
    displayName: 'MiniMax M2.5 Highspeed',
    provider: 'minimax',
    contextWindow: 128000,
    task: 'chat' as const,
  },
  {
    name: 'MiniMax-M2.5',
    displayName: 'MiniMax M2.5',
    provider: 'minimax',
    contextWindow: 128000,
    task: 'chat' as const,
  },
  {
    name: 'MiniMax-M2-highspeed',
    displayName: 'MiniMax M2 Highspeed',
    provider: 'minimax',
    contextWindow: 128000,
    task: 'chat' as const,
  },
  {
    name: 'MiniMax-M2',
    displayName: 'MiniMax M2',
    provider: 'minimax',
    contextWindow: 128000,
    task: 'chat' as const,
  },
  {
    name: 'MiniMax-M3',
    displayName: 'MiniMax M3',
    provider: 'minimax',
    contextWindow: 256000,
    task: 'chat' as const,
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

/**
 * 把模型名转为侧栏/消息区显示用的「首字母 + 配色」标记。
 *
 * 设计约束：
 * - 永不展示真实人脸（合规）
 * - 用首字母抽象表达，颜色按 provider 固定映射（一致性 > 美观）
 * - 返回稳定的字符串索引（用于 React key，不依赖随机色）
 */
export interface ModelAvatar {
  letter: string;
  bgHsl: string;   // 用于 inline style: hsl(${bgHsl})
}

export function getModelAvatar(modelName: string): ModelAvatar {
  // 先按 model.displayName / name 取首字母（取首个字母 + kebab-case 处理）
  const m = getModel(modelName);
  const display = m?.displayName ?? modelName;
  // 优先按 provider 映射字母（DeepSeek → D / GLM → G / Claude → C / Qwen → Q / Gemini → J）
  const letterByProvider: Record<string, string> = {
    deepseek: 'D',
    zhipu: 'G',
    openai: 'O',
    anthropic: 'C',
    gemini: 'J',
    qwen: 'Q',
    ollama: 'L',
  };
  // 已知 model：按 provider 映射（D/G/O/C/J/Q/L）
  // 未知 model：显示 '?' 占位，避免误用任意首字母误导用户
  let letter: string;
  if (m && letterByProvider[m.provider]) {
    letter = letterByProvider[m.provider];
  } else if (m) {
    // 已知 model 但 provider 没在映射表里：fallback 到 displayName 首字母
    letter = display.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?';
  } else {
    // 完全未知 model：用 '?' 占位
    letter = '?';
  }
  // 配色按 provider 固定（HSL），亮暗主题都用同一组，亮度差异由 oklch token 解决
  const colorByProvider: Record<string, string> = {
    deepseek: '220 75% 55%',   // 深蓝
    zhipu: '140 60% 45%',      // 绿
    openai: '15 80% 55%',      // 橙
    anthropic: '270 60% 55%',  // 紫
    gemini: '200 80% 50%',     // 天蓝
    qwen: '340 70% 55%',       // 品红
    ollama: '40 70% 50%',      // 土黄
  };
  return { letter, bgHsl: colorByProvider[m?.provider ?? ''] ?? '220 10% 50%' };
}

/** 默认 Provider（用于"无配置时使用"） */
export const DEFAULT_MODEL = 'deepseek-flash';

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
  // DeepSeek：官方已于 2026-07 弃用 deepseek-chat / deepseek-reasoner，统一为 deepseek-flash
  'deepseek-v4-flash': 'deepseek-flash', // 官方旧名 → 新名（2026-09）
  'deepseek-chat':     'deepseek-flash', // 已弃用
  'deepseek-reasoner': 'deepseek-flash', // 已弃用
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
 * 决策 route-A：chat 任务用 deepseek-v4-flash（推理强，对话体验好）
 * 决策 route-B：code-analysis / score 任务用 deepseek-chat（非推理，结构化输出稳定）
 *
 * 关键差异：
 *   - deepseek-v4-flash 是推理模型，所有 token 花在 reasoning_content（思维链），
 *     message.content 是空字符串 —— 这会让 analysis.run 的 JSON 解析失败
 *   - deepseek-chat 是普通对话模型，message.content 正常输出 JSON
 *
 * 调用方可传入 model 参数覆盖
 */
export const CHOOSE_MODEL = {
  score: DEFAULT_MODEL,                        // 统一用 deepseek-flash
  'code-analysis': DEFAULT_MODEL,             // 同上：代码审查也用 deepseek-flash
  chat: DEFAULT_MODEL,                        // 对话任务
} as const;
