/**
 * 专家种子辅助函数
 *
 * 用途：在 tRPC list/categories/get 等 procedure 入口处幂等检查内置专家数据
 *
 * 设计原则：
 *   - 不重复存数据源（seed-experts.ts 才是 single source of truth）
 *   - 此函数只做 COUNT(*) 检查；表为空时给出警告日志，由运维手动跑 seed
 *   - 不在请求路径里自动 INSERT 20 条（首次体验差，1~2s 阻塞，且并发写有风险）
 */

import { prismaRaw } from '../db';
import { logger } from '../observability/logger';

// 进程级标志，避免每次请求都打 warn log
let warnedEmpty = false;

/**
 * 幂等检查内置专家数据
 *
 * 行为：
 *   - 正常情况（数据已 seed）：直接返回，零开销
 *   - 数据为空：第一次打 warn 日志（避免日志风暴）
 *
 * 调用方不需要 await，async 仅为了扩展性
 */
export async function ensureBuiltinExpertAgents(): Promise<void> {
  try {
    const count = await prismaRaw.expertAgent.count({
      where: { isBuiltIn: true, deletedAt: null },
    });
    if (count === 0 && !warnedEmpty) {
      warnedEmpty = true;
      logger.warn(
        '[expert] 检测到 ExpertAgent 表为空内置专家，请运行 pnpm tsx prisma/seed-experts.ts 初始化',
      );
    }
  } catch (err) {
    // 失败不阻断（DB 短暂不可用时降级）
    logger.error('[expert] ensureBuiltinExpertAgents failed', {
      error: (err as Error).message,
    });
  }
}
