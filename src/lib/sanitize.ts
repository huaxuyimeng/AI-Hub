// 来源：d:\1Money\design\数据库设计.md §10.7 + §10.4（API 响应剥离）
// 用途：防止数据库结构暴露（批次 A 必修 + 批次 S 加固）
// 批次 C26：删除通用 sanitize<T> 死代码（toPublicProject 仍保留真实业务）

import { z } from 'zod';

const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
  latestScore: z.number().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ProjectPublic = z.infer<typeof ProjectSchema>;

export const PublicProjectSchema = ProjectSchema;

/**
 * 将数据库 Project 转为对外暴露对象
 * 注：用 safeParse 而非 parse，避免 Prisma 注入的元数据（如 __prisma）导致报错
 */
export function toPublicProject(row: Record<string, unknown>): ProjectPublic {
  const result = PublicProjectSchema.safeParse(row);
  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error('[toPublicProject] Zod 校验失败：', result.error.flatten());
    throw new Error('Project row does not match PublicProjectSchema');
  }
  return result.data;
}