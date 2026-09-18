/**
 * AI Keys tRPC Router
 *
 * 管理用户的 AI Provider API Key（provider != 'aihub-rest'）。
 * 注意：provider == 'aihub-rest' 的 key 由 projectRouter 管理（REST API Token）。
 *
 * 安全约束（sec-A 全面防护）：
 *   1. rate limit：每 user 每分钟最多 5 次 test 操作
 *   2. sanitize：test 错误信息中的 key 内容正则移除
 *   3. logger redact：明文 key 不出现在日志
 *   4. hash 存储：DB 只存 sha256(plainKey)，明文不存
 *
 * 决策：hist-A 下 system prompt 仅在内存，key 明文仅出现在 tRPC 响应中一次
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomBytes, createHash } from 'crypto';
import { Redis } from '@upstash/redis';
import { protectedProcedure, router } from '../context';
import { prismaRaw } from '../../lib/db';
import { getProviderAdapter, listProviders } from '../../lib/ai/providers';
import { env } from '../../lib/env';
import { logger } from '../../lib/observability/logger';
import { encrypt } from '../../lib/crypto';
import { sanitizeError } from '../../lib/sanitize';

// ─── Sanitize ───────────────────────────────────────────────────────────────
// sanitizeError 已迁移到 src/lib/sanitize.ts，统一所有 router 使用

// ─── Rate limit ─────────────────────────────────────────────────────────────

/** 每 user 每分钟最多 N 次 test 操作（fail-open） */
async function checkTestRateLimit(userId: string, max = 5, windowSec = 60): Promise<void> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return; // 未配置 Redis 时跳过
  }
  try {
    const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
    const key = `rl:aikey:test:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    if (count > max) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `测试频率过高，请 ${Math.ceil(windowSec / 60)} 分钟后再试`,
      });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    // Redis 异常时放行
    logger.warn('aiKeys.test: redis rate limit failed, allowing', { userId });
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export const aiKeysRouter = router({
  /** 列出本租户所有 AI Provider key（排除 aihub-rest REST API key） */
  list: protectedProcedure.query(async ({ ctx }) => {
    const items = await prismaRaw.apiKey.findMany({
      where: { tenantId: ctx.tenantId, provider: { not: 'aihub-rest' }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, provider: true, keyLast4: true, label: true, createdAt: true, lastUsedAt: true },
    });
    return { items };
  }),

  /** 创建 key（明文只在返回值出现一次） */
  create: protectedProcedure
    .input(z.object({
      provider: z.string().min(1),
      label: z.string().min(1).max(80),
      apiKey: z.string().min(8),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 校验 provider 存在
      const adapter = getProviderAdapter(input.provider);
      if (!adapter) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `未知 Provider：${input.provider}` });
      }

      // TOCTOU 修复：去掉 findFirst 预检，靠 keyHash 唯一约束兜底（捕获 P2002 转 CONFLICT）
      // keyHash = sha256(plainKey)，同一明文 → 同一 hash，DB 层防重复插入
      const plainKey = input.apiKey;
      const keyHash = createHash('sha256').update(plainKey).digest('hex');
      const keyLast4 = plainKey.slice(-4);

      // P0-critical fix：同时存 encryptedKey（可解密）和 keyHash（校验用）
      let encryptedKey: string | null = null;
      try {
        encryptedKey = encrypt(plainKey);
      } catch (e) {
        // 加密失败时，记录 warn 但不阻断（DB 仍可用 keyHash 验重）
        logger.warn('aiKeys.create: encrypt failed, key stored hash-only', {
          tenantId: ctx.tenantId,
          error: (e as Error).message,
        });
      }

      try {
        const created = await prismaRaw.apiKey.create({
          data: {
            tenantId: ctx.tenantId,
            provider: input.provider,
            keyHash,
            keyLast4,
            label: input.label,
            encryptedKey,
          },
        });

        logger.info('aiKeys.create', {
          tenantId: ctx.tenantId,
          userId: ctx.session.user.id,
          provider: input.provider,
          label: input.label,
        });

        // ⚠️ 明文只此一次返回
        return {
          id: created.id,
          provider: created.provider,
          label: created.label,
          keyLast4: created.keyLast4,
          createdAt: created.createdAt,
          plainKey, // 一次性返回
        };
      } catch (e: any) {
        // P2002 = 唯一约束冲突：说明同 tenant+provider+label 或同 keyHash 已存在
        if (e?.code === 'P2002') {
          throw new TRPCError({ code: 'CONFLICT', message: `该 Provider 下已有同名的 Key「${input.label}」` });
        }
        throw e;
      }
    }),

  /** 撤销 key（软删除） */
  revoke: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const owner = await prismaRaw.apiKey.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, label: true, provider: true },
      });
      if (!owner) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Key 不存在或已撤销' });
      }
      await prismaRaw.apiKey.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });

      logger.info('aiKeys.revoke', {
        tenantId: ctx.tenantId,
        userId: ctx.session.user.id,
        keyId: input.id,
        provider: owner.provider,
        label: owner.label,
      });

      return { ok: true };
    }),

  /** 测试连接（真发请求，返回延迟或错误原因） */
  test: protectedProcedure
    .input(z.object({
      provider: z.string().min(1),
      apiKey: z.string().min(8),
      model: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Rate limit
      await checkTestRateLimit(ctx.session.user.id, 5, 60);

      const adapter = getProviderAdapter(input.provider);
      if (!adapter) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `未知 Provider：${input.provider}` });
      }

      const t0 = Date.now();
      let result: { ok: boolean; latencyMs: number; error?: string };

      // B-15 修复：AI provider API 没响应时可能挂死。用 Promise.race 包 15s 超时。
      //          注意：超时只切断 Promise 链，不真正 abort 底层 HTTP 请求（adapter 暂不支持 signal）。
      //          超时返回后用户得到明确错误，不会无限等待。
      const TIMEOUT_MS = 15_000;
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        const testPromise = adapter.testConnection({ apiKey: input.apiKey, model: input.model });
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('TIMEOUT')), TIMEOUT_MS);
        });
        const testResult = await Promise.race([testPromise, timeoutPromise]);
        result = testResult;
      } catch (e) {
        const err = e as Error;
        const msg = err.message === 'TIMEOUT'
          ? `连接超时（${TIMEOUT_MS / 1000}s 未响应）`
          : err.message;
        result = { ok: false, latencyMs: Date.now() - t0, error: sanitizeError(msg) };
      } finally {
        if (timer !== null) clearTimeout(timer);
      }

      logger.info('aiKeys.test', {
        tenantId: ctx.tenantId,
        userId: ctx.session.user.id,
        provider: input.provider,
        ok: result.ok,
        latencyMs: result.latencyMs,
        error: result.error ? sanitizeError(result.error) : undefined,
      });

      return result;
    }),

  /** Provider 列表（不含密钥信息，用于 UI 下拉） */
  providers: protectedProcedure.query(() => {
    return listProviders().map(p => ({
      id: p.id,
      displayName: p.displayName,
      protocol: p.protocol,
      defaultModel: p.defaultModel,
      models: p.models,
      docsUrl: p.docsUrl,
      isStub: !['deepseek', 'zhipu', 'openai', 'anthropic', 'gemini', 'ollama'].includes(p.id),
    }));
  }),
});
