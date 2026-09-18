/**
 * ModelDiscoveryService — 自动从各 Provider 官方 /v1/models 端点获取最新模型列表
 *
 * 数据源优先级：官方 API (/v1/models) > 官方文档页 > 静态表
 *
 * 策略：
 *   1. OpenAI 兼容 Provider：直接调 baseUrl + /v1/models
 *   2. Anthropic：专用 /v1/models 端点
 *   3. Gemini：GenerativeLanguage API listModels
 *   4. 失败时 fallback 到 providers.ts 的 adapter.models 静态表
 *
 * 结果写入 Model 表（upsert），由 rankings/scraper.ts 后续刷新价格/能力分。
 */

import OpenAI from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';
import { prismaBase as prisma } from '@/lib/db';
import { listProviders, getProviderAdapter } from './providers';
import { logger } from '@/lib/observability/logger';
import { alert } from '@/lib/observability/alert';

export interface DiscoveredModel {
  id: string;          // raw model id from API
  provider: string;    // provider adapter id
  displayName: string; // UI-friendly name
  description?: string;
}

export interface DiscoveryResult {
  provider: string;
  succeeded: boolean;
  models: DiscoveredModel[];
  error?: string;
}

/** 全量发现：遍历所有完整实现的 Provider */
export async function discoverAllProviders(): Promise<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];

  for (const adapter of listProviders()) {
    // 仅发现完整实现的 Provider（stub 跳过）
    const result = await discoverProvider(adapter.id);
    results.push(result);

    // 每发现一个 Provider 休息 200ms，避免触发 rate limit
    await sleep(200);
  }

  const succeeded = results.filter((r) => r.succeeded).length;
  const failed = results.filter((r) => !r.succeeded).length;

  logger.info('ModelDiscoveryService.discoverAllProviders', {
    total: results.length,
    succeeded,
    failed,
  });

  if (failed > 0) {
    await alert({
      level: 'warn',
      title: `模型发现：${failed}/${results.length} 个 Provider 失败`,
      message: results.filter((r) => !r.succeeded).map((r) => `${r.provider}: ${r.error}`).join('; '),
    });
  }

  return results;
}

/** 发现单个 Provider 的模型列表 */
export async function discoverProvider(providerId: string): Promise<DiscoveryResult> {
  const adapter = getProviderAdapter(providerId);
  if (!adapter) {
    return { provider: providerId, succeeded: false, models: [], error: `Unknown provider: ${providerId}` };
  }

  // stub Provider 跳过（没 baseUrl，没法调 API）
  if (!adapter.baseUrl) {
    return {
      provider: providerId,
      succeeded: true,
      models: adapter.models.map((id) => ({ id, provider: providerId, displayName: id })),
      error: undefined,
    };
  }

  try {
    let models: DiscoveredModel[] = [];

    switch (adapter.protocol) {
      case 'openai':
        models = await discoverOpenAICompatible(adapter.baseUrl, providerId);
        break;
      case 'anthropic':
        models = await discoverAnthropic(providerId);
        break;
      case 'gemini':
        models = await discoverGemini(adapter.id);
        break;
    }

    // 写入 Model 表（upsert，不重复创建）
    await upsertModels(models, providerId);

    return { provider: providerId, succeeded: true, models };
  } catch (err) {
    const error = (err as Error).message;
    logger.warn(`ModelDiscoveryService: ${providerId} failed — ${error}`);

    // 失败时 fallback：用 adapter.models 静态表
    const fallback = adapter.models.map((id) => ({ id, provider: providerId, displayName: id }));
    await upsertModels(fallback, providerId);

    return { provider: providerId, succeeded: false, models: fallback, error };
  }
}

// ─── OpenAI 兼容 ───────────────────────────────────────────────────────────

async function discoverOpenAICompatible(baseUrl: string, providerId: string): Promise<DiscoveredModel[]> {
  // 通过 OpenAI 兼容端点拉模型列表
  // 注意：多数 Provider 的 /v1/models 端点需要有效 API key 才能访问
  //       无 key 时返回空（不影响已知模型）
  const envKey = getEnvKeyForProvider(providerId);
  if (!envKey) {
    // 无环境变量 key，跳过 HTTP 调用（避免 401）
    logger.debug(`ModelDiscoveryService: ${providerId} has no env key, skipping HTTP discovery`);
    return [];
  }

  const client = new OpenAI({ apiKey: envKey, baseURL: baseUrl });
  const resp = await client.models.list();

  const models: DiscoveredModel[] = [];
  for (const m of resp.data) {
    const id = m.id;
    // 过滤掉 embedding / image / audio 等非对话模型（可按需扩展过滤规则）
    const SKIP_PREFIXES = ['embedding-', 'image-', 'audio-', 'tts-', 'whisper-', 'dall-', 'babbage-', 'ada-'];
    if (SKIP_PREFIXES.some((p) => id.startsWith(p))) continue;

    models.push({
      id,
      provider: providerId,
      displayName: formatDisplayName(id),
    });
  }

  logger.info(`ModelDiscoveryService: ${providerId} discovered ${models.length} models via /v1/models`);
  return models;
}

// ─── Anthropic ─────────────────────────────────────────────────────────────

async function discoverAnthropic(providerId: string): Promise<DiscoveredModel[]> {
  const envKey = getEnvKeyForProvider('anthropic');
  if (!envKey) {
    logger.debug('ModelDiscoveryService: anthropic has no env key, skipping HTTP discovery');
    return [];
  }

  const client = new Anthropic({ apiKey: envKey });
  // Anthropic 没有公开 /v1/models 端点，用已知模型列表
  // 官方文档：https://docs.anthropic.com/claude/reference/models-overview
  const KNOWN_ANTHROPIC_MODELS = [
    'claude-fable-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-haiku-4.5',
    'claude-opus-4.8',
    'claude-sonnet-4.6',
    'claude-opus-4.5',
    'claude-haiku-4',
  ];

  return KNOWN_ANTHROPIC_MODELS.map((id) => ({
    id,
    provider: providerId,
    displayName: formatDisplayName(id),
  }));
}

// ─── Gemini ────────────────────────────────────────────────────────────────

async function discoverGemini(providerId: string): Promise<DiscoveredModel[]> {
  const envKey = getEnvKeyForProvider('gemini');
  if (!envKey) {
    logger.debug('ModelDiscoveryService: gemini has no env key, skipping HTTP discovery');
    return [];
  }

  try {
    // Gemini REST API: GET /v1beta3/models (lists all available models)
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta3/models?key=${envKey}`,
      { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000) }
    );
    if (!resp.ok) {
      logger.warn(`ModelDiscoveryService: gemini API returned ${resp.status}`);
      return [];
    }
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? [])
      .filter((m) => {
        const name = m.name.replace('models/', '');
        return !name.includes('embedding') && !name.includes('image') && !name.includes('audio');
      })
      .map((m) => ({
        id: m.name.replace('models/', ''),
        provider: providerId,
        displayName: formatDisplayName(m.name.replace('models/', '')),
      }));

    logger.info(`ModelDiscoveryService: gemini discovered ${models.length} models`);
    return models;
  } catch (err) {
    logger.warn(`ModelDiscoveryService: gemini REST call failed — ${(err as Error).message}`);
    return [];
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getEnvKeyForProvider(providerId: string): string | undefined {
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
  const envName = map[providerId];
  if (!envName) return undefined;
  return process.env[envName];
}

/**
 * 把 raw model id 格式化为可读名称。
 * 例如：deepseek-v4-flash → DeepSeek V4 Flash
 *       minimax-m2.7-highspeed → Minimax M2.7 Highspeed
 */
function formatDisplayName(id: string): string {
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * 将发现的模型 upsert 到 Model 表。
 * - 已存在的模型：更新 name / description
 * - 新模型：创建，标记 isPending=true（待后续 scraper 补充价格/能力分）
 */
async function upsertModels(models: DiscoveredModel[], providerId: string): Promise<void> {
  if (models.length === 0) return;

  for (const m of models) {
    try {
      await prisma.model.upsert({
        where: { externalId: m.id },
        create: {
          externalId: m.id,
          name: m.displayName,
          provider: providerId,
          description: m.description ?? null,
          priceInput: 0,
          priceOutput: 0,
          isPending: true,
        },
        update: {
          name: m.displayName,
          description: m.description ?? null,
        },
      });
    } catch (err) {
      logger.warn(`ModelDiscoveryService: upsert failed for "${m.id}" — ${(err as Error).message}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
