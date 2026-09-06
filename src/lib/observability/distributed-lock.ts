/**
 * 分布式锁实现
 *
 * 升级说明：
 * - v1: 进程内锁（Map）- 仅单进程有效
 * - v2: 文件锁 - 跨进程有效，适合单服务器部署
 * - v3 (2026-09-06, BUG-15 修复): Redis 锁为主，文件锁为 fallback
 *      Vercel serverless 各实例 /tmp 不共享，文件锁失效；
 *      Redis `SET NX PX` 是真正的分布式锁。
 *      释放时用 Lua 脚本比较 token，避免释放别人的锁。
 *
 * 来源：整合 P1-8 分布式锁需求
 */

import { logger } from './logger';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Redis } from '@upstash/redis';
import { randomBytes } from 'crypto';
import { env } from '../env';

// ─── Redis client（按需懒初始化） ─────────────────────────────────────────

let _redis: Redis | null | undefined; // undefined = 未初始化

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    _redis = null;
    logger.warn('lock.redis.disabled', { reason: 'missing UPSTASH_REDIS_REST_URL/TOKEN' });
    return null;
  }
  _redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

/** Lua 脚本：仅当 value 匹配才删除（防止释放别人的锁） */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

// ─── Redis 锁实现 ────────────────────────────────────────────────────────

class RedisLock {
  private key: string;
  private token: string;
  private ttlMs: number;
  private acquired = false;

  constructor(key: string, ttlMs: number) {
    this.key = `aihub:lock:${key}`;
    this.token = randomBytes(16).toString('hex');
    this.ttlMs = ttlMs;
  }

  async acquire(): Promise<boolean> {
    const r = getRedis();
    if (!r) return false;
    try {
      const result = await r.set(this.key, this.token, { nx: true, px: this.ttlMs });
      this.acquired = result === 'OK';
      if (this.acquired) {
        logger.info('lock.redis.acquired', { key: this.key, ttlMs: this.ttlMs });
      } else {
        logger.warn('lock.redis.contended', { key: this.key });
      }
      return this.acquired;
    } catch (err) {
      // Redis 调用失败时降级（不阻断业务，但记录告警）
      logger.error('lock.redis.error', { key: this.key, error: (err as Error).message });
      return false;
    }
  }

  async release(): Promise<void> {
    if (!this.acquired) return;
    const r = getRedis();
    if (!r) return;
    try {
      await r.eval(RELEASE_SCRIPT, [this.key], [this.token]);
      logger.info('lock.redis.released', { key: this.key });
    } catch (err) {
      logger.error('lock.redis.release.error', { key: this.key, error: (err as Error).message });
    } finally {
      this.acquired = false;
    }
  }
}

// ─── 文件锁实现（fallback，仅单机开发用） ──────────────────────────────

class FileLock {
  private lockPath: string;
  private lockName: string;
  private acquired = false;

  constructor(lockName: string) {
    this.lockName = lockName;
    const tmpDir = os.tmpdir();
    this.lockPath = path.join(tmpDir, `aihub-${lockName}.lock`);
  }

  /**
   * 尝试获取锁
   * @param timeoutMs 超时时间（毫秒），0 表示不等待
   * @returns 是否成功获取锁
   */
  async acquire(timeoutMs = 0): Promise<boolean> {
    const startTime = Date.now();

    while (true) {
      try {
        // 使用 wx 模式：文件存在时抛出错误
        fs.writeFileSync(
          this.lockPath,
          JSON.stringify({
            pid: process.pid,
            lockName: this.lockName,
            acquiredAt: new Date().toISOString(),
          }),
          { flag: 'wx' }
        );

        this.acquired = true;
        logger.info('lock.acquired', { lockName: this.lockName, pid: process.pid });
        return true;
      } catch (err: any) {
        // 文件已存在（锁被占用）
        if (err.code === 'EEXIST') {
          // 检查锁是否过期（超过 10 分钟自动清理）
          try {
            const stat = fs.statSync(this.lockPath);
            const age = Date.now() - stat.mtimeMs;
            if (age > 10 * 60 * 1000) {
              // 锁文件超过 10 分钟，认为是僵尸锁，强制删除
              logger.warn('lock.cleanup.stale', {
                lockName: this.lockName,
                ageMs: age,
              });
              fs.unlinkSync(this.lockPath);
              continue; // 重试获取
            }
          } catch (statErr) {
            // stat 失败，可能已被删除，重试
            continue;
          }

          // 超时检查
          if (timeoutMs === 0) {
            logger.warn('lock.contended', { lockName: this.lockName, reason: 'no-wait' });
            return false;
          }
          if (Date.now() - startTime >= timeoutMs) {
            logger.warn('lock.contended', { lockName: this.lockName, reason: 'timeout' });
            return false;
          }

          // 等待 100ms 后重试
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          // 其他错误（权限、磁盘满等）
          logger.error('lock.acquire.error', { lockName: this.lockName, error: err.message });
          throw err;
        }
      }
    }
  }

  /**
   * 释放锁
   */
  release(): void {
    if (!this.acquired) return;

    try {
      fs.unlinkSync(this.lockPath);
      this.acquired = false;
      logger.info('lock.released', { lockName: this.lockName, pid: process.pid });
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        // 文件不存在是正常的（可能被其他进程清理）
        logger.error('lock.release.error', { lockName: this.lockName, error: err.message });
      }
    }
  }
}

/**
 * 使用分布式锁执行函数
 *
 * 策略（BUG-15 修复后）：
 *   1. 优先尝试 Redis 锁（SET NX PX + Lua 释放）—— Vercel serverless 有效
 *   2. Redis 不可用时降级到文件锁（本地单机开发）
 *
 * @param key 锁名称（如 'cron:fetch-news'）
 * @param ttlSeconds TTL（秒），用于 Redis 锁自动过期；同时也是 fn 的"最长执行时间"参考
 * @param fn 要执行的函数
 * @returns 函数结果，或 { skipped: true } 表示锁被占用
 *
 * @example
 * const result = await withLock('cron:fetch-news', 600, async () => {
 *   return await fetchAllNews();
 * });
 *
 * if (isLockSkipped(result)) {
 *   return NextResponse.json(result, { status: 409 });
 * }
 */
export async function withLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  // 1. 优先 Redis 锁
  const redisLock = new RedisLock(key, ttlSeconds * 1000);
  const redisAcquired = await redisLock.acquire();
  if (redisAcquired) {
    try {
      return await fn();
    } finally {
      await redisLock.release();
    }
  }

  // 2. Redis 失败 → 降级到文件锁（仅当 Redis 是"配置缺失"而非"调用失败"）
  if (getRedis() !== null) {
    // Redis 已配置但本次 acquire 返回 false（被占用）—— 直接返回 skipped，不要再降级
    logger.warn('lock.skipped', { key, reason: 'redis held' });
    return { skipped: true, reason: 'lock held (redis)' };
  }

  // 3. 文件锁 fallback（仅本地开发，serverless 失效但仍可用作"单实例"保护）
  const fileLock = new FileLock(key);
  const fileAcquired = await fileLock.acquire(0); // 不等待
  if (!fileAcquired) {
    logger.warn('lock.skipped', { key, reason: 'file held' });
    return { skipped: true, reason: 'lock held (file-based)' };
  }

  try {
    return await fn();
  } finally {
    fileLock.release();
  }
}

/**
 * 类型守卫：判断结果是否为锁被占用
 */
export function isLockSkipped(r: unknown): r is { skipped: true; reason: string } {
  return typeof r === 'object' && r !== null && 'skipped' in r && (r as { skipped: unknown }).skipped === true;
}
