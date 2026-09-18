// 来源：d:\1Money\design\API设计.md §三 chatRouter
// 批次 C 收尾：Conversation / Message 的 tRPC 入口

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../context';
import { createTenantPrisma, prismaRaw } from '../../lib/db';
import { recordUsage } from '../../lib/usage';
import { chooseModel, chat } from '../../lib/ai/router';
import { calculateCost } from '../../lib/ai/pricing';
import { SUPPORTED_MODEL_NAMES } from '../../lib/ai/models';
import { env } from '../../lib/env';
import { retrieve as ragRetrieve } from '../../lib/rag/retriever';

export const chatRouter = router({
  list: protectedProcedure
    .input(z.object({ take: z.number().int().min(1).max(100).default(20), cursor: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const items = await prisma.conversation.findMany({
        take: input.take + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
      });
      const nextCursor = items.length > input.take ? items.pop()?.id : null;
      return { items, nextCursor };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      // B-17 修复：单次返回 messages 加 take 限制，防止长对话响应体过大（详见 2026-09-09 全量 Bug 排查）。
      //          cursor 分页：先取最新 100 条，再按 createdAt 升序返回给前端。
      //          前端可用 messageCount 判断是否需要继续加载更多。
      const conversation = await prisma.conversation.findUnique({
        where: { id: input.id },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 100,
          },
        },
      });
      if (!conversation) throw new TRPCError({ code: 'NOT_FOUND' });
      // 反转成升序，前端展示更自然（老消息在上）
      return { ...conversation, messages: conversation.messages.reverse() };
    }),

  create: protectedProcedure
    .input(z.object({ title: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const conversation = await prisma.conversation.create({
        data: { tenantId: ctx.tenantId, userId: ctx.session.user.id, title: input.title ?? '新对话' },
      });
      return conversation;
    }),

  trash: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // TOCTOU 修复：用 updateMany 条件过滤（id+tenantId+deletedAt:null），0 改动 = 没权限/已删
      const result = await prismaRaw.conversation.updateMany({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  /** 重命名对话（侧栏 hover 操作） */
  rename: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const updated = await prismaRaw.conversation.updateMany({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        data: { title: input.title.trim().slice(0, 200) },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return prismaRaw.conversation.findUniqueOrThrow({ where: { id: input.id } });
    }),

    /** 更新对话状态（用户手动标记 TODO / COMPLETED / ACTIVE） */
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['ACTIVE', 'COMPLETED', 'INTERRUPTED', 'TODO']),
    }))
    .mutation(async ({ ctx, input }) => {
      const updated = await prismaRaw.conversation.updateMany({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        data: { status: input.status },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return prismaRaw.conversation.findUniqueOrThrow({ where: { id: input.id } });
    }),

  /** 切换置顶（收藏）状态 */
  togglePin: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // 用 $transaction 把"读 + 写"原子化，防 toggle 期间并发翻转
      const result = await prismaRaw.$transaction(async (tx) => {
        const owner = await tx.conversation.findFirst({
          where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true, isPinned: true },
        });
        if (!owner) throw new TRPCError({ code: 'NOT_FOUND' });
        return tx.conversation.update({
          where: { id: input.id },
          data: { isPinned: !owner.isPinned },
        });
      });
      return result;
    }),

  // ========================================================================
  // RAG-P2-A：对话分组（让同组对话历史可共享给 RAG 检索）
  // ========================================================================

  /** 把对话移入某个分组（groupId=null 表示移出分组） */
  setGroup: protectedProcedure
    .input(z.object({
      conversationId: z.string().uuid(),
      groupId: z.string().uuid().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. 校验对话属于当前用户
      const conv = await prismaRaw.conversation.findFirst({
        where: { id: input.conversationId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, userId: true },
      });
      if (!conv) throw new TRPCError({ code: 'NOT_FOUND' });
      if (conv.userId !== ctx.session.user.id) throw new TRPCError({ code: 'FORBIDDEN' });

      // 2. 如果要移入某个组，先校验组存在且属于当前用户
      if (input.groupId) {
        const group = await prismaRaw.conversationGroup.findFirst({
          where: { id: input.groupId, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
          select: { id: true },
        });
        if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: '分组不存在' });
      }

      const updated = await prismaRaw.conversation.update({
        where: { id: input.conversationId },
        data: { groupId: input.groupId },
        select: { id: true, groupId: true },
      });
      return updated;
    }),

  // --------------------------------------------------------------------
  // RAG-P2-A：对话分组的 CRUD（user-scoped）
  // --------------------------------------------------------------------

  /** 列出当前用户的所有分组 */
  listGroups: protectedProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const groups = await prismaRaw.conversationGroup.findMany({
        where: { tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        select: {
          id: true,
          name: true,
          icon: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { conversations: { where: { deletedAt: null } } } },
        },
        orderBy: { updatedAt: 'desc' },
      });
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        conversationCount: g._count.conversations,
      }));
    }),

  /** 新建分组 */
  createGroup: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(60).trim(),
      icon: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const group = await prismaRaw.conversationGroup.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.session.user.id,
          name: input.name,
          icon: input.icon ?? null,
        },
        select: { id: true, name: true, icon: true, createdAt: true },
      });
      return group;
    }),

  /** 重命名分组 */
  renameGroup: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(60).trim(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await prismaRaw.conversationGroup.updateMany({
        where: { id: input.id, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        data: { name: input.name, updatedAt: new Date() },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return prismaRaw.conversationGroup.findUniqueOrThrow({ where: { id: input.id } });
    }),

  /** 删除分组（软删；组内对话的 groupId 自动置 null，因 schema 设了 SetNull） */
  deleteGroup: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await prismaRaw.conversationGroup.updateMany({
        where: { id: input.id, tenantId: ctx.tenantId, userId: ctx.session.user.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      conversationId: z.string().uuid(),
      content: z.string().min(1).max(8000),
      model: z.enum(SUPPORTED_MODEL_NAMES).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(64).max(8192).optional(),
      /** RAG 开关（默认 true 让用户立即体验；未来可加设置项关闭） */
      enableRag: z.boolean().optional().default(true),
      /** RAG-P2-A：是否检索对话历史（默认 true） */
      enableHistoryRag: z.boolean().optional().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const owner = await prismaRaw.conversation.findFirst({
        where: { id: input.conversationId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, userId: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND' });

      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const modelName = input.model ?? chooseModel('chat').model;
      const temperature = input.temperature ?? 0.7;
      const maxTokens = input.maxTokens ?? 2048;

      // Q6 修复：取最新 50 条（倒序取再反转），而非最旧 50 条
      // 注意：历史读取放在调用 AI 之前（事务外），AI 失败时无需回滚 history 查询
      const historyDesc = await prisma.message.findMany({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const history = historyDesc.reverse();

      // 3. RAG 检索（AI 调起前，与 history 并行）
      // 失败兜底：检索失败不应阻塞 AI 调用（RAG 是增强，不是必需）
      let references: Awaited<ReturnType<typeof ragRetrieve>>['references'] = [];
      let ragDurationMs = 0;
      if (input.enableRag) {
        try {
          // RAG-P2-A：构造 sources 数组（按用户开关决定是否包含 conversation）
          const sources: Array<'news' | 'briefing' | 'bilibili' | 'conversation'> =
            ['news', 'briefing', 'bilibili'];
          if (input.enableHistoryRag) {
            sources.push('conversation');
          }
          const rag = await ragRetrieve({
            query: input.content,
            sources,
            windowDays: 30,
            maxPerSource: 5,
            userId: ctx.session.user.id,
            conversationId: input.conversationId,
          });
          references = rag.references;
          ragDurationMs = rag.durationMs;
        } catch (err) {
          // 检索失败不抛错，继续走裸 LLM（降级策略）
          console.warn('[chat/rag] retrieve failed, fallback to plain chat', err);
        }
      }

      // 3.1 把 RAG 结果注入 system prompt（如果有检索结果）
      const messagesForAi: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> =
        history.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));

      if (references.length > 0) {
        const ragContext = `[系统提示] 你正在为 AIHub 用户回答。以下是检索到的项目私有资料，请优先基于这些资料回答，引用时注明标题/日期。\n\n`;
        const ragBlock = ragContext + references.map((r) => {
          const date = r.timestamp.slice(0, 10);
          return `[${r.kind} ${date}] ${r.title}\n${r.snippet.slice(0, 150)}`;
        }).join('\n\n');
        // 插到 messages 最前（system 角色优先于 user 历史）
        messagesForAi.unshift({ role: 'system', content: ragBlock });
      }

      // 3. 调用
      let aiText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let isMock = false;
      try {
        // B-12 修复：chat() 签名是 (model, tenantId, messages, options)
        // 此前误把 messages 传到 tenantId 位置，导致 tenantId 是垃圾数组，AI Key 永远查不到，
        // 生产路径实际走到 dev-mode mock 分支返回占位
        // RAG-P1：用 messagesForAi（包含 RAG context）替代纯 history
        const resp = await chat(
          modelName,
          ctx.tenantId,
          messagesForAi,
          { temperature, maxTokens }
        );
        aiText = resp.content;
        inputTokens = resp.usage.input;
        outputTokens = resp.usage.output;
      } catch (e) {
        // DS-02: 生产环境不可静默 fallback，必须显式报错
        if (process.env.NODE_ENV === 'production') {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'AI service unavailable',
            cause: e,
          });
        }
        // dev 模式：返回占位响应，**不入 UsageStat**（避免估算值污染账本）
        isMock = true;
        aiText = `[dev-mode mock] LiteLLM 不可达：${(e as Error).message}\n\n收到消息："${input.content.slice(0, 200)}"\n\n（生产环境这里会调真实模型：${modelName}, temp=${temperature}, maxTokens=${maxTokens}）`;
        // mock 模式不估 token，避免账本被估算值污染
        inputTokens = 0;
        outputTokens = 0;
      }

      // 4. 事务：userMsg + aiMsg + conversation.updatedAt 三者原子提交
      //    任一失败 → 全部回滚，避免「半截对话」「列表时间戳不更新」等不一致
      //    AI 调用已在事务外完成（避免持锁 30s+），此处只负责落库与时间戳
      const { userMsg, aiMsg } = await prisma.$transaction(async (tx) => {
        const userMessage = await tx.message.create({
          data: {
            conversationId: input.conversationId,
            role: 'user',
            content: input.content,
            model: modelName,
          },
        });
        const aiMessage = await tx.message.create({
          data: {
            conversationId: input.conversationId,
            role: 'assistant',
            content: aiText,
            tokenCount: isMock ? null : outputTokens,
            model: modelName,
          },
        });
        // 同步更新 Conversation 缓存字段（status 视为 COMPLETED，lastModel 更新，计数 +2）
        await tx.conversation.update({
          where: { id: input.conversationId },
          data: {
            updatedAt: new Date(),
            status: isMock ? 'ACTIVE' : 'COMPLETED',
            lastModel: modelName,
            messageCount: { increment: 2 },
          },
        });
        return { userMsg: userMessage, aiMsg: aiMessage };
      });

      // 5. 触发 UsageStat 记录（仅真实调用；mock 跳过）
      //    事务外：与计费服务解耦，失败不影响对话已成功的事实
      if (!isMock) {
        const cost = calculateCost(modelName, inputTokens, outputTokens, 0);
        await recordUsage({
          tenantId: ctx.tenantId,
          inputTokens,
          outputTokens,
          cost,
          kind: 'chat',
        });
      }

      // RAG-P1：把 references 也返回给前端（用于展示"参考了 X 条资料"）
      return {
        userMsg,
        aiMsg,
        model: modelName,
        usage: { inputTokens, outputTokens, cost: isMock ? 0 : calculateCost(modelName, inputTokens, outputTokens, 0) },
        rag: {
          references,
          count: references.length,
          durationMs: ragDurationMs,
        },
      };
    }),
});

// suppress unused import warning
void env;