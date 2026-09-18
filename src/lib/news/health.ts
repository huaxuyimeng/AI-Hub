/**
 * 新闻源健康度追踪（P1-1 修复）
 * 
 * 来源：报告 02 §2.C + 报告 04 §3 P1-1
 * 功能：
 *   1. 追踪每个源的成功/失败/空结果
 *   2. 连续失败 >= 2 次标记 unhealthy
 *   3. 控制台告警
 */

import { prismaBase as prisma } from '@/lib/db'

export interface FetchResult {
  ok: boolean
  count: number
  ms: number
  error?: string | null
}

/** 连续失败阈值（超过此值标记 unhealthy） */
const HEALTH_FAIL_THRESHOLD = 2

/**
 * 应用健康度追踪
 * 
 * @param sourceName 源名称
 * @param result 抓取结果
 */
export async function applyHealth(sourceName: string, result: FetchResult) {
  const source = await prisma.newsSource.findUnique({
    where: { name: sourceName },
  })

  if (!source) {
    console.warn(`[health] Source not found: ${sourceName}`)
    return null
  }

  // 计算新的 streak
  let okStreak = 0
  let emptyStreak = 0
  let failStreak = 0

  if (result.ok && result.count > 0) {
    // 成功抓取且有数据
    okStreak = source.okStreak + 1
    emptyStreak = 0
    failStreak = 0
  } else if (result.ok && result.count === 0) {
    // 成功抓取但 0 条（正则爬虫改版的典型症状）
    okStreak = 0
    emptyStreak = source.emptyStreak + 1
    failStreak = source.failStreak + 1  // 空结果也算异常
  } else {
    // 抓取失败
    okStreak = 0
    emptyStreak = 0
    failStreak = source.failStreak + 1
  }

  const unhealthy = failStreak >= HEALTH_FAIL_THRESHOLD

  // P1-7：控制台告警
  if (unhealthy && !source.unhealthy) {
    console.warn(`[health] 🚨 Source "${sourceName}" marked UNHEALTHY (failStreak=${failStreak})`)
  }

  const updated = await prisma.newsSource.update({
    where: { id: source.id },
    data: {
      lastFetchAt: new Date(),
      lastOkAt: result.ok && result.count > 0 ? new Date() : source.lastOkAt,
      lastCount: result.count,
      lastError: result.error ?? null,
      lastMs: result.ms,
      okStreak,
      emptyStreak,
      failStreak,
      failCount: source.failCount + (result.ok ? 0 : 1),
      unhealthy,
    },
  })

  return updated
}

/**
 * 获取不健康的源（用于告警汇总）
 */
export async function getUnhealthySources() {
  return prisma.newsSource.findMany({
    where: { unhealthy: true, enabled: true },
    select: {
      id: true,
      name: true,
      type: true,
      failStreak: true,
      emptyStreak: true,
      lastError: true,
      lastFetchAt: true,
    },
  })
}
