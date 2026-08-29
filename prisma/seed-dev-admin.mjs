// Dev-only seed: creates a stable admin test account so the login page
// default values (admin@aihub.local / admin123) actually work.
//
// Usage:  node prisma/seed-dev-admin.mjs
// Idempotent: re-running just resets the password and updates name.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@aihub.local';
const ADMIN_PASSWORD = 'admin123';

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const existing = await prisma.user.findFirst({
    where: { email: ADMIN_EMAIL, deletedAt: null },
    select: { id: true, tenantId: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, name: 'Dev Admin' },
    });
    console.log(`[seed] reset password for existing user: ${ADMIN_EMAIL}`);
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Dev Admin 的工作台',
      slug: `dev-admin-${Date.now().toString(36)}`,
    },
  });

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      name: 'Dev Admin',
      passwordHash,
      role: 'ADMIN',
    },
  });

  console.log(`[seed] created dev admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`[seed] tenant: ${tenant.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
