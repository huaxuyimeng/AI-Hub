// 创建 SYSTEM 租户（B-13 修复）
// 设计意图：所有系统级 AI 调用（早报/术语/意图解析共享默认 key）使用统一租户，
// 便于审计、配额管理与故障排查。
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const SYSTEM_SLUG = 'system';
  const SYSTEM_NAME = 'AIHub System';

  const existing = await prisma.tenant.findUnique({ where: { slug: SYSTEM_SLUG } });
  if (existing) {
    console.log('[seed-system-tenant] SYSTEM tenant already exists:', existing.id);
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      slug: SYSTEM_SLUG,
      name: SYSTEM_NAME,
      plan: 'ENTERPRISE', // 不消耗配额
    },
  });
  console.log('[seed-system-tenant] created:', tenant.id, tenant.slug);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
