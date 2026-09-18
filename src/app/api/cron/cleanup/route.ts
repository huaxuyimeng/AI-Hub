// 来源：d:\1Money\design\部署运维.md §11.1 Vercel Cron
// 批次 B13：Bearer 鉴权 + 单一 cleanupOrphanFiles 入口

import { NextRequest, NextResponse } from 'next/server';
import { cleanupOrphanFiles } from '@/lib/cleanup';
import { withLock } from '@/lib/observability/distributed-lock';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');

  if (!secret || !auth || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await withLock('cron:cleanup-orphan', 120, async () => {
      return await cleanupOrphanFiles();
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}