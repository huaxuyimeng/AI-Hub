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

export const chatRouter = router({
  list: protectedProcedure
    .input(z.object({ take: z.number().int().min(1).max(100).default(20), cursor: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const items = await prisma.conversation.findMany({
        take: input.take + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        orderBy: { updatedAt: 'desc' },
      });
      const nextCursor = items.length > input.take ? items.pop()?.id : null;
      return { items, nextCursor };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const conversation = await prisma.conversation.findUnique({
        where: { id: input.id },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      if (!conversation) throw new TRPCError({ code: 'NOT_FOUND' });
      return conversation;
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
      const owner = await prismaRaw.conversation.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND' });
      await prismaRaw.conversation.update({ where: { id: input.id }, data: { deletedAt: new Date() } });
      return { ok: true };
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      conversationId: z.string().uuid(),
      content: z.string().min(1).max(8000),
      model: z.enum(SUPPORTED_MODEL_NAMES).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(64).max(8192).optional(),
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

      // 3. 调用
      let aiText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let isMock = false;
      try {
        const resp = await chat(
          modelName,
          history.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
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
        await tx.conversation.update({
          where: { id: input.conversationId },
          data: { updatedAt: new Date() },
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

      return { userMsg, aiMsg, model: modelName, usage: { inputTokens, outputTokens, cost: isMock ? 0 : calculateCost(modelName, inputTokens, outputTokens, 0) } };
    }),
});

// suppress unused import warning
void env;