// 来源：审查报告_v0.2 Q4 + 审查报告_v0.3 Q4 深度分析
// 问题：三处硬编码词表（前端 / 定价表 / 路由）零交集 → 费用恒记 0
// 修复：单一事实源，前端 / 定价表 / 路由全部从这处派生
// 防回归：改模型只需改这一处，任何遗漏都会被 TypeScript 枚举校验捕获

export const SUPPORTED_MODELS = [
  // 通用对话模型
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
  {
    name: 'moonshot-v1-8k',
    displayName: 'Kimi V1 8K',
    provider: 'kimi',
    contextWindow: 8000,
    task: 'chat' as const,
  },
  {
    name: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextWindow: 200000,
    task: 'chat' as const,
  },
] as const;

/** 前端下拉选择器的类型-safe 枚举 */
export type SupportedModelName = (typeof SUPPORTED_MODELS)[number]['name'];

/** zod 校验用的 tuple（chat.ts 后端入参白名单） */
export const SUPPORTED_MODEL_NAMES = SUPPORTED_MODELS.map((m) => m.name) as unknown as readonly [string, ...string[]];

/** 校验模型名是否在白名单内 */
export function isSupportedModel(name: string): name is SupportedModelName {
  return SUPPORTED_MODELS.some((m) => m.name === name);
}

/** 按任务类型选模型（评分用大模型，代码分析用便宜模型） */
export const CHOOSE_MODEL = {
  score: 'claude-sonnet-4-20250514',
  'code-analysis': 'deepseek-chat',
  chat: 'moonshot-v1-8k',
} as const;

export type TaskType = keyof typeof CHOOSE_MODEL;
