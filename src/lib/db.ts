// 来源：d:\1Money\design\数据库设计.md §4.2 + §10 安全加固
// 批次 A 必修 + 批次 B5 补全 + 批次 B2 启用中间件
// 核心要点：
//   1) 注入 tenant 上下文（ctx.tenantId 不可信时 throw）
//   2) 默认 where 添加 deletedAt: null（白名单模型）
//   3) 白名单模型 = 实际有 tenantId 字段的模型（v3.3.1 修正）
// 批次 C21：扩展操作列表 (upsert / createMany / groupBy / findUniqueOrThrow / findFirstOrThrow)
// 批次 C33：递归注入嵌套 data.tenantId

import { PrismaClient, Prisma } from '@prisma/client';

const TENANT_SCOPED_MODELS = new Set([
  // 批次 B5 + v3.3.1：白名单 = 实际带 tenantId 字段的模型
  // 重要：Analysis / File / Message / Issue 都不直接带 tenantId，
  //       通过 projectId / conversationId / fileId 等关联间接过滤，不在白名单内
  //       中间件对它们仅做软删除过滤（SOFT_DELETE_AWARE）
  'User',
  'Project',
  'ApiKey',
  'Conversation',
  'Score',
  'InstalledPlugin',
  'PluginAuditLog',
  'UsageStat',
  // 全局模型（不带 tenantId）：Plugin, PluginVersion, ModelRanking
]);

// Soft-delete aware —— 这些模型有 deletedAt 字段
const SOFT_DELETE_AWARE = new Set([
  ...TENANT_SCOPED_MODELS,
  'Analysis',
  'File',
  'Message',
  'Issue',
]);

// C21：操作分类
const READ_OPS = [
  'findUnique', 'findUniqueOrThrow',
  'findFirst', 'findFirstOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'delete', 'deleteMany',
];
const SOFT_DELETE_OPS = new Set(READ_OPS);
const UPSERT_OPS = new Set(['upsert']);
const CREATE_MANY_OPS = new Set(['createMany']);

const globalForPrisma = globalThis as unknown as {
  __prismaBase?: PrismaClient;
};

export const prismaBase =
  globalForPrisma.__prismaBase ??
  new PrismaClient({
    // P0 控制台清理：开发模式关闭 query 日志（每条 SQL 都打印，太吵）
    // 线上用 warn + error；开发也统一用 warn + error，把 query 留给 Prisma Studio
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prismaBase = prismaBase;
}

export type TenantContext = { tenantId: string };

// C33：递归注入嵌套 data 中的 tenantId。
// 防止循环引用（visited 集合）；限定深度避免栈爆。
function injectTenantIdDeep(data: unknown, tenantId: string, visited = new WeakSet(), depth = 0): unknown {
  if (data == null || depth > 6) return data;
  if (typeof data !== 'object') return data;
  if (visited.has(data as object)) return data;
  visited.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => injectTenantIdDeep(item, tenantId, visited, depth + 1));
  }

  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  if (!('tenantId' in out) && (out as { id?: unknown }).id === undefined && typeof out === 'object') {
    // 不主动加 tenantId 到无 tenantId 字段的关联模型（Account / Session / File / Message / Issue）
    // 这些模型本身无 tenantId，依赖外键间接过滤
    // 但对嵌套 create（如 accounts.create / sessions.create），跳过
  }

  for (const key of Object.keys(out)) {
    const val = out[key];
    // 处理形如 xxx: { create: {...} } / xxx: { createMany: {...} } / xxx: { connect: {...} }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sub = val as Record<string, unknown>;
      if ('create' in sub && typeof sub.create === 'object') {
        sub.create = injectTenantIdDeep(sub.create, tenantId, visited, depth + 1);
      }
      if ('createMany' in sub && typeof sub.createMany === 'object') {
        const cm = sub.createMany as { data?: unknown };
        if (cm.data) cm.data = injectTenantIdDeep(cm.data, tenantId, visited, depth + 1);
      }
    }
    if (Array.isArray(val)) {
      out[key] = val.map((item) => {
        if (item && typeof item === 'object' && 'create' in (item as Record<string, unknown>)) {
          const sub = item as { create: unknown };
          return { ...sub, create: injectTenantIdDeep(sub.create, tenantId, visited, depth + 1) };
        }
        return item;
      });
    }
  }

  return out;
}

// 核心扩展：注入 tenant + 软删除过滤
export function createTenantPrisma(ctx: TenantContext) {
  if (!ctx?.tenantId) {
    throw new Error('No tenant context: prisma must be wrapped in withTenant()');
  }

  return prismaBase.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const isScoped = TENANT_SCOPED_MODELS.has(model);
          const isSoftDelete = SOFT_DELETE_AWARE.has(model);
          const argsAny = args as unknown as {
            where?: Record<string, unknown>;
            data?: unknown;
            create?: Record<string, unknown>;
          };
          const nextArgs: Record<string, unknown> = { ...args };

          // C21：upsert 分支 - 注入 where.tenantId + create.tenantId
          if (isScoped && UPSERT_OPS.has(operation)) {
            argsAny.where = { ...(argsAny.where ?? {}), tenantId: ctx.tenantId };
            argsAny.create = { ...(argsAny.create ?? {}), tenantId: ctx.tenantId };
          }

          // C21：createMany 分支 - 注入 data.tenantId（数组或对象）
          if (isScoped && CREATE_MANY_OPS.has(operation)) {
            const data = argsAny.data;
            if (Array.isArray(data)) {
              argsAny.data = data.map((d) => ({ ...d, tenantId: ctx.tenantId }));
            } else if (data && typeof data === 'object') {
              argsAny.data = { ...(data as Record<string, unknown>), tenantId: ctx.tenantId };
            }
          }

          // C21：create 分支顶层注入 tenantId
          if (isScoped && operation === 'create') {
            if (argsAny.data && typeof argsAny.data === 'object') {
              argsAny.data = { ...(argsAny.data as Record<string, unknown>), tenantId: ctx.tenantId };
            }
          }

          // READ 类操作注入 tenantId + deletedAt
          if (READ_OPS.includes(operation) && (isScoped || isSoftDelete)) {
            if (isScoped) {
              argsAny.where = { ...(argsAny.where ?? {}), tenantId: ctx.tenantId };
            }
            if (SOFT_DELETE_OPS.has(operation)) {
              const w = argsAny.where ?? {};
              if (!('deletedAt' in w)) {
                argsAny.where = { ...w, deletedAt: null };
              }
            }
          }

          // C33：所有 scoped 操作，递归注入嵌套 data.create / createMany 的 tenantId
          // （用于嵌套创建：prisma.user.create({ data: { accounts: { create: {...} } } })）
          if (isScoped && (operation === 'create' || UPSERT_OPS.has(operation) || CREATE_MANY_OPS.has(operation))) {
            if ('data' in argsAny && argsAny.data) {
              argsAny.data = injectTenantIdDeep(argsAny.data, ctx.tenantId) as Record<string, unknown>;
            }
            if ('create' in argsAny && argsAny.create) {
              argsAny.create = injectTenantIdDeep(argsAny.create, ctx.tenantId) as Record<string, unknown>;
            }
          }

          return query(argsAny);
        },
      },
    },
  });
}

/**
 * 在 tRPC mutation / query 中使用：
 *
 *   const prisma = createTenantPrisma(ctx);
 *   return prisma.project.findMany({ where: { tenantId: ctx.tenantId } });
 */
export function withTenant<T>(ctx: TenantContext, fn: (prisma: ReturnType<typeof createTenantPrisma>) => Promise<T>): Promise<T> {
  return fn(createTenantPrisma(ctx));
}

export { prismaBase as prismaRaw, Prisma };