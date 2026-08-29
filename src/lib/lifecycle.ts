// 来源：d:\1Money\design\数据库设计.md §10.7 软删除工具
// 批次 B6：软删除 + 恢复 + 硬删除 三件套

import type { PrismaClient } from '@prisma/client';
import { deleteObject } from './r2';

export async function softDeleteProject(
  prisma: PrismaClient,
  projectId: string
): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.file.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: now } }),
    prisma.analysis.updateMany({ where: { projectId, deletedAt: null }, data: { deletedAt: now } }),
    prisma.project.update({ where: { id: projectId }, data: { deletedAt: now } }),
  ]);
}

export async function restoreProject(prisma: PrismaClient, projectId: string): Promise<void> {
  await prisma.$transaction([
    prisma.file.updateMany({ where: { projectId }, data: { deletedAt: null } }),
    prisma.analysis.updateMany({ where: { projectId }, data: { deletedAt: null } }),
    prisma.project.update({ where: { id: projectId }, data: { deletedAt: null } }),
  ]);
}

/**
 * 真正硬删除（仅 admin 调用，绕过中间件白名单）。
 *
 * Q7 修复（路径A）：
 *   - 先收集所有 File.r2Key，在 DB 事务外删 R2 对象
 *   - 再删 DB 行（DB 事务内）
 *   - R2 删除放事务外，避免拉长事务、网络失败难回滚
 */
export async function hardDeleteProject(prisma: PrismaClient, projectId: string): Promise<void> {
  // Step 1：收集要删的 R2 keys（文件 + 背景图）
  const files = await prisma.file.findMany({
    where: { projectId },
    select: { r2Key: true },
  });
  const r2Keys = files.map((f) => f.r2Key).filter(Boolean) as string[];

  // Step 2：R2 删除（事务外，best-effort，失败记日志不阻塞）
  for (const r2Key of r2Keys) {
    deleteObject(r2Key).catch((e) => console.warn('[hardDelete] R2 delete failed:', r2Key, e));
  }

  // Step 3：DB 事务（只删行，不涉及 R2）
  await prisma.$transaction([
    prisma.issue.deleteMany({ where: { analysis: { projectId } } }),
    prisma.score.deleteMany({ where: { analysis: { projectId } } }),
    prisma.analysis.deleteMany({ where: { projectId } }),
    prisma.file.deleteMany({ where: { projectId } }),
    prisma.project.delete({ where: { id: projectId } }),
  ]);
}