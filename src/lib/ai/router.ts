// 来源：d:\1Money\design\AI集成.md §四 模型路由策略
// Q4 修复：从 src/lib/ai/models.ts 单一事实源派生，不再重复硬编码

import { litellm } from './client';
import type { ChatMessage } from './client';
import { CHOOSE_MODEL, type TaskType } from './models';

export interface RouteDecision {
  model: string;
  reason: string;
}

export function chooseModel(task: TaskType): RouteDecision {
  switch (task) {
    case 'score':
      return { model: CHOOSE_MODEL.score, reason: '评分需要细致推理' };
    case 'code-analysis':
      return { model: CHOOSE_MODEL['code-analysis'], reason: '代码量大、成本敏感' };
    case 'chat':
      return { model: CHOOSE_MODEL.chat, reason: '中文对话、长上下文' };
    default: {
      const _exhaustive: never = task;
      throw new Error(`Unknown task type: ${String(_exhaustive)}`);
    }
  }
}

export async function chat(
  model: string,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ content: string; usage: { input: number; output: number } }> {
  const resp = await litellm.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 4096,
  });

  return {
    content: resp.choices[0]?.message?.content ?? '',
    usage: {
      input: resp.usage?.prompt_tokens ?? 0,
      output: resp.usage?.completion_tokens ?? 0,
    },
  };
}