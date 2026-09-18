/* eslint-disable no-console */
// Resolve duplicate `Project` rows by deleting the older entry per (tenantId, name).
// IMPORTANT: This script currently hard-codes the duplicate we resolved on 2026-09-15.
//   Before re-running, edit the `tenantId` + `name` in the SQL below to match the
//   new duplicate that `scripts/audit-dup.cjs` flagged. Refuses (early-return)
//   when fewer than 2 matching rows exist.
// Usage: `node scripts/resolve-dup.cjs` (destructive: deletes 1 row).
// Safety: backup dev.db first via `Copy-Item prisma\dev.db prisma\dev.db.bak-<timestamp>.db`.
// Expiry: delete once a proper merge workflow replaces this one-off cleanup.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const rows = await p.$queryRawUnsafe(
    `SELECT id, tenantId, name, slug, createdAt FROM Project
     WHERE tenantId = 'f8ed0da6-7d5f-4a30-af2b-8108b00e8e20' AND name = 'Playwright 测试项目'
     ORDER BY createdAt ASC`
  );
  console.log('=== duplicate rows (asc by createdAt) ===');
  console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));

  if (rows.length < 2) {
    // eslint-disable-next-line no-console
    console.log('No longer duplicated, skip delete.');
    return;
  }

  const keepId = rows[rows.length - 1].id;
  const deleteIds = rows.slice(0, -1).map(r => r.id);

  console.log('=== keep ===', keepId);
  console.log('=== delete ===', deleteIds);

  // Child safety check: refuse if any child rows would block
  const childModels = [
    'ChatSession', 'RankingRun', 'SlideJob', 'NewsItem',
    'BilibiliVideo', 'UsageRecord', 'ProjectMember',
  ];
  for (const m of childModels) {
    try {
      const cnt = await p[m].count({ where: { projectId: { in: deleteIds } } });
      console.log(`child ${m}: ${cnt}`);
    } catch (e) {
      console.log(`child ${m}: n/a (${e.code || e.message?.slice(0,60)})`);
    }
  }

  // Only delete the oldest one (per user instruction: "delete the older one")
  const target = rows[0].id;
  await p.project.delete({ where: { id: target } });
  console.log('deleted:', target);

  const remaining = await p.$queryRawUnsafe(
    `SELECT id, createdAt FROM Project WHERE id IN (${deleteIds.map(() => '?').join(',')})`,
    ...deleteIds.filter(id => id !== target)
  );
  console.log('remaining siblings:', JSON.stringify(remaining, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
