// 来源：d:\1Money\design\API设计.md §五 REST 兼容层
// MVP 阶段：仅 project 列表的 REST endpoint 占位

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(req: NextRequest) {
  // ✅ v3.3.1 修复：必须传 authOptions
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant' }, { status: 403 });
  }

  // TODO: 真正的 REST 实现等批次 C6 完成后
  return NextResponse.json({
    items: [],
    nextCursor: null,
    note: 'MVP placeholder —— use tRPC project.list instead',
  });
}