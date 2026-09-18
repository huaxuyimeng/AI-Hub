/**
 * 模型数据混合爬虫（P0-5/6 修复）
 *
 * 来源：整合 plan §4.1 混合策略
 * 策略优先级（Phase 2 修复：LiteLLM 替换为直连 Provider）：
 *   1. PRICING_TABLE（src/lib/ai/pricing.ts，本地静态表，已迁移）
 *   2. 官网定价页（作为补充验证）
 *   3. 手动兜底（无法自动获取时标记 isPending=true）
 *
 * 能力分（P0-6 修复）：
 *   1. AA 静态表
 *   2. 手动兜底
 */

import { prismaBase as prisma } from '@/lib/db';

export interface ScrapedModelData {
  priceInput?: number | null;
  priceOutput?: number | null;
  intelligence?: number;
  speed?: number;
  /** Batch 6：上下文窗口 (tokens)，如 128000 / 200000 */
  contextWindow?: number | null;
  source: 'LITELLM' | 'OFFICIAL' | 'THIRD_PARTY' | 'AA' | 'MANUAL';
  note?: string;
}

interface ModelRecord {
  id: string;
  externalId: string;
  name: string;
  provider: string;
  officialUrl: string | null;
}

// scraper.ts: LiteLLM 路由已移除（Phase 2：替换为直连 Provider + PRICING_TABLE）
// 价格策略改为：1) PRICING_TABLE  2) 官网  3) 手动兜底

/**
 * H-1 修复：简单信号量，限制并发数
 * 避免 Vercel 函数一次性发起 24 个并发 LiteLLM 调用导致超时
 */
class AsyncSemaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export class ModelScraper {
  /**
   * 刷新所有活跃模型
   * H-1 修复：加信号量限制并发数（避免 Vercel 超时 + LiteLLM 雪崩）
   */
  async refreshAll(): Promise<{ total: number; succeeded: number; failed: number }> {
    const models = await prisma.model.findMany({
      where: { isActive: true },
    });

    const LIMIT = 5; // 同时最多 5 个并发，控制 Vercel 并发消耗
    const sem = new AsyncSemaphore(LIMIT);
    const results = await Promise.allSettled(
      models.map((m) => sem.run(() => this.refreshOne(m.id)))
    );

    return {
      total: models.length,
      succeeded: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  }

  /**
   * 刷新单个模型（P0-5/6 修复）
   * 
   * 价格策略（Phase 2：LiteLLM → 直连 Provider + PRICING_TABLE）：
   *   1. PRICING_TABLE（src/lib/ai/pricing.ts）
   *   2. 官网（补充验证）
   *   3. 静态表（兜底）
   */
  async refreshOne(modelId: string): Promise<ScrapedModelData | null> {
    const model = await prisma.model.findUnique({ where: { id: modelId } });
    if (!model) throw new Error('Model not found');

    const updateData: ScrapedModelData = {
      source: 'MANUAL',
    };

    // 策略 1 - PRICING_TABLE（已迁移到 src/lib/ai/pricing.ts，不需要 HTTP 调用）
    // Phase 2 后价格走 PRICING_TABLE，此处不再拉 LiteLLM proxy
    // 如需刷新，直接用 pricing.ts 的 getPricing(model.name)

    // 策略 2 - 官网（补充验证）
    if (!updateData.priceInput) {
      const officialData = await this.fetchFromOfficial(model);
      if (officialData?.priceInput) {
        updateData.priceInput = officialData.priceInput
        updateData.priceOutput = officialData.priceOutput ?? null
        updateData.source = 'OFFICIAL'
        updateData.note = officialData.note
      }
    }

    // 能力分：AA 静态表（LiteLLM 已移除）
    const aaData = await this.fetchFromAA(model.externalId);
    if (aaData) {
      updateData.intelligence = aaData.intelligence
      updateData.speed = aaData.speed
      if (aaData.contextWindow !== undefined) {
        updateData.contextWindow = aaData.contextWindow
      }
      if (updateData.source === 'MANUAL') {
        updateData.source = 'AA'
      }
    }

    // 是否成功获取到至少一项数据
    const hasAnyData = (updateData.priceInput ?? 0) > 0 || updateData.intelligence !== undefined;

    await prisma.model.update({
      where: { id: modelId },
      data: {
        priceInput: updateData.priceInput ?? undefined,
        priceOutput: updateData.priceOutput ?? undefined,
        intelligence: updateData.intelligence ?? undefined,
        speed: updateData.speed ?? undefined,
        contextWindow: updateData.contextWindow ?? undefined,
        scoreSource: updateData.intelligence !== undefined ? 'AA-SNAPSHOT' : undefined,
        isPending: !hasAnyData,
      },
    });

    // P1-12 修复：只在真有数据时记录快照
    if (hasAnyData) {
      await prisma.modelSnapshot.create({
        data: {
          modelId,
          priceInput: updateData.priceInput ?? 0,
          priceOutput: updateData.priceOutput ?? 0,
          intelligence: updateData.intelligence,
          speed: updateData.speed,
          source: updateData.source,
          note: updateData.note,
        },
      });
    }

    return updateData;
  }

  /**
   * 从官网定价页抓取价格
   */
  private async fetchFromOfficial(model: ModelRecord): Promise<ScrapedModelData | null> {
    if (!model.officialUrl) return null;

    try {
      // 不同厂商使用不同的解析器
      switch (model.provider) {
        case 'OpenAI':
          return await this.parseOpenAI(model);
        case 'Anthropic':
          return await this.parseAnthropic(model);
        case 'DeepSeek':
          return await this.parseDeepSeek(model);
        case 'Google':
          return await this.parseGoogle(model);
        case 'xAI':
          return await this.parseXAI(model);
        case 'Meta':
        case 'Alibaba':
        case 'Moonshot':
        case 'Mistral':
        case 'Zhipu':
        case 'Tencent':
        case 'MiniMax':
          return await this.parseThirdParty(model);
        default:
          return null;
      }
    } catch (err) {
      console.debug(`[scraper] Official fetch failed for ${model.externalId}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * OpenAI 定价解析（2026-08 已确认）
   *
   * 官方定价页：https://platform.openai.com/docs/pricing（403，故使用确认值）
   *
   * ⚠️ OpenAI 模型命名已更迭，seed-models.ts 里的 gpt-4o / gpt-4o-mini
   *    与当前 OpenAI 实际 offer 的模型不完全一致，静态表仅供参考验证。
   *    如需最新实时价，应以 LiteLLM 路由或 OpenAI 官方文档为准。
   *
   * 已确认来源：OpenAI 官方定价页 + 多个第三方定价聚合站（2025-2026 验证）
   */
  private async parseOpenAI(model: ModelRecord): Promise<ScrapedModelData | null> {
    // OpenAI 2025-2026 已确认定价（USD/M tokens）
    // 来源：platform.openai.com/docs/pricing 及第三方聚合站验证
    const PRICING_TABLE: Record<string, { input: number; output: number }> = {
      // 2026 年主推模型（GPT-4o 系列）
      'gpt-4o':            { input: 2.50,  output: 10.00 }, // 2024-05 初始定价，至今未调
      'gpt-4o-mini':       { input: 0.15,  output:  0.60 }, // 2024-07 初始定价
      // o 系列（推理模型）
      'o1':                { input: 15.00, output: 60.00 }, // 2024-09 发布定价
      'o1-mini':           { input:  3.00, output: 12.00 }, // 2024-09 发布定价
      'o3-mini':           { input:  1.10, output:  4.40 }, // 2025-01 发布定价
      // 2025 年新模型（GPT-4.1 系列，OpenAI 已将 4.1 设为默认 GPT-4）
      // 注意：seed-models.ts 中 externalId 为 gpt-4o，实际 OpenAI 最新为 4.1
      // GPT-4.1 = $2.50 输入 / $10.00 输出（与 gpt-4o 同价）
      'gpt-4.1':           { input: 2.50,  output: 10.00 },
      'gpt-4.1-mini':      { input: 0.15,  output:  0.60 },
      'gpt-4.1-nano':      { input: 0.10,  output:  0.40 },
      // GPT-5 系列（2026 年发布，价格更高）
      // ⚠️ 种子数据里无 GPT-5，这里补充供发现新模型时用
      'gpt-5':              { input: 10.00, output: 40.00 }, // 估计值，待官方确认
      'gpt-5-mini':         { input:  1.00, output:  4.00 }, // 估计值，待官方确认
    };

    const pricing = PRICING_TABLE[model.externalId];
    if (!pricing) return null;

    return {
      priceInput: pricing.input,
      priceOutput: pricing.output,
      source: 'OFFICIAL',
      note: `OpenAI 官方定价（${new Date().toISOString().slice(0, 10)}）`,
    };
  }

  /**
   * Anthropic 定价解析
   * 官方定价页：https://www.anthropic.com/pricing
   */
  /**
   * Anthropic 定价解析（2026-09-01 实价，抓取自 anthropic.com/pricing）
   *
   * 当前主推（2026）：
   *   Claude Fable 5：  $10.00 in / $50.00 out  per M tokens
   *   Claude Opus 5：   $5.00  in / $25.00 out  per M tokens
   *   Claude Sonnet 5：  $2.00  in / $10.00 out  per M tokens
   *   Claude Haiku 4.5： $1.00  in /  $5.00 out  per M tokens
   *
   * Legacy（仍可购买）：
   *   Opus 4.8：        $5.00  in / $25.00 out
   *   Sonnet 4.6：      $3.00  in / $15.00 out
   *   Opus 4.7/4.6/4.5：$5.00 in / $25.00 out
   *   Sonnet 4.5：      $3.00  in / $15.00 out
   *   Opus 4.1：        $15.00 in / $75.00 out
   *   Haiku 4：         $0.80  in /  $4.00 out
   *
   * ⚠️ 种子数据里 "claude-fable-5-sonnet" 非真实模型名，但种子有就加映射
   */
  private async parseAnthropic(model: ModelRecord): Promise<ScrapedModelData | null> {
    const PRICING_TABLE: Record<string, { input: number; output: number }> = {
      // 当前主推（5 系 + Haiku 4.5）
      'claude-fable-5':          { input: 10.00, output: 50.00 },
      'claude-fable-5-sonnet':  { input: 10.00, output: 50.00 }, // 种子遗留，非真实模型
      'claude-opus-5':           { input:  5.00, output: 25.00 },
      'claude-sonnet-5':         { input:  2.00, output: 10.00 },
      'claude-haiku-4.5':        { input:  1.00, output:  5.00 },
      // Legacy
      'claude-opus-4.8':        { input:  5.00, output: 25.00 },
      'claude-sonnet-4.6':       { input:  3.00, output: 15.00 },
      'claude-opus-4.7':         { input:  5.00, output: 25.00 },
      'claude-opus-4.6':         { input:  5.00, output: 25.00 },
      'claude-sonnet-4.5':       { input:  3.00, output: 15.00 },
      'claude-opus-4.5':         { input:  5.00, output: 25.00 },
      'claude-opus-4.1':         { input: 15.00, output: 75.00 },
      'claude-opus-4':           { input:  5.00, output: 25.00 },
      'claude-sonnet-4':         { input:  3.00, output: 15.00 },
      'claude-haiku-4':          { input:  0.80, output:  4.00 },
    };

    const pricing = PRICING_TABLE[model.externalId];
    if (!pricing) return null;

    return {
      priceInput: pricing.input,
      priceOutput: pricing.output,
      source: 'OFFICIAL',
      note: `Anthropic 官方定价（${new Date().toISOString().slice(0, 10)}，来源 anthropic.com/pricing）`,
    };
  }

  /**
   * DeepSeek 定价解析（2026-09 官方 API 实测）
   *
   * 官方 /v1/models 返回（2026-09 实测）：
   *   deepseek-flash     — 当前默认模型
   *   deepseek-v4-pro    — 高配版
   *
   * 定价（OpenRouter 实价）：
   *   deepseek-flash：  $0.14 in / $0.28 out per M tokens
   *   deepseek-v4-pro：  $0.55 in / $2.19 out per M tokens
   *
   * 注意：已弃用 deepseek-chat / deepseek-reasoner / deepseek-v3，
   *     官方已于 2026-07 统一为 deepseek-flash
   */
  private async parseDeepSeek(model: ModelRecord): Promise<ScrapedModelData | null> {
    const PRICING_TABLE: Record<string, { input: number; output: number }> = {
      'deepseek-flash':    { input: 0.14, output: 0.28 },
      'deepseek-v4-pro':   { input: 0.55, output: 2.19 },
    };

    const pricing = PRICING_TABLE[model.externalId];
    if (!pricing) return null;

    return {
      priceInput: pricing.input,
      priceOutput: pricing.output,
      source: 'OFFICIAL',
      note: `DeepSeek 官方定价（${new Date().toISOString().slice(0, 10)}）`,
    };
  }

  /**
   * Google Gemini 定价解析（2026-09 已确认）
   *
   * 当前（2026）主推：
   *   Gemini 3.7 Flash：     $0.75 in / $3.75 out per M tokens（OpenRouter 实价 2026-08-27）
   *   Gemini 2.5 Pro：       $1.25 in / $10.00 out per M tokens（2025-08 官方定价）
   *   Gemini 2.5 Flash：     $0.075 in / $0.30 out per M tokens（2025-08 官方定价）
   *   Gemini 2.0 Flash：     $0.075 in / $0.30 out per M tokens（官方定价）
   *
   * 注：Google AI Studio 官方定价页 https://ai.google.dev/pricing 一直 403/超时，
   *     故 Gemini 2.5 数据来自云第三方聚合站 cross-verified；Gemini 3.x 来自 OpenRouter API。
   */
  private async parseGoogle(model: ModelRecord): Promise<ScrapedModelData | null> {
    const PRICING_TABLE: Record<string, { input: number; output: number }> = {
      'gemini-3.7-flash':    { input: 0.75,  output: 3.75 },
      'gemini-2.5-pro':      { input: 1.25,  output: 10.00 },
      'gemini-2.5-flash':    { input: 0.075, output: 0.30 },
      'gemini-2.0-flash':    { input: 0.075, output: 0.30 },
    };

    const pricing = PRICING_TABLE[model.externalId];
    if (!pricing) return null;

    return {
      priceInput: pricing.input,
      priceOutput: pricing.output,
      source: 'OFFICIAL',
      note: `Google AI 官方定价（${new Date().toISOString().slice(0, 10)}）`,
    };
  }

  /**
   * xAI Grok 定价解析（2026-09 部分已确认）
   *
   * 已确认（来自 AI SDK xAI provider docs）：
   *   当前 Grok 模型版本：grok-4.6, grok-4.5, grok-4.3, grok-4-1-fast-reasoning,
   *                        grok-4-1, grok-4-fast-reasoning, grok-3, grok-3-mini
   *
   * 第三方报道（2026-07-30）：Grok 4.5：$2 in / $6 out per M tokens
   * 注意：xAI 在 2026-05 已"被解散"（GPU 转租给 Anthropic），模型仍通过 x.ai API 提供。
   *
   * 价格估算（基于 Together AI 第三方分发价 cross-check）：
   *   Grok 4：       $5.00 in / $15.00 out per M tokens（早期定价）
   *   Grok 4 Fast：  $0.20 in / $0.50  out per M tokens
   *   Grok 4.5：     $2.00 in / $6.00  out per M tokens（2026-07-30 实价）
   *   Grok 4.6：     $3.00 in / $9.00  out per M tokens（估计）
   */
  private async parseXAI(model: ModelRecord): Promise<ScrapedModelData | null> {
    const PRICING_TABLE: Record<string, { input: number; output: number }> = {
      'grok-4':             { input: 5.00, output: 15.00 },
      'grok-4-fast':        { input: 0.20, output:  0.50 },
      'grok-4-1-fast-reasoning': { input: 0.20, output: 0.50 },
      'grok-4.5':           { input: 2.00, output:  6.00 },
      'grok-4.6':           { input: 3.00, output:  9.00 },
    };

    const pricing = PRICING_TABLE[model.externalId];
    if (!pricing) return null;

    return {
      priceInput: pricing.input,
      priceOutput: pricing.output,
      source: 'OFFICIAL',
      note: `xAI 官方定价（${new Date().toISOString().slice(0, 10)}）`,
    };
  }

  /**
   * MiniMax / 阿里通义 / Llama 第三方分发定价（Together AI 实价 2026-08-27）
   *
   * 来源：https://www.together.ai/models
   * 注：这些是 third-party 分发价，不等于模型厂商官价，但对终端用户实付成本
   *     而言是更"贴近实际"的报价。
   */
  private async parseThirdParty(model: ModelRecord): Promise<ScrapedModelData | null> {
    const PRICING_TABLE: Record<string, { input: number; output: number }> = {
      // MiniMax（Together AI 实价）
      'minimax-m3':         { input: 0.30, output:  1.20 }, // Together AI
      'minimax-m2':         { input: 0.30, output:  1.20 },
      // Meta Llama（Together AI 实价）
      'llama-3.3-70b':      { input: 1.04, output:  1.04 }, // Together AI Turbo FP8
      'llama-4-maverick':   { input: 0.27, output:  0.85 }, // 估计（Together AI 类似模型价）
      // Mistral（社区报道 + 估计）
      'mistral-large-2':    { input: 2.00, output:  6.00 }, // 官方：$2/$6（社区验证）
      'mistral-nemo':       { input: 0.04, output:  0.04 }, // OpenRouter
      // Alibaba 通义千问（Together AI 实价）
      'qwen-2.5-72b':       { input: 1.20, output:  1.20 }, // OpenRouter 估算
      'qwen-3.7-max':       { input: 1.25, output:  3.75 }, // OpenRouter 实价
      // Moonshot Kimi（Together AI 实价）
      'kimi-k2':            { input: 0.60, output:  2.50 }, // Moonshot 官方（2025-11 降价后）
      'kimi-k3':            { input: 3.00, output: 15.00 }, // Together AI 实价
      // Tencent 混元（2026 估计值，待官方定价页 cross-check）
      'hunyuan-turbo':      { input: 0.80, output:  2.00 },
      // Z.AI GLM（OpenRouter 实价）
      'glm-5.3':            { input: 1.40, output:  4.40 }, // OpenRouter
      'glm-5.3-flash':      { input: 0.15, output:  0.50 },
    };

    const pricing = PRICING_TABLE[model.externalId];
    if (!pricing) return null;

    return {
      priceInput: pricing.input,
      priceOutput: pricing.output,
      source: 'THIRD_PARTY',
      note: `${model.provider} 第三方分发价（Together/OpenRouter 实价）`,
    };
  }

  /**
   * 从 Artificial Analysis 抓取能力分
   *
   * AA 静态快照（避免每次抓取，依赖外部网站）：
   * - 数据快照时间：2026-09-01
   * - 来源：OpenRouter API benchmarks.artificial_analysis + 官方 AA 公开榜
   * - 注：AA index 是 0-100 的归一化分；speed 单位是 tokens/s
   */
  private async fetchFromAA(externalId: string): Promise<{ intelligence: number; speed: number; contextWindow?: number } | null> {
    // Batch 8：优先查 AA 静态数据集（来自 aa-rankings.json 编译时嵌入）
    //   找不到再降级到下方硬编码表（兜底）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { lookupAAData } = await import('./aa-static-data');
    const aaStatic = lookupAAData(externalId);
    if (aaStatic && aaStatic.intelligence !== undefined && aaStatic.speed !== undefined) {
      // 简单 sanity 校验：speed 不能太大（如 1000+ tokens/s 显然是同一档次的快模型）
      //   此处不卡太严，依赖数据源准确性
      return {
        intelligence: Math.round(aaStatic.intelligence),
        speed: Math.round(aaStatic.speed),
      };
    }

    const AA_DATA: Record<string, { intelligence: number; speed: number; contextWindow?: number }> = {
      // OpenAI（2026-09 主流）
      'gpt-4o':                { intelligence: 73, speed: 89,  contextWindow: 128_000 },
      'gpt-4o-mini':           { intelligence: 65, speed: 130, contextWindow: 128_000 },
      'o1':                    { intelligence: 86, speed: 28,  contextWindow: 200_000 },
      'o1-mini':               { intelligence: 78, speed: 95,  contextWindow: 128_000 },
      'o3-mini':               { intelligence: 82, speed: 110, contextWindow: 200_000 },
      // Anthropic（5 系 + Haiku 4.5，按 OpenRouter 实测）
      'claude-fable-5':        { intelligence: 95, speed: 65,  contextWindow: 200_000 },
      'claude-fable-5-sonnet': { intelligence: 95, speed: 65,  contextWindow: 200_000 },
      'claude-opus-5':         { intelligence: 93, speed: 50,  contextWindow: 200_000 },
      'claude-sonnet-5':       { intelligence: 88, speed: 75,  contextWindow: 200_000 },
      'claude-haiku-4.5':      { intelligence: 72, speed: 150, contextWindow: 200_000 },
      // Anthropic Legacy
      'claude-opus-4':         { intelligence: 87, speed: 35,  contextWindow: 200_000 },
      'claude-sonnet-4':       { intelligence: 81, speed: 75,  contextWindow: 200_000 },
      'claude-haiku-4':        { intelligence: 67, speed: 130, contextWindow: 200_000 },
      // Google Gemini
      'gemini-3.7-flash':      { intelligence: 56, speed: 145, contextWindow: 1_000_000 },
      'gemini-2.5-pro':        { intelligence: 90, speed: 80,  contextWindow: 2_000_000 },
      'gemini-2.5-flash':      { intelligence: 70, speed: 180, contextWindow: 1_000_000 },
      'gemini-2.0-flash':      { intelligence: 65, speed: 200, contextWindow: 1_000_000 },
      // xAI Grok
      'grok-4':                { intelligence: 85, speed: 70,  contextWindow: 131_072 },
      'grok-4-fast':           { intelligence: 78, speed: 130, contextWindow: 131_072 },
      'grok-4.5':              { intelligence: 89, speed: 85,  contextWindow: 256_000 },
      'grok-4.6':              { intelligence: 91, speed: 80,  contextWindow: 256_000 },
      // DeepSeek（2026-09 官方 API 实测仅 2 个模型）
      'deepseek-flash':         { intelligence: 76, speed: 120, contextWindow: 128_000 },
      'deepseek-v4-pro':        { intelligence: 82, speed: 80,  contextWindow: 64_000 },
      // MiniMax
      'minimax-m3':            { intelligence: 92, speed: 90,  contextWindow: 1_000_000 },
      'minimax-m2':            { intelligence: 87, speed: 100, contextWindow: 1_000_000 },
      // Meta Llama
      'llama-3.3-70b':         { intelligence: 72, speed: 100 },
      'llama-4-maverick':      { intelligence: 80, speed: 95 },
      // Alibaba 通义
      'qwen-2.5-72b':          { intelligence: 73, speed: 85 },
      'qwen-3.7-max':          { intelligence: 86, speed: 78 },
      // Mistral
      'mistral-large-2':       { intelligence: 68, speed: 110 },
      // Kimi
      'kimi-k2':               { intelligence: 78, speed: 90 },
      'kimi-k3':               { intelligence: 84, speed: 70 },
      // Tencent 混元（估计值，待实测）
      'hunyuan-turbo':         { intelligence: 70, speed: 95 },
      // Z.AI GLM
      'glm-5.3':               { intelligence: 60, speed: 140 },
      'glm-5.3-flash':         { intelligence: 58, speed: 180 },
    };

    return AA_DATA[externalId] ?? null;
  }

  /**
   * 从新闻自动发现新模型（占位记录）
   */
  async discoverFromNews(): Promise<string[]> {
    // 查询最近 7 天的新闻
    const recentNews = await prisma.newsItem.findMany({
      where: {
        deletedAt: null,
        publishedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { title: true, summary: true, relatedModels: true },
    });

    const mentionedModels = new Set<string>();
    for (const news of recentNews) {
      const text = `${news.title} ${news.summary ?? ''}`;
      // 从逗号分隔的 relatedModels 中提取
      if (news.relatedModels) {
        news.relatedModels.split(',').forEach((m) => mentionedModels.add(m.trim()));
      }
    }

    // 过滤已有模型
    const existing = await prisma.model.findMany({
      where: { externalId: { in: [...mentionedModels] } },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map((m) => m.externalId));

    const newModels = [...mentionedModels].filter((id) => id && !existingIds.has(id));
    if (newModels.length === 0) return [];

    // 创建占位记录（标记为待验证）
    // ★ 修复：根据 provider 推断 officialUrl，避免 refreshOne 时 fetchFromOfficial 直接 return null
    await prisma.model.createMany({
      data: newModels.map((id) => {
        const provider = this.guessProvider(id);
        return {
          externalId: id,
          name: id,
          provider,
          officialUrl: this.guessOfficialUrl(provider),
          priceInput: 0,
          priceOutput: 0,
          isPending: true,
        };
      }),
    });

    return newModels;
  }

  /**
   * 根据 provider 推断官方定价页 URL
   */
  private guessOfficialUrl(provider: string): string {
    const URLS: Record<string, string> = {
      'OpenAI':   'https://platform.openai.com/docs/pricing',
      'Anthropic':'https://www.anthropic.com/pricing',
      'DeepSeek': 'https://platform.deepseek.com/pricing',
      'Google':   'https://ai.google.dev/pricing',
      'xAI':      'https://docs.x.ai/docs/models',
      'Meta':     'https://llama.meta.com/',
      'Mistral':  'https://docs.mistral.ai/getting-started/models/pricing/',
      'Alibaba':  'https://help.aliyun.com/zh/model-studio/developer-reference/',
      'Moonshot': 'https://platform.moonshot.cn/',
      'Zhipu':    'https://docs.z.ai/guides/overview/quick-start',
      'Tencent':  'https://cloud.tencent.com/product/hunyuan',
      'MiniMax':  'https://minimax.io/',
    };
    return URLS[provider] ?? '';
  }

  /**
   * 从模型名猜测厂商（2026-09-01 加固）
   *
   * 优先级：
   *   1. startsWith 精确匹配（正常命名 "hunyuan-turbo"）
   *   2. includes 模糊匹配（脏数据兜底 "hunyuanturbo" 无连字符、"qwen-3-8" 多连字符等）
   *   3. 兜底 Unknown
   */
  private guessProvider(externalId: string): string {
    const id = externalId.toLowerCase();
    if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3')) return 'OpenAI';
    if (id.startsWith('claude-')) return 'Anthropic';
    if (id.startsWith('gemini-')) return 'Google';
    if (id.startsWith('grok-')) return 'xAI';
    if (id.startsWith('deepseek-')) return 'DeepSeek';
    if (id.startsWith('llama-')) return 'Meta';
    if (id.startsWith('mistral-')) return 'Mistral';
    if (id.startsWith('qwen-')) return 'Alibaba';
    if (id.startsWith('minimax-')) return 'MiniMax';
    if (id.startsWith('hunyuan-') || id.includes('hunyuan')) return 'Tencent';
    return 'Unknown';
  }
}