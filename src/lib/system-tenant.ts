/**
 * 系统级租户常量与解析器
 *
 * 用途：早报 / 术语 cron / 共享意图解析等"无用户上下文"的 AI 调用，
 * 统一使用 SYSTEM 租户的 ApiKey，避免传 'system' 字面量当 tenantId
 * （之前会导致 resolveApiKey 永远查不到，走 dev-mode mock 占位）。
 *
 * 设计意图：
 *   - SYSTEM 租户在 prisma/seed-system-tenant.ts 创建（slug='system', plan='ENTERPRISE'）
 *   - 生产环境由运维给该租户配置 ApiKey（与其他租户同等流程）
 *   - 失败兜底：返回 null，调用方决定降级或抛错
 */
import { prismaBase } from '@/lib/db';

const SYSTEM_SLUG = 'system';

let cachedTenantId: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 分钟缓存（启动时拉一次）

/** 拿 SYSTEM 租户 ID（缓存 1 分钟） */
export async function getSystemTenantId(): Promise<string | null> {
  if (cachedTenantId && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedTenantId;
  }
  const tenant = await prismaBase.tenant.findUnique({
    where: { slug: SYSTEM_SLUG },
    select: { id: true },
  });
  cachedTenantId = tenant?.id ?? null;
  cachedAt = Date.now();
  return cachedTenantId;
}

/** 清空缓存（用于测试 / 手动触发） */
export function resetSystemTenantCache(): void {
  cachedTenantId = null;
  cachedAt = 0;
}
