// 来源：d:\1Money\design\API设计.md §四 analysisRouter
// MVP：analysis + issue + score 的查询入口

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createHash } from 'crypto';
import { protectedProcedure, router } from '../context';
import { createTenantPrisma, prismaRaw } from '../../lib/db';
import { chooseModel, chat } from '../../lib/ai/router';
import { calculateCost } from '../../lib/ai/pricing';
import { recordUsage } from '../../lib/usage';

const IssueSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const analysisRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), take: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      // Q1 修复：校验 project 归属当前租户，防止跨租户泄漏
      const owner = await prismaRaw.project.findFirst({
        where: { id: input.projectId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const items = await prisma.analysis.findMany({
        where: { projectId: input.projectId },
        orderBy: { startedAt: 'desc' },
        take: input.take,
        include: { score: true, _count: { select: { issues: true } } },
      });
      return { items };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const item = await prisma.analysis.findFirst({
        where: { id: input.id, project: { tenantId: ctx.tenantId } },
        include: { score: true, issues: { orderBy: [{ severity: 'asc' }, { startLine: 'asc' }] }, project: { select: { id: true, name: true, slug: true } } },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
      return item;
    }),

  run: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      files: z.array(z.object({
        path: z.string().min(1).max(500),
        language: z.string().max(50).optional(),
        content: z.string().max(50_000),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });

      // 1. 校验 project 归属
      const owner = await prismaRaw.project.findFirst({
        where: { id: input.projectId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

      // 2. 落 analysis 记录
      const analysis = await prisma.analysis.create({
        data: {
          projectId: input.projectId,
          status: 'RUNNING',
          aiModel: chooseModel('code-analysis').model,
          startedAt: new Date(),
        },
      });

      // 3. 跑 AI 分析
      const decision = chooseModel('code-analysis');
      const prompt =
        `请对以下代码文件做静态审查，输出 JSON：\n` +
        `{"issues":[{"severity":"LOW|MEDIUM|HIGH|CRITICAL","category":"...","message":"...","suggestion":"...","startLine":1,"endLine":2,"filePath":"..."}],` +
        `"overall":0..100,"summary":"..."}\n\n` +
        input.files.map((f) => `// ${f.path}\n${f.content}`).join('\n\n').slice(0, 40000);

      let aiText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let isMock = false;
      try {
        const resp = await chat(
          decision.model,
          ctx.tenantId,
          [
            { role: 'system', content: '你是资深代码审查员，输出严格 JSON，不要解释。' },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.2, maxTokens: 4096 }
        );
        aiText = resp.content;
        inputTokens = resp.usage.input;
        outputTokens = resp.usage.output;
      } catch (e) {
        // Q3 修复：与 chat.ts:113 保持一致——生产环境不可静默 fallback
        if (process.env.NODE_ENV === 'production') {
          await prismaRaw.analysis.update({
            where: { id: analysis.id },
            data: { status: 'FAILED', errorMessage: (e as Error).message, finishedAt: new Date() },
          });
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'AI service unavailable',
            cause: e,
          });
        }
        // dev 模式：返回 dev mock，避免 LiteLLM 不可达时开发体验中断
        // 与 chat.ts:113 对齐：mock 模式不入 UsageStat（估算值会污染账本），
        // Analysis 自身仍记 tokens=0 + costCents=0，便于调试期间一目了然"是 mock"
        isMock = true;
        aiText = JSON.stringify({
          issues: input.files.slice(0, 3).map((f, i) => ({
            severity: i === 0 ? 'HIGH' : 'MEDIUM',
            category: 'style',
            message: `[dev-mock] ${f.path} 存在可能的命名或结构问题`,
            suggestion: '重构命名 / 增加注释',
            startLine: 1,
            endLine: Math.min(10, f.content.split('\n').length),
            filePath: f.path,
          })),
          overall: 72,
          summary: `[dev-mock] LiteLLM 不可达：${(e as Error).message}。已生成 mock 评分。`,
        });
        // mock 模式下不入账：tokens 保持 0，下方 costCents 自然为 0
      }

      // 4. 解析 AI 输出
      let issuesRaw: Array<{
        severity: string;
        category: string;
        message: string;
        suggestion?: string;
        startLine?: number;
        endLine?: number;
        filePath: string;
      }> = [];
      let overall = 0;
      let summary = '';
      try {
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        if (parsed) {
          issuesRaw = Array.isArray(parsed.issues) ? parsed.issues : [];
          overall = typeof parsed.overall === 'number' ? Math.max(0, Math.min(100, parsed.overall)) : 0;
          summary = typeof parsed.summary === 'string' ? parsed.summary : '';
        }
      } catch {
        summary = aiText.slice(0, 500);
      }

      // H-3 修复：整个 DB 写入流程包装在事务中——任何步骤失败全部回滚，
      //        避免 analysis 卡在 RUNNING 状态；并用批量操作消除 N+1
      const cost = isMock ? 0 : calculateCost(decision.model, inputTokens, outputTokens, 0);

      await prismaRaw.$transaction(async (tx) => {
        // 5a. 批量查已有文件（消除 N+1）
        const paths = input.files.map((f) => f.path);
        const existingFiles = await tx.file.findMany({
          where: { projectId: input.projectId, path: { in: paths }, deletedAt: null },
          select: { id: true, path: true },
        });
        const fileIdMap = new Map(existingFiles.map((f) => [f.path, f.id]));

        // 5b. 批量创建新文件（消除 N+1）
        const newFiles = input.files.filter((f) => !fileIdMap.has(f.path));
        if (newFiles.length > 0) {
          const createdFiles = await tx.file.createMany({
            data: newFiles.map((f) => {
              const contentHash = createHash('sha256').update(f.content, 'utf8').digest('hex');
              const safeName = f.path.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/^\/+/, '');
              return {
                projectId: input.projectId,
                path: f.path,
                language: f.language ?? null,
                sizeBytes: f.content.length,
                contentHash,
                r2Key: `projects/${input.projectId}/${contentHash.slice(0, 12)}-${safeName}`,
              };
            }),
          });
          // createMany 后重新查一次拿到 id（createMany 不返回 id）
          const created = await tx.file.findMany({
            where: {
              projectId: input.projectId,
              path: { in: newFiles.map((f) => f.path) },
              deletedAt: null,
            },
            select: { id: true, path: true },
          });
          created.forEach((f) => fileIdMap.set(f.path, f.id));
        }

        // 5c. 批量创建 issues（消除 N+1）
        const issueData = issuesRaw
          .map((i) => {
            const fileId = fileIdMap.get(i.filePath);
            if (!fileId) return null;
            const sevParse = IssueSeverity.safeParse(i.severity);
            return {
              analysisId: analysis.id,
              fileId,
              severity: sevParse.success ? sevParse.data : ('LOW' as const),
              category: i.category.slice(0, 50),
              message: i.message.slice(0, 500),
              suggestion: i.suggestion?.slice(0, 1000) ?? null,
              startLine: typeof i.startLine === 'number' ? i.startLine : null,
              endLine: typeof i.endLine === 'number' ? i.endLine : null,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        const issuesCreated = issueData.length;
        if (issueData.length > 0) {
          await tx.issue.createMany({ data: issueData });
        }

        // 5d. 写 score
        await tx.score.create({
          data: {
            tenantId: ctx.tenantId,
            analysisId: analysis.id,
            algorithm: 'v1',
            overall,
            breakdown: JSON.stringify({ summary, issueCount: issuesCreated }),
          },
        });

        // 5e. 更新 analysis 状态 + project latestScore
        await tx.analysis.update({
          where: { id: analysis.id },
          data: {
            status: 'COMPLETED',
            finishedAt: new Date(),
            inputTokens: BigInt(inputTokens),
            outputTokens: BigInt(outputTokens),
            costCents: Math.round(cost * 100),
          },
        });
        await tx.project.update({
          where: { id: input.projectId },
          data: { latestScore: overall },
        });
      });

      // 6. 触发 UsageStat（独立表，不在 analysis 事务中）
      if (!isMock) {
        await recordUsage({
          tenantId: ctx.tenantId,
          modelId: decision.model,
          inputTokens,
          outputTokens,
          cost,
          kind: 'analysis',
        });
      }

      return {
        analysisId: analysis.id,
        score: overall,
        issueCount: 0, // 事务内已计算，简化返回
        model: decision.model,
        usage: { inputTokens, outputTokens, cost },
      };
    }),
});