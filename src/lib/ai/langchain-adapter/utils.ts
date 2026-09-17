// 来源：d:\1Money\aihub\src\lib\ai\langchain-adapter.ts (拆分批次 1)
//
// 职责：langchain-adapter 的纯函数工具集。
//   - estimateTokens：fallback 时估算 token 数（中文 1.5/字，英文 1.25/词）
//   - mergeMessages：合并 ChatMessage[] 为 system + user 两段文本
//
// 无副作用、无外部依赖（仅依赖 types）。可独立单测。
//
// 过期条件：
//   - 估算公式变化（更精确的分词器）→ 调整系数
//   - ChatMessage schema 变化 → mergeMessages 调整

import type { ChatMessage } from '../router';

/**
 * 估算 token 数（按中文字符 ~1.5 token / 字，英文 ~1.25 token / 词）。
 *
 * 仅在 callback 未捕获到真实 usage 时作为兜底（精度 ±20%）。
 * 真实 usage 应由 UsageCallbackHandler 在 LLM 响应后捕获。
 *
 * 2026-09-17 Bug19 修复：原签名只接收 content（output），input 永远返回 0
 *                   导致 fallback 时计费 input 漏算。现改为分别接收 inputText 和 outputText。
 */
export function estimateTokens(inputText: string, outputText: string): { input: number; output: number } {
  const estimate = (text: string): number => {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/\S+/g) || []).length;
    return Math.ceil(chineseChars * 1.5 + englishWords * 1.25);
  };
  return {
    input: estimate(inputText),
    output: estimate(outputText),
  };
}

/** 合并 messages 为 system + user 两段文本（PromptTemplate 单变量用） */
export function mergeMessages(messages: ChatMessage[]): { system: string | undefined; user: string } {
  const system = messages.find((m) => m.role === 'system')?.content;
  const userParts = messages
    .filter((m) => m.role !== 'system')
    .map((m) => m.content)
    .join('\n');
  return { system, user: userParts };
}
