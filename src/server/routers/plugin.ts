// 来源：d:\1Money\design\API设计.md §七 pluginRouter
// MVP：插件市场的 list + 已安装的 list / install / uninstall

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../context';
import { createTenantPrisma, prismaRaw } from '../../lib/db';

const SEED_PLUGINS = [
  {
    id: 'plugin-eslint',
    name: 'eslint-suite',
    displayName: 'ESLint Suite',
    description: '集成 ESLint 规则库，覆盖 JS/TS 项目最常见 100+ 代码风格问题',
    author: 'AIHub Core',
    tags: 'lint,style,quality,security',
    iconUrl: null,
  },
  {
    id: 'plugin-dep-audit',
    name: 'dependency-audit',
    displayName: 'Dependency Audit',
    description: '扫描 npm/pnpm 依赖中的已知漏洞，并给出升级建议',
    author: 'AIHub Security',
    tags: 'security,deps,quality',
    iconUrl: null,
  },
  {
    id: 'plugin-doc-gen',
    name: 'doc-gen',
    displayName: 'Auto Doc Generator',
    description: '基于 AST 自动生成函数级 JSDoc / Python docstring',
    author: 'AIHub Docs',
    tags: 'docs,docs,productivity',
    iconUrl: null,
  },
];

export const pluginRouter = router({
  /** 列出 Plugin 列表（含未安装） */
  marketList: protectedProcedure.query(async () => {
    // 真实 Plugin 表当前是空的（MVP 阶段未接市场），用 seed 数据
    return SEED_PLUGINS;
  }),

  /** 当前租户已安装的插件 */
  installedList: protectedProcedure.query(async ({ ctx }) => {
    const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
    return prisma.installedPlugin.findMany({
      orderBy: { createdAt: 'desc' },
      include: { plugin: true },
    });
  }),

  install: protectedProcedure
    .input(z.object({ pluginName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const seed = SEED_PLUGINS.find((p) => p.name === input.pluginName);
      if (!seed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plugin not in seed catalog' });

      // DS-03: 不要用 seed.id（slug）当主键，会与生产 uuid 冲突且类型不一致
      // 改用 name 唯一，create 不传 id，让 @default(uuid()) 自行生成
      const { id: _omitId, ...seedData } = seed;
      await prismaRaw.plugin.upsert({
        where: { name: seed.name },
        update: {},
        create: seedData,
      });

      const plugin = await prismaRaw.plugin.findUnique({ where: { name: seed.name } });
      if (!plugin) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const existing = await prismaRaw.installedPlugin.findFirst({
        where: { tenantId: ctx.tenantId, pluginId: plugin.id, deletedAt: null },
      });
      if (existing) {
        return { ok: true, alreadyInstalled: true };
      }

      const installed = await prisma.installedPlugin.create({
        data: { tenantId: ctx.tenantId, pluginId: plugin.id, enabled: true },
      });
      return { ok: true, installed };
    }),

  uninstall: protectedProcedure
    .input(z.object({ installedId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const owner = await prisma.installedPlugin.findFirst({
        where: { id: input.installedId, tenantId: ctx.tenantId },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND' });
      await prisma.installedPlugin.update({
        where: { id: input.installedId },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    }),
});