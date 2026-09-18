/**
 * AI 对话风格 → System Prompt 构建器
 *
 * 决策 Q5：仅 chat 用，news/briefing/analysis 不注。
 * 决策 hist-A：system prompt 仅存在于内存数组，绝不写 DB。
 *
 * 设计原则：
 *   - 纯函数：给定 prefs，返回拼接后的 system prompt 字符串
 *   - 温和提示词：不影响模型原有能力，只调节语气/风格
 *   - 安全：所有输入字段有 max 长度限制，避免 prompt 注入
 */

import type { Prisma } from '@prisma/client';

// ─── Preset style prompts ───────────────────────────────────────────────────

const PRESET_STYLE_PROMPTS: Record<string, string> = {
  rigorous:
    '你是一个严谨的助手。引用必须有据可查，对不确定的内容明确说明。回答要逻辑清晰、论据充分。',
  humorous:
    '你是一个幽默的助手。可以用比喻和小幽默活跃气氛，但不要刻意玩梗、不要为了幽默而牺牲准确性。',
  friendly:
    '你是一个友善、温和的助手。语气自然亲切，像和朋友聊天一样。回答简洁但不冷淡。',
  concise:
    '你追求简洁。能用一句话说清的绝不用两句。直接回答问题，不寒暄不铺垫，给出最有价值的信息就停。',
  literary:
    '你的语言带文学色彩，注重表达的美感。用词考究、句式灵动，但不过度修饰而牺牲准确性。适当使用修辞让回答更生动。',
};

const LANG_PROMPTS: Record<string, string> = {
  zh: '用中文回答所有问题。',
  en: 'Respond to all questions in English.',
  auto: '语言跟随用户输入：用户用中文问就用中文答，用英文问就用英文答。',
};

const REASONING_PROMPTS: Record<string, string> = {
  normal: '按常规方式回答问题，不需要刻意展示推理过程。',
  detailed: '对于复杂问题，展开详细的推理过程（think step by step），让回答更具说服力。',
  none: '直接给出答案，不需要展示思考过程或推理步骤。',
};

// ─── Max lengths ────────────────────────────────────────────────────────────

const MAX_OPENING_LINE = 500;
const MAX_PERSONA_ROLE = 500;
const MAX_CUSTOM_RULES = 2000;
const MAX_TOTAL_PROMPT = 8000; // safety guard

// ─── Builder ────────────────────────────────────────────────────────────────

export interface ChatStylePrefs {
  chatPresetStyle: string | null;
  chatOpeningLine: string | null;
  chatPersonaRole: string | null;
  chatCustomRules: string | null;
  chatResponseLang: string | null;
  chatReasoningDepth: string | null;
}

/**
 * 构建 system prompt。
 * 返回字符串，失败时返回空字符串。
 */
export function buildSystemPrompt(prefs: ChatStylePrefs): string {
  const parts: string[] = [];

  // 1. 预设风格（核心人格）
  const style = prefs.chatPresetStyle ?? 'friendly';
  const stylePrompt = PRESET_STYLE_PROMPTS[style] ?? PRESET_STYLE_PROMPTS.friendly;
  parts.push(stylePrompt);

  // 2. 自定义开场白
  const openingLine = (prefs.chatOpeningLine ?? '').trim();
  if (openingLine.length > 0 && openingLine.length <= MAX_OPENING_LINE) {
    parts.push(`每次对话开始时，先用这句话打招呼：\n"${escapeForPrompt(openingLine)}"`);
  }

  // 3. 角色设定
  const personaRole = (prefs.chatPersonaRole ?? '').trim();
  if (personaRole.length > 0 && personaRole.length <= MAX_PERSONA_ROLE) {
    parts.push(`你的角色：${escapeForPrompt(personaRole)}`);
  }

  // 4. 语言偏好
  const lang = prefs.chatResponseLang ?? 'auto';
  parts.push(LANG_PROMPTS[lang] ?? LANG_PROMPTS.auto);

  // 5. 思考深度
  const reasoning = prefs.chatReasoningDepth ?? 'normal';
  parts.push(REASONING_PROMPTS[reasoning] ?? REASONING_PROMPTS.normal);

  // 6. 自定义规则（每行一条，最多 MAX_CUSTOM_RULES）
  const customRules = (prefs.chatCustomRules ?? '').trim();
  if (customRules.length > 0) {
    const lines = customRules
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 50); // 最多 50 条规则

    if (lines.length > 0) {
      parts.push(`附加规则：\n${lines.map((l, i) => `${i + 1}. ${escapeForPrompt(l)}`).join('\n')}`);
    }
  }

  const result = parts.join('\n\n');

  // Safety guard：超过最大长度时截断
  if (result.length > MAX_TOTAL_PROMPT) {
    return result.slice(0, MAX_TOTAL_PROMPT - 3) + '...';
  }

  return result;
}

/**
 * 防止 prompt injection：将用户输入中的换行和引号转义
 */
function escapeForPrompt(text: string): string {
  return text.replace(/\n/g, ' ').replace(/"/g, '\\"');
}

/**
 * 校验 6 个字段，返回清理后的 prefs（防注入）
 */
export function sanitizeChatStylePrefs(raw: Partial<ChatStylePrefs>): ChatStylePrefs {
  return {
    chatPresetStyle: raw.chatPresetStyle ?? 'friendly',
    chatOpeningLine: truncate((raw.chatOpeningLine ?? '').trim(), MAX_OPENING_LINE) || null,
    chatPersonaRole: truncate((raw.chatPersonaRole ?? '').trim(), MAX_PERSONA_ROLE) || null,
    chatCustomRules: truncate((raw.chatCustomRules ?? '').trim(), MAX_CUSTOM_RULES),
    chatResponseLang: ['zh', 'en', 'auto'].includes(raw.chatResponseLang ?? '') ? (raw.chatResponseLang ?? 'auto') : 'auto',
    chatReasoningDepth: ['normal', 'detailed', 'none'].includes(raw.chatReasoningDepth ?? '') ? (raw.chatReasoningDepth ?? 'normal') : 'normal',
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
