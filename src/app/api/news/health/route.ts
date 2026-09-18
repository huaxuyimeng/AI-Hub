/**
 * 新闻源健康度 API
 *
 * 功能：查看所有源的健康状态（公开接口，无需认证）
 *
 * 注意：此接口不含敏感数据，任何监控系统均可抓取。
 * 如需区分"自己查看"与"外部监控"，在未来引入 MONITOR_SECRET 环境变量。
 */

import { NextResponse } from 'next/server'
import { prismaBase as prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  // BUG-B 修复：去掉 Bearer 鉴权，健康检查应该是公开的。
  // 如未来需要区分"自己人查看"与"外部监控"，改用单独的 MONITOR_SECRET 环境变量。
  // const authHeader = req.headers.get('authorization')
  // const expected = process.env.CRON_SECRET
  // if (expected && authHeader !== `Bearer ${expected}`) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // }

  const sources = await prisma.newsSource.findMany({
    where: { enabled: true },
    orderBy: [
      { unhealthy: 'desc' },
      { failStreak: 'desc' },
      { name: 'asc' },
    ],
    select: {
      id: true,
      name: true,
      type: true,
      enabled: true,
      fragile: true,
      lastFetchAt: true,
      lastOkAt: true,
      lastCount: true,
      lastMs: true,
      lastError: true,
      okStreak: true,
      emptyStreak: true,
      failStreak: true,
      failCount: true,
      unhealthy: true,
    },
  })

  const summary = {
    total: sources.length,
    healthy: sources.filter(s => !s.unhealthy).length,
    unhealthy: sources.filter(s => s.unhealthy).length,
    fragile: sources.filter(s => s.fragile).length,
  }

  return NextResponse.json({
    ok: true,
    summary,
    sources,
    timestamp: new Date().toISOString(),
  })
}
