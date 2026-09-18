/**
 * 新引擎 PPTX 预览 API
 * 路径：src/app/api/slide-engine/preview/route.ts
 *
 * POST /api/slide-engine/preview
 * Body: DailyReportContent JSON
 * Response: application/vnd.openxmlformats-officedocument.presentationml.presentation
 *
 * 用途：新引擎隔离测试，不走旧 build-pptx.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import type { DailyReportContent } from '@/features/daily-briefing/lib/types';
import { DailyReportContentSchema } from '@/features/daily-briefing/lib/types';
import { registerBriefingPageTypes } from '@/lib/slide-engine/templates/briefing/slides';
import { paperTheme } from '@/lib/slide-engine/templates/briefing/theme';
import { planBriefingDeck, planBriefingToPlacedSlides } from '@/lib/slide-engine/templates/briefing/plan';
import { renderDeckToBuffer } from '@/lib/slide-engine/render/pptx';
import { lintDeck } from '@/lib/slide-engine/qa/lint';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 安全上限：防止恶意构造超大 deck 触发 CPU 密集型渲染（DoS 防护）
const MAX_SLIDES = 30;

export async function POST(req: NextRequest) {
  // BUG-02 修复（2026-09-04）：必须登录才能调用，避免被滥用为 DoS 向量
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Schema 校验（不向客户端泄露 zod 内部 details）
    let content: DailyReportContent;
    try {
      content = DailyReportContentSchema.parse(body);
    } catch (err) {
      logger.warn('[slide-engine/preview] schema validation failed', {
        userId: session.user.id,
        error: (err as Error).message,
      });
      return NextResponse.json(
        { error: 'Content schema validation failed' },
        { status: 422 },
      );
    }

    // 注册早报页型
    registerBriefingPageTypes();

    // 布局规划
    const entries = planBriefingDeck(content);
    const placedSlides = planBriefingToPlacedSlides(entries, paperTheme);

    // 防御性截断：超过 MAX_SLIDES 直接拒绝
    if (placedSlides.length > MAX_SLIDES) {
      logger.warn('[slide-engine/preview] slide count exceeded limit', {
        userId: session.user.id,
        requested: placedSlides.length,
        limit: MAX_SLIDES,
      });
      return NextResponse.json(
        { error: `Slide count ${placedSlides.length} exceeds limit ${MAX_SLIDES}` },
        { status: 413 },
      );
    }

    // QA 检查
    const report = lintDeck(placedSlides, paperTheme);
    const errors = report.issues.filter(i => i.level === 'error').length;
    const warns = report.issues.filter(i => i.level === 'warn').length;

    logger.info('[slide-engine/preview]', {
      userId: session.user.id,
      pages: placedSlides.length,
      errors,
      warns,
      date: content.date,
    });

    // 渲染 PPTX
    const buffer = await renderDeckToBuffer(placedSlides, paperTheme, {
      title: `AI 日报 ${content.date}`,
      author: 'AIHub',
      company: 'AIHub',
    });

    const fileName = `AIHub-AI早报-${content.date}-v2.pptx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(buffer.length),
        'X-Slide-Engine': 'v2',
        'X-Pages': String(placedSlides.length),
        'X-QA-Errors': String(errors),
        'X-QA-Warns': String(warns),
      },
    });
  } catch (err) {
    // 不向客户端泄露内部错误详情（修复 BUG-11 残留风险）
    logger.error('[slide-engine/preview] render failed', {
      userId: (await getServerSession(authOptions))?.user?.id,
      error: (err as Error).message,
    });
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}
