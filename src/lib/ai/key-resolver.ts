/**
 * API Key 解析器：优先查用户 ApiKey 表，没有则 fallback 到环境变量
 *
 * 策略（决策 Q3 keypool-A）：
 *   1. 先查本租户的 ApiKey 表（encryptedKey 可解密）
 *   2. 如果表里没有（或解密失败），读环境变量对应 key
 *
 * 安全约束：
 *   - encryptedKey 用 AES-256-GCM 加密，密钥是 APP_SECRET（不进 DB）
 *   - 即使 DB 被读，没有 APP_SECRET 也无法还原 key
 */

import { prismaRaw } from '../db';
import { getProviderAdapter } from './providers';
import { createHash } from 'crypto';
import { decrypt } from '../crypto';
import { logger } from '../observability/logger';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ResolvedKey {
  apiKey: string;
  source: 'user' | 'system';
  /** 仅 user 时有效：key 的后 4 位（用于 UI 展示） */
  keyLast4?: string;
}

// ─── Main resolver ──────────────────────────────────────────────────────────

/**
 * 解析给定 tenant 的 Provider API key。
 *
 * @param tenantId  - 租户 ID（用于查询 ApiKey 表）
 * @param provider  - Provider ID（如 'deepseek'）
 * @param opts.model     - 可选：模型名（预留）
 * @param opts.userApiKey - 可选：用户直接传入的明文 key（优先级最高）
 */
export async function resolveApiKey(
  tenantId: string,
  provider: string,
  opts: { model?: string; userApiKey?: string } = {}
): Promise<ResolvedKey | null> {
  // 1. 用户直接传入的明文 key 优先级最高（settings 页测试连接时传入）
  if (opts.userApiKey) {
    return { apiKey: opts.userApiKey, source: 'user' };
  }

  // 2. 查本租户 ApiKey 表（优先用 encryptedKey）
  const adapter = getProviderAdapter(provider);
  if (!adapter) return null;

  const dbKey = await prismaRaw.apiKey.findFirst({
    where: { tenantId, provider, deletedAt: null },
    select: { keyHash: true, keyLast4: true, encryptedKey: true },
    orderBy: { createdAt: 'desc' },
  });

  if (dbKey?.encryptedKey) {
    try {
      const plainKey = decrypt(dbKey.encryptedKey);
      return { apiKey: plainKey, source: 'user', keyLast4: dbKey.keyLast4 };
    } catch (e) {
      // 解密失败（APP_SECRET 变了？）→ 记录 warn，回退到 env
      logger.warn('resolveApiKey: decrypt failed, falling back to env', {
        tenantId,
        provider,
        error: (e as Error).message,
      });
    }
  }

  // 3. Fallback 到环境变量（system key 兜底）
  const systemKey = systemEnvKey(provider);
  if (systemKey) {
    return { apiKey: systemKey, source: 'system' };
  }

  return null;
}

/**
 * 验证用户传入的明文 key 是否匹配 DB 里存的 hash
 * （用于 settings 页添加 key 时校验用户输入）
 */
export async function verifyKeyHash(plainKey: string, storedHash: string): Promise<boolean> {
  const hash = createHash('sha256').update(plainKey).digest('hex');
  return hash === storedHash;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

let _startupWarned = false;

/**
 * 模块加载时检查至少一个核心 env key 是否存在；
 * 仅警告一次（开发/部署时容易忘配）
 */
export function warnOnMissingSystemKeys() {
  if (_startupWarned) return;
  _startupWarned = true;
  const required = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length === required.length) {
    logger.warn(
      `[AIHub] 未检测到任何 AI API Key：${missing.join(', ')}。请在环境变量中配置至少一个。`,
    );
  } else if (missing.length > 0) {
    logger.warn(`[AIHub] 部分核心 key 缺失：${missing.join(', ')}`);
  }
}

function systemEnvKey(provider: string): string | undefined {
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
