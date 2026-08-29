// 来源：d:\1Money\design\部署运维.md §11.1 Vercel Cron 同入口
// 本地或生产手动调用：pnpm cron:cleanup

import { cleanupOrphanFiles } from '../lib/cleanup';

async function main() {
  console.log('[cleanup] starting orphan file cleanup...');
  const result = await cleanupOrphanFiles();
  console.log(`[cleanup] done. deleted=${result.deleted} errors=${result.errors}`);
  process.exit(result.errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[cleanup] fatal:', e);
  process.exit(1);
});