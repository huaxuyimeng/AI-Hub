import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const builtIn = await p.expertAgent.count({ where: { isBuiltIn: true, deletedAt: null } });
  const user = await p.expertAgent.findMany({
    where: { isBuiltIn: false },
    select: { id: true, name: true, createdByUserId: true, tenantId: true },
  });
  console.log(`内置: ${builtIn} 个`);
  console.log(`用户自建副本: ${user.length} 个`);
  for (const e of user) {
    console.log(`  - ${e.name} | createdBy=${e.createdByUserId ?? 'NULL'} | tenant=${e.tenantId ?? 'NULL'}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => p.$disconnect());
