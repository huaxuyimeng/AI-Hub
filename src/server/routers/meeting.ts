/**
 * RAG-P2-B：多 LLM 协作会议
 *
 * 核心流程：
 *   1. 用户给一个 topic（主题/问题）+ 指定若干 participants（每个 = 模型 + 角色）
 *   2. 串行调每个参与者的 LLM：把"前面所有参与者的发言"作为上下文传给下一个
 *   3. 调一次"主持人"模型汇总所有参与者发言，生成 conclusion
 *
 * 角色设计（参考 WorkBuddy 专家）：
 *   - pm / engineer / investor / critic / summarizer 等
 *   - 每个角色有自己的 systemPrompt
 *   - 预置角色存在 ExpertRole 表里，用户也可自定义
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../context';
import { prismaRaw } from '../../lib/db';
import { chat, chooseModel } from '../../lib/ai/router';
import { chatLC } from '../../lib/ai/langchain-adapter';
import { recordUsage } from '../../lib/usage';
import { calculateCost } from '../../lib/ai/pricing';
import { runMeetingGraph } from '../../lib/meeting/meeting-graph';
import type { ParticipantConfig } from '../../lib/meeting/types';
import { MAX_MEETING_ROUNDS, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '../../lib/meeting/types';
import { logger } from '@/lib/observability/logger';

// ============================================================================
// 类型
// ============================================================================

interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  model: string;
  /** 发言者角色（仅 assistant 有） */
  speaker?: string;
  timestamp: string;
}

// ============================================================================
// 预置角色（无 DB 时 fallback；正常路径从 ExpertRole 表读）
// ============================================================================

const BUILTIN_EXPERT_ROLES: Array<{
  key: string;
  name: string;
  description: string;
  systemPrompt: string;
  defaultModel: string;
  icon: string;
}> = [
  {
    key: 'pm',
    name: '产品经理',
    description: '从用户价值和功能优先级角度分析问题',
    systemPrompt: '你是一位经验丰富的产品经理，擅长从用户需求、功能优先级和商业价值角度分析问题。请直接给出你的观点和理由，不要使用"作为一个AI"等开场白。每次回答 200-400 字，逻辑清晰、观点鲜明。',
    defaultModel: 'gpt-4o',
    icon: '🎯',
  },
  {
    key: 'engineer',
    name: '工程师',
    description: '从技术可行性和实现细节角度分析问题',
    systemPrompt: '你是一位资深软件工程师，擅长从技术架构、实现细节、性能与可维护性角度分析问题。请直接给出你的技术观点和实现建议。每次回答 200-400 字，要给出具体的代码示例或架构图示。',
    defaultModel: 'claude-4',
    icon: '🛠️',
  },
  {
    key: 'investor',
    name: '投资人',
    description: '从商业价值、ROI、风险角度分析问题',
    systemPrompt: '你是一位资深风险投资人，擅长从市场规模、商业模式、ROI、退出路径和风险角度分析问题。请直接给出你的投资判断和逻辑。每次回答 200-400 字，要有数据支撑、观点鲜明。',
    defaultModel: 'gpt-4o',
    icon: '💰',
  },
  {
    key: 'critic',
    name: '怀疑论者',
    description: '专门找漏洞、质疑假设、反向论证',
    systemPrompt: '你是一位怀疑论者，擅长找出其他观点的逻辑漏洞、数据假设、潜在风险和不合理之处。请直接指出问题，并给出反驳论据。每次回答 200-400 字，措辞犀利但有理有据。',
    defaultModel: 'deepseek-v3',
    icon: '🔍',
  },
  {
    key: 'summarizer',
    name: '会议主持人',
    description: '汇总所有参与者发言，生成结构化会议纪要',
    systemPrompt: '你是一位会议主持人。请基于所有参与者的发言，生成一份结构化会议纪要，包括：1）核心共识 2）主要分歧 3）可执行的下一步建议。要求客观中立、不偏袒任何一方。',
    defaultModel: 'gpt-4o',
    icon: '📋',
  },
];

async function ensureBuiltinExpertRoles(): Promise<void> {
  // 启动时把预置角色 upsert 进 DB（幂等）
  for (const role of BUILTIN_EXPERT_ROLES) {
    await prismaRaw.expertRole.upsert({
      where: { key: role.key },
      update: {},
      create: role,
    });
  }
}

// ============================================================================
// Router
// ============================================================================

export const meetingRouter = router({
  /** 列出所有预置专家角色 */
  listExpertRoles: protectedProcedure
    .query(async () => {
      // 确保预置已 seed
      await ensureBuiltinExpertRoles();
      return prismaRaw.expertRole.findMany({
        orderBy: { key: 'asc' },
      });
    }),

  /** 创建会议（只存 topic + participants，不立即跑） */
  create: protectedProcedure
    .input(z.object({
      topic: z.string().min(5).max(2000),
      title: z.string().max(200).optional(),
      participants: z.array(z.object({
        role: z.string().min(1).max(60),
        model: z.string().min(1).max(60),
        systemPrompt: z.string().max(2000).optional(),
      })).min(2).max(5),
      hostModel: z.string().max(60).optional().default('gpt-4o'),
      // ── Phase 3 新增 ───────────────────────────────
      /** 执行模式：'single'（默认）= 单轮，'multi' = 多轮（LangGraph） */
      mode: z.enum(['single', 'multi']).default('single'),
      /** 多轮模式下最大轮数（1-MAX_MEETING_ROUNDS=3，默认 2） */
      maxRounds: z.number().int().min(1).max(MAX_MEETING_ROUNDS).default(2),
    }))
    .mutation(async ({ ctx, input }) => {
      const modeEnum = input.mode === 'multi' ? 'MULTI' : 'SINGLE';
      // maxRounds 仅在 multi 模式下生效；SINGLE 模式存 null（避免污染历史数据）
      const maxRoundsValue = input.mode === 'multi' ? input.maxRounds : null;

      const meeting = await prismaRaw.meeting.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.session.user.id,
          topic: input.topic,
          title: input.title ?? input.topic.slice(0, 30),
          hostModel: input.hostModel,
          status: 'ACTIVE',
          mode: modeEnum,
          maxRounds: maxRoundsValue,
          participants: {
            create: input.participants.map((p, idx) => ({
              model: p.model,
              role: p.role,
              systemPrompt: p.systemPrompt ?? `你是${p.role}，请基于主题给出你的专业观点。`,
              order: idx,
              transcript: [],
            })),
          },
        },
        include: { participants: { orderBy: { order: 'asc' } } },
      });
      return meeting;
    }),

  /** 获取会议详情（含参与者 transcript） */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const meeting = await prismaRaw.meeting.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        include: { participants: { orderBy: { order: 'asc' } } },
      });
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });
      return meeting;
    }),

  /** 列出用户所有会议 */
  list: protectedProcedure
    .input(z.object({ take: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const meetings = await prismaRaw.meeting.findMany({
        where: { tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        select: {
          id: true, title: true, topic: true, status: true,
          createdAt: true, updatedAt: true,
          _count: { select: { participants: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: input?.take ?? 20,
      });
      return meetings.map((m) => ({ ...m, participantCount: m._count.participants }));
    }),

  /**
   * 串行执行会议：依次调每个参与者的 LLM，把前序发言注入上下文
   * 失败兜底：单个参与者失败不影响其他人（标记 transcript 为 error）
   */
  run: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await prismaRaw.meeting.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        include: { participants: { orderBy: { order: 'asc' } } },
      });
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });

      // 原子抢占 RUNNING 状态（Bug24 同款修复）
      // 原代码用 findFirst → update，会被双击/并发穿透产生两个并行 run
      // 用 updateMany + where status=ACTIVE，count=0 即被别人抢了
      const claim = await prismaRaw.meeting.updateMany({
        where: { id: meeting.id, status: 'ACTIVE', deletedAt: null },
        data: { status: 'RUNNING' },
      });
      if (claim.count === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: '会议已被其他请求抢占' });
      }

      try {
        // 串行调每个参与者
        const allTranscripts: Array<{ participantId: string; transcript: TranscriptEntry[] }> = [];
        for (const p of meeting.participants) {
          const priorContext = allTranscripts
            .map((t) => t.transcript.map((e) => `${e.speaker ?? 'AI'}: ${e.content}`).join('\n'))
            .join('\n\n');

          const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: p.systemPrompt },
            {
              role: 'user',
              content: priorContext
                ? `会议主题：${meeting.topic}\n\n前面的参与者已经发表了以下观点：\n\n${priorContext}\n\n请你基于以上内容，给出你的专业观点（200-400 字）。`
                : `会议主题：${meeting.topic}\n\n你是第一个发言者，请给出你的专业观点（200-400 字）。`,
            },
          ];

          try {
            const resp = await chat(p.model, ctx.tenantId, messages, {
              temperature: 0.7,
              maxTokens: 600,
            });

            const entry: TranscriptEntry = {
              role: 'assistant',
              content: resp.content,
              model: p.model,
              speaker: p.role,
              timestamp: new Date().toISOString(),
            };

            // 写回 transcript
            const existing = (p.transcript as unknown as TranscriptEntry[]) ?? [];
            await prismaRaw.meetingParticipant.update({
              where: { id: p.id },
              data: { transcript: [...existing, entry] as unknown as object },
            });
            allTranscripts.push({ participantId: p.id, transcript: [entry] });

            // 记录 usage
            const cost = calculateCost(p.model, resp.usage.input, resp.usage.output, 0);
            await recordUsage({
              tenantId: ctx.tenantId,
              inputTokens: resp.usage.input,
              outputTokens: resp.usage.output,
              cost,
              kind: 'meeting',
            });
          } catch (err) {
            logger.warn('[meeting] participant failed', {
              meetingId: meeting.id,
              participantId: p.id,
              model: p.model,
              error: (err as Error).message,
            });
            // 继续下一个参与者
            const entry: TranscriptEntry = {
              role: 'assistant',
              content: `[发言失败] ${(err as Error).message}`,
              model: p.model,
              speaker: p.role,
              timestamp: new Date().toISOString(),
            };
            const existing = (p.transcript as unknown as TranscriptEntry[]) ?? [];
            await prismaRaw.meetingParticipant.update({
              where: { id: p.id },
              data: { transcript: [...existing, entry] as unknown as object },
            });
          }
        }

        // 状态切到 COMPLETED（即使部分失败也认为会议结束）
        await prismaRaw.meeting.update({
          where: { id: meeting.id },
          data: { status: 'COMPLETED' },
        });
      } catch (err) {
        // 抢占了 RUNNING 但中途崩溃 → 回退到 ACTIVE 避免会议永远卡住
        await prismaRaw.meeting.update({
          where: { id: meeting.id },
          data: { status: 'ACTIVE' },
        });
        throw err;
      }

      return { ok: true, completedParticipants: allTranscripts.length };
    }),

  /** 调主持人模型汇总发言，生成 conclusion */
  conclude: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await prismaRaw.meeting.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        include: { participants: { orderBy: { order: 'asc' } } },
      });
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });

      // 拼所有发言
      const allSpeeches = meeting.participants
        .map((p) => {
          const t = p.transcript as unknown as TranscriptEntry[] | null;
          if (!t || t.length === 0) return null;
          const content = t.map((e) => e.content).join('\n');
          return `【${p.role}（${p.model}）】\n${content}`;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

      if (!allSpeeches) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '会议尚未运行，请先调用 run' });
      }

      const hostMessages = [
        {
          role: 'system' as const,
          content: BUILTIN_EXPERT_ROLES.find((r) => r.key === 'summarizer')?.systemPrompt
            ?? '你是会议主持人。',
        },
        {
          role: 'user' as const,
          content: `会议主题：${meeting.topic}\n\n所有参与者的发言如下：\n\n${allSpeeches}\n\n请基于以上发言生成结构化会议纪要，包括：1）核心共识 2）主要分歧 3）下一步建议。`,
        },
      ];

      try {
        const resp = await chat(meeting.hostModel, ctx.tenantId, hostMessages, {
          temperature: 0.5,
          maxTokens: 1500,
        });

        await prismaRaw.meeting.update({
          where: { id: meeting.id },
          data: { conclusion: resp.content },
        });

        const cost = calculateCost(meeting.hostModel, resp.usage.input, resp.usage.output, 0);
        await recordUsage({
          tenantId: ctx.tenantId,
          inputTokens: resp.usage.input,
          outputTokens: resp.usage.output,
          cost,
          kind: 'meeting',
        });

        return { ok: true, conclusion: resp.content };
      } catch (err) {
        logger.error('[meeting] conclude failed', {
          meetingId: meeting.id,
          error: (err as Error).message,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `主持人汇总失败：${(err as Error).message}`,
        });
      }
    }),

  /** 删除会议（软删） */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await prismaRaw.meeting.updateMany({
        where: { id: input.id, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  /**
   * 重排参与者顺序（v2 2026-09-17）
   *
   * 用法：传入完整有序的 participant.id 数组。
   *   - 事务：逐个 update 写回 new order
   *   - 仅允许会议创建者（userId）的会议
   *   - 防御：客户端传的 ids 不能少/多/错；必须完全匹配现有 participants
   */
  reorderParticipants: protectedProcedure
    .input(z.object({
      meetingId: z.string().uuid(),
      orderedIds: z.array(z.string().uuid()).min(2).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await prismaRaw.meeting.findFirst({
        where: { id: input.meetingId, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        include: { participants: { select: { id: true } } },
      });
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });

      // 校验 orderedIds 与现有 ids 完全匹配（防丢失/添加）
      const existingIds = new Set(meeting.participants.map((p) => p.id));
      const submittedIds = new Set(input.orderedIds);
      if (existingIds.size !== submittedIds.size) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '参与者数量不匹配' });
      }
      for (const id of submittedIds) {
        if (!existingIds.has(id)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `未知参与者 id: ${id}` });
        }
      }
      // 顺序去重
      if (new Set(input.orderedIds).size !== input.orderedIds.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '参与者 id 重复' });
      }

      // 事务写回 order
      await prismaRaw.$transaction(
        input.orderedIds.map((id, idx) =>
          prismaRaw.meetingParticipant.update({
            where: { id },
            data: { order: idx },
          }),
        ),
      );

      return { ok: true, count: input.orderedIds.length };
    }),

  /**
   * runMultiTurn — 多轮 LLM 互评（Phase 2 / LangGraph 实现）
   *
   * 与 run 的区别：
   * - run: 串行一轮（所有人各说一次）
   * - runMultiTurn: 多轮（LLM 判断是否继续第二轮，最多 MAX_MEETING_ROUNDS=3 轮）
   *
   * 设计决策：
   * - 不依赖 LangGraph checkpoint（每次 node 完成后由本 mutation 写 DB）
   * - DB 写入失败时回退 meeting.status 为 ACTIVE
   */
  runMultiTurn: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      /** 决策模型（可选，默认 glm-4-7-flash） */
      decisionModel: z.string().optional(),
      /** 最大轮数（1-MAX_MEETING_ROUNDS，可选） */
      maxRounds: z.number().int().min(1).max(MAX_MEETING_ROUNDS).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, decisionModel, maxRounds } = input;
      const { tenantId, session } = ctx;

      // ── Step 1: 查询会议 ──────────────────────────────────
      const meeting = await prismaRaw.meeting.findFirst({
        where: {
          id,
          tenantId,
          userId: session.user.id,
          deletedAt: null,
        },
        include: {
          participants: { orderBy: { order: 'asc' } },
        },
      });

      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND', message: '会议不存在' });
      if (meeting.status === 'RUNNING') {
        throw new TRPCError({ code: 'CONFLICT', message: '会议正在运行中' });
      }
      if (meeting.participants.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '无参与者' });
      }

      // ── Step 2: 原子抢占 RUNNING 状态（Bug24 修复） ─────────
      // 原代码：先 findFirst 读 status，再 update 设 RUNNING。
      //   并发场景：A、B 同时读 status=ACTIVE，A、B 都执行 update → 两个 graph 同时跑。
      // 修复：用 updateMany + where status='ACTIVE'，count=0 表示被别人抢了。
      const claim = await prismaRaw.meeting.updateMany({
        where: { id: meeting.id, status: 'ACTIVE', deletedAt: null },
        data: { status: 'RUNNING' },
      });
      if (claim.count === 0) {
        // 被别人抢了
        throw new TRPCError({ code: 'CONFLICT', message: '会议已被其他请求抢占' });
      }

      // ── Step 3: 准备 participant configs ─────────────────
      const participantConfigs: ParticipantConfig[] = meeting.participants.map((p) => ({
        id: p.id,
        role: p.role,
        model: p.model,
        systemPrompt: p.systemPrompt,
        maxTokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
      }));

      // ── Step 4: 跑图 ─────────────────────────────────────
      // Bug5 修复：把 maxRounds 透传给 graph，decideContinue 据此提前结束
      let finalState;
      try {
        finalState = await runMeetingGraph(
          { topic: meeting.topic, participants: participantConfigs },
          {
            tenantId,
            hostModel: meeting.hostModel,
            decisionModel,
            maxRounds, // 用户在 UI 设的 1-MAX_MEETING_ROUNDS
          },
        );
      } catch (err) {
        // graph 执行失败，确保状态回退
        await prismaRaw.meeting.update({
          where: { id: meeting.id },
          data: { status: 'ACTIVE' },
        });
        logger.error('[meeting] runMultiTurn graph failed', {
          meetingId: meeting.id,
          error: (err as Error).message,
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `会议执行失败：${(err as Error).message}`,
        });
      }

      // ── Step 5: 批量写回 transcripts ──────────────────────
      try {
        await prismaRaw.$transaction(
          Object.entries(finalState.transcripts).map(([participantId, entries]) =>
            prismaRaw.meetingParticipant.update({
              where: { id: participantId },
              data: { transcript: entries as unknown as object },
            }),
          ),
        );
      } catch (err) {
        logger.error('[meeting] runMultiTurn transcript write failed', {
          meetingId: meeting.id,
          error: (err as Error).message,
        });
        await prismaRaw.meeting.update({
          where: { id: meeting.id },
          data: { status: 'ACTIVE' },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `transcript 写入失败：${(err as Error).message}`,
        });
      }

      // ── Step 6: 写回 conclusion + 状态 ──────────────────
      // Bug4 修复：conclude 失败时 errors 会包含 'conclude: ...'，
      //           此时不应写 COMPLETED，应写 FAILED 让前端能区分。
      //           （其它参与者失败仍维持 COMPLETED，因为发言记录已落库）
      // Bug22 修复：Step 6 也包 try/catch，DB 异常时回退 ACTIVE 避免会议卡 RUNNING
      const isConcludeFailed = finalState.errors.some((e) => e.startsWith('conclude:'));
      try {
        await prismaRaw.meeting.update({
          where: { id: meeting.id },
          data: {
            status: isConcludeFailed ? 'FAILED' : 'COMPLETED',
            conclusion: finalState.conclusion ?? null,
          },
        });
      } catch (err) {
        logger.error('[meeting] runMultiTurn step6 status update failed', {
          meetingId: meeting.id,
          error: (err as Error).message,
        });
        // 状态回退：避免会议卡 RUNNING
        try {
          await prismaRaw.meeting.update({
            where: { id: meeting.id },
            data: { status: 'ACTIVE' },
          });
        } catch (fallbackErr) {
          logger.error('[meeting] runMultiRollback status reset failed', {
            meetingId: meeting.id,
            error: (fallbackErr as Error).message,
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `状态写入失败：${(err as Error).message}`,
        });
      }

      const totalEntries = Object.values(finalState.transcripts).reduce(
        (sum, entries) => sum + entries.length,
        0
      );

      // ── Step 6.5: 聚合 usage 一次性记录为 meeting kind ────────────
      // 2026-09-17 Bug2 修复：meeting-graph 内部所有 chatLC 调用都传 skipUsage，
      //                   这里按 finalState.usageTotal 按 model 聚合调用 recordUsage。
      //                   失败不阻塞主流程（与 chatLC 内部保持一致）。
      //
      // 2026-09-17 Bug14 修复：原代码循环里调 Object.keys()N 次且 break 条件混乱。
      //                   重写为：每个 model 单独记录 cost，input/output 总额归到第一个 model。
      if (finalState.usageTotal) {
        const modelIds = Object.keys(finalState.usageTotal.costByModel);
        const hasUsage =
          finalState.usageTotal.inputTokens > 0 ||
          finalState.usageTotal.outputTokens > 0;

        if (modelIds.length > 0 && hasUsage) {
          for (const [idx, modelId] of modelIds.entries()) {
            const cost = finalState.usageTotal.costByModel[modelId];
            const isFirstModel = idx === 0;
            try {
              await recordUsage({
                tenantId,
                modelId,
                // input/output 总额归到第一个 model（UsageStat 按 modelId 聚合，无跨 model 行）
                inputTokens: isFirstModel ? finalState.usageTotal.inputTokens : 0,
                outputTokens: isFirstModel ? finalState.usageTotal.outputTokens : 0,
                cost,
                kind: 'meeting',
              });
            } catch (err) {
              logger.warn('[meeting] runMultiTurn recordUsage failed', {
                meetingId: meeting.id,
                modelId,
                error: (err as Error).message,
              });
            }
          }
          logger.info('[meeting] runMultiTurn usage recorded', {
            meetingId: meeting.id,
            totalInputTokens: finalState.usageTotal.inputTokens,
            totalOutputTokens: finalState.usageTotal.outputTokens,
            modelCount: modelIds.length,
          });
        } else if (modelIds.length === 0) {
          logger.debug('[meeting] runMultiTurn: no usage to record (empty costByModel)', {
            meetingId: meeting.id,
          });
        }
      }

      logger.info('[meeting] runMultiTurn completed', {
        meetingId: meeting.id,
        rounds: finalState.round,
        totalEntries,
        errorCount: finalState.errors.length,
        hasConclusion: !!finalState.conclusion,
      });

      // ── Step 7: 返回结果 ─────────────────────────────────
      // 应用 maxRounds 上限（用户传入的硬限制）
      const actualRounds = maxRounds
        ? Math.min(finalState.round, maxRounds)
        : finalState.round;

      return {
        ok: true,
        rounds: actualRounds,
        totalEntries,
        errors: finalState.errors,
        conclusion: finalState.conclusion,
      };
    }),
});

// suppress unused warning
void chooseModel;
