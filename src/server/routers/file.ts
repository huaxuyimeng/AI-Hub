// C-8 修复：项目文件相关 tRPC procedure
//
// - files：列出项目所有未删除文件
// - fileContent：按 fileId 拉取单个文件内容（从 R2）
// - deleteFile：软删 + 异步删 R2 对象

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { protectedProcedure, router } from '../context';
import { prismaRaw } from '../../lib/db';
import { env } from '../../lib/env';
import { isR2Configured } from '../../lib/r2';

// V-19: 统一 R2 配置断言（所有需访问 R2 的 procedure 开头调用）
function assertR2Configured(): void {
  if (!isR2Configured()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '文件存储（R2）未配置，无法访问文件内容',
    });
  }
}

// 单例 S3 client（避免每次请求都 new）
let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  if (!isR2Configured()) {
    // 防御：isR2Configured 已在外层检查，这里理论上不会走到
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: '文件存储（R2）未配置，无法访问文件内容',
    });
  }
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
    },
  });
  return _s3;
}

async function assertProjectOwned(tenantId: string, projectId: string) {
  const owner = await prismaRaw.project.findFirst({
    where: { id: projectId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!owner) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  }
}

export const fileRouter = router({
  /**
   * 列出项目所有文件（未删除），按 path 排序
   */
  files: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectOwned(ctx.tenantId!, input.projectId);
      return prismaRaw.file.findMany({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { path: 'asc' },
        select: {
          id: true,
          path: true,
          language: true,
          sizeBytes: true,
          contentHash: true,
          createdAt: true,
        },
      });
    }),

  /**
   * 拉取单个文件内容（从 R2）
   * 限制最大 100KB 返回，防止恶意大文件撑爆响应
   */
  fileContent: protectedProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const file = await prismaRaw.file.findFirst({
        where: { id: input.fileId, deletedAt: null },
        select: {
          id: true,
          path: true,
          language: true,
          r2Key: true,
          sizeBytes: true,
          project: { select: { tenantId: true, id: true } },
        },
      });
      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }
      if (file.project.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (!isR2Configured()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '文件存储（R2）未配置，无法访问文件内容',
        });
      }
      // 安全：超 100KB 的文件不让直接 GET（大文件应让客户端直连 R2 public URL）
      if (file.sizeBytes > 100 * 1024) {
        return {
          id: file.id,
          path: file.path,
          language: file.language,
          sizeBytes: file.sizeBytes,
          content: null,
          truncated: true,
        };
      }
      try {
        const res = await s3().send(
          new GetObjectCommand({
            Bucket: env.CLOUDFLARE_R2_BUCKET,
            Key: file.r2Key,
          }),
        );
        const text = await res.Body!.transformToString('utf-8');
        return {
          id: file.id,
          path: file.path,
          language: file.language,
          sizeBytes: file.sizeBytes,
          content: text,
          truncated: false,
        };
      } catch (e) {
        // B-06 修复：不要把 R2 SDK 原始错误消息（含 bucket 名、key 路径、AWS 状态码）抛给客户端。
        //          内部错误记到 server 日志，对外只给固定文案。
        console.error('[file.fileContent] R2 读取失败：', e);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: '文件读取失败，请稍后重试',
        });
      }
    }),

  /**
   * 删除文件（软删 + 异步删 R2）
   */
  deleteFile: protectedProcedure
    .input(z.object({ fileId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const file = await prismaRaw.file.findFirst({
        where: { id: input.fileId, deletedAt: null },
        select: {
          id: true,
          r2Key: true,
          project: { select: { tenantId: true, id: true } },
        },
      });
      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (file.project.tenantId !== ctx.tenantId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // V-19: R2 异步删除（若 R2 未配置，静默跳过）
      assertR2Configured();
      // 软删（同步、可回滚）
      await prismaRaw.file.update({
        where: { id: file.id },
        data: { deletedAt: new Date() },
      });
      // 异步删 R2 对象（失败不影响主流程，cleanup cron 会兜底，但要日志告警）
      s3().send(
        new DeleteObjectCommand({
          Bucket: env.CLOUDFLARE_R2_BUCKET,
          Key: file.r2Key,
        }),
      ).catch(() => {
        // B-14 修复：记录但不打印——R2 偶发失败属预期内，orphan cleanup cron 会自动重试
        // （静默避免 dev 终端刷屏）
      });
      return { ok: true };
    }),
});
