// GET /api/meeting/stream?meetingId=<id>
//
// 用途：会议多轮模型流式发言（SSE 协议）。
//
// Query 参数：
//   meetingId    必填，会议 id
//
// 响应：text/event-stream
//   event 序列：
//     data: {"type":"text","delta":"你"}
//     data: {"type":"text","delta":"好"}
//     data: {"type":"usage","usage":{"input":12,"output":8}}
//     data: {"type":"done","done":true}
//
// 注意：
//   - 这个路由先实现"调用 LLM 流式发言"最小可用版本，
//     完整 MeetingGraph 流式集成（callLLMNode 走 chatLCStream）
//     是 Phase 2 之后的 Phase 4 工作。
//   - 当前端点只调用一次 chatLCStream，返回完整流。
//
// 鉴权：NextAuth session（未登录 401）

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prismaBase } from '@/lib/db';
import { logger } from '@/lib/observability/logger';
import { chatLCStream, sseEncode, SSE_END_MARKER } from '@/lib/ai/langchain-stream';

export const runtime = 'nodejs';
// 流式最长允许 5 分钟（足够会议单参与者发言；多轮由 MeetingGraph 内部管理）
export const maxDuration = 300;

/**
 * GET /api/meeting/stream
 *
 * 流式调用某个会议的"主持人发言"（demo 端点，Phase 4 完整集成 MeetingGraph）
 */
export async function GET(req: NextRequest) {
  // 1. 鉴权
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const userId = session.user.id;
  const tenantId = session.user.tenantId;
  if (!userId || !tenantId) {
    return new Response('Missing userId or tenantId in session', { status: 401 });
  }

  // 2. 解析 query
  const url = new URL(req.url);
  const meetingId = url.searchParams.get('meetingId');
  if (!meetingId) {
    return new Response('Missing meetingId', { status: 400 });
  }

  // 3. 查询会议（验证属于当前用户）
  const meeting = await prismaBase.meeting.findFirst({
    where: {
      id: meetingId,
      tenantId,
      userId,
      deletedAt: null,
    },
    select: {
      id: true,
      topic: true,
      hostModel: true,
      status: true,
    },
  });

  if (!meeting) {
    return new Response('Meeting not found', { status: 404 });
  }

  if (meeting.status === 'COMPLETED') {
    return new Response('Meeting already completed', { status: 409 });
  }

  // 4. 准备 messages（demo：用 topic 作为单一 user 消息）
  //    Phase 4 完整集成时这里改成 MeetingGraph 的 callLLMNode 内部调用
  const messages = [
    {
      role: 'user' as const,
      content: `请针对会议主题「${meeting.topic}」给出主持人开场发言（200 字以内）。`,
    },
  ];

  // 5. SSE 流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const t0 = Date.now();

      try {
        logger.debug('[api/meeting/stream] starting', {
          meetingId,
          tenantId,
          model: meeting.hostModel,
        });

        for await (const chunk of chatLCStream(
          meeting.hostModel,
          tenantId,
          messages,
          {
            devMock: false,
            signal: req.signal,
            temperature: 0.7,
            maxTokens: 600,
          }
        )) {
          // 检查 abort
          if (req.signal.aborted) {
            logger.info('[api/meeting/stream] client aborted', {
              meetingId,
              duration: Date.now() - t0,
            });
            break;
          }

          // 编码为 SSE 格式
          controller.enqueue(encoder.encode(sseEncode(chunk)));

          // 流结束标记
          if (chunk.type === 'done') {
            break;
          }
        }

        // 显式发送 SSE 结束（部分 proxy 需要 [DONE] sentinel）
        controller.enqueue(encoder.encode(SSE_END_MARKER));
        controller.close();
      } catch (err) {
        // 已 abort 的请求不报错
        if ((err as Error).name === 'AbortError') {
          logger.info('[api/meeting/stream] aborted mid-stream', {
            meetingId,
            duration: Date.now() - t0,
          });
          try {
            controller.close();
          } catch {
            // 关闭失败忽略
          }
          return;
        }

        logger.error('[api/meeting/stream] stream failed', {
          meetingId,
          duration: Date.now() - t0,
          error: (err as Error).message,
        });

        try {
          controller.enqueue(
            encoder.encode(
              sseEncode({
                type: 'error',
                error: { message: (err as Error).message },
              }),
            ),
          );
          controller.enqueue(encoder.encode(SSE_END_MARKER));
          controller.close();
        } catch {
          // 已经关闭忽略
        }
      }
    },
    cancel() {
      // 客户端断开连接时清理
      logger.debug('[api/meeting/stream] client disconnected', { meetingId });
    },
  });

  // 6. 返回 SSE 响应
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // 禁用 nginx 缓冲（如部署在 nginx 后）
      'X-Accel-Buffering': 'no',
    },
  });
}
