// 来源：d:\1Money\aihub\src\lib\ai\langchain-adapter.ts (拆分批次 3)
//
// 职责：chatLC 入口函数 + recordUsageIfNeeded helper。
//
// 行为：
//   chatLC 与 router.ts 的 chat() 行为完全等价：
//   - 多租户 key 解析（resolveApiKey）
//   - Dev mode mock（dev-mock 命中直接 return placeholder，与 router.ts 一致）
//   - Usage tracking（recordUsage，skipUsage 选项可跳过）
//   - 内部差异：OpenAI 兼容 / Anthropic 走 LangChain LCEL，Gemini 保留现状 SDK
//
// 依赖：models、providers、key-resolver、usage、pricing、protocols、logger
//
// 过期条件：
//   - LangChain 主版本升级（0.3 → 1.x）→ 重写所有 LangChain 调用点
//   - 新增 Provider 类型 → 在 protocols 中新增分支
//   - recordUsage / calculateCost / resolveApiKey 签名变更 → 同步调整

import type { ChatMessage, ChatOptions, ChatResult } from '../router';
import { resolveModelAlias, getModel } from '../models';
import { getProviderAdapter } from '../providers';
import { resolveApiKey } from '../key-resolver';
import { recordUsage } from '../../usage';
import { calculateCost } from '../pricing';
import { logger } from '../../observability/logger';
import { chatViaLC } from './protocols';

/**
 * chatLC — LangChain 版的 chat()
 *
 * @param model        模型名（必须 in SUPPORTED_MODELS）
 * @param tenantId     租户 ID（用于解析 ApiKey）
 * @param messages     消息数组（OpenAI 协议格式）
 * @param options      温度 / maxTokens / devMock / thinking / reasoningEffort / skipUsage
 * @returns            ChatResult { content: string, usage: { input, output } }
 */
export async function chatLC(
  model: string,
  tenantId: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const t0 = Date.now();

  // ── Step 1: 解析模型元数据 ──────────────────────────────────────────
  const resolvedName = resolveModelAlias(model);
  const supported = getModel(resolvedName);
  if (!supported) {
    throw new Error(`[chatLC] Unknown model "${model}" — not in SUPPORTED_MODELS.`);
  }

  const adapter = getProviderAdapter(supported.provider);
  if (!adapter) {
    throw new Error(`[chatLC] Unknown provider "${supported.provider}".`);
  }

  // ── Step 2: Dev mode mock（与 router.ts L99-L108 完全一致）─────────
  // 修复 Bug3：原 chatLC 把 dev-mock 当成"只检查"，落入 Step 3 又 resolveApiKey 一次（重复 DB 查询）
  // 现改为：命中 dev-mock 直接 return placeholder（与 router.ts 一致）
  if (options.devMock !== false && process.env.NODE_ENV !== 'production') {
    const resolvedDev = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
    if (!resolvedDev?.apiKey) {
      logger.debug('[chatLC] dev mock: no api key, returning placeholder', {
        model,
        provider: supported.provider,
      });
      return {
        content: `[dev-mode mock] Provider "${supported.displayName}" (${supported.name}) 暂无可用 key。生产环境请配置 API Key。`,
        usage: { input: 0, output: 0 },
      };
    }
    // dev mock 路径：已有 key，直接进入真实调用（不重复 resolve）
    const devResult = await chatViaLC(
      adapter.protocol,
      resolvedDev.apiKey,
      adapter.baseUrl,
      supported.name,
      messages,
      options
    );
    // dev mock 也走 recordUsage（除非 skipUsage），保持与 chat() 行为一致
    return await recordUsageIfNeeded(devResult, supported, options, tenantId, t0);
  }

  // ── Step 3: 生产环境解析多租户 API key ────────────────────────────
  const resolved = await resolveApiKey(tenantId, supported.provider, { model: supported.name });
  if (!resolved?.apiKey) {
    throw new Error(
      `[chatLC] 未配置 API Key（请在设置页「AI 模型 Key」添加，或设置环境变量）。Provider: ${supported.provider}`,
    );
  }

  // ── Step 4: 分协议调用 ────────────────────────────────────────────
  const result = await chatViaLC(
    adapter.protocol,
    resolved.apiKey,
    adapter.baseUrl,
    supported.name,
    messages,
    options
  );

  return await recordUsageIfNeeded(result, supported, options, tenantId, t0);
}

/**
 * recordUsageIfNeeded — Bug3 修复抽出的 helper
 *
 * 行为：
 * - skipUsage=true → 不记
 * - usage.input+output=0 → 不记
 * - 其它 → recordUsage（失败 warn 但不抛）
 *
 * @returns 始终返回原 ChatResult（无论 recordUsage 成功与否）
 */
export async function recordUsageIfNeeded(
  result: ChatResult,
  supported: { name: string; provider: string; displayName: string },
  options: ChatOptions,
  tenantId: string,
  t0: number,
): Promise<ChatResult> {
  const duration = Date.now() - t0;

  logger.debug('[chatLC] call completed', {
    model: supported.name,
    provider: supported.provider,
    contentLen: result.content.length,
    usage: result.usage,
    duration,
  });

  if (options.skipUsage) {
    logger.debug('[chatLC] skipUsage=true, 跳过内部 recordUsage（由调用方负责）', {
      model: supported.name,
      provider: supported.provider,
    });
    return result;
  }

  if (result.usage.input + result.usage.output > 0) {
    try {
      await recordUsage({
        tenantId,
        modelId: supported.name,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cost: calculateCost(supported.name, result.usage.input, result.usage.output, 0),
        kind: 'chat',
      });
    } catch (err) {
      logger.warn('[chatLC] recordUsage failed', { error: (err as Error).message });
    }
  }

  return result;
}
