/**
 * 模型快照回填脚本（手动 + 一次性）
 *
 * 用途：
 *   1. 给历史已存在但没价格的 Model 记录补上"当前定价 → 第 0 条快照"
 *   2. 标记/取消 isPending 状态
 *   3. 给所有 active 模型跑一次 ModelRankingsScraper.refreshAll
 *
 * 触发场景：
 *   - seed 完后立即调用（seed-models.ts 已经会调 refreshAll）
 *   - scraper 大版本更新后统一回填
 *   - 手动 cron 兜底失败后批量补偿
 *
 * 运行：
 *   npx tsx scripts/backfill-model-snapshots.ts [--dry-run]
 *
 * ⚠️ 双环境：
 *   - 本地 SQLite：用 `pnpm db:push && pnpm seed:models` 跑即可
 *   - Vercel Postgres：本地跑会写入 .env DATABASE_URL 指向的库
 */

import { PrismaClient } from '@prisma/client';
import { ModelScraper } from '../src/lib/rankings/scraper';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   AI 模型快照回填脚本 — backfill-model-snapshots    ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`模式：${dryRun ? '🟡 DRY RUN（不写入）' : '🟢 实际写入'}\n`);

  // 1. 统计现状
  const total = await prisma.model.count({ where: { isActive: true } });
  const noPrice = await prisma.model.count({
    where: { isActive: true, priceInput: 0 },
  });
  const pending = await prisma.model.count({
    where: { isActive: true, isPending: true },
  });
  const snapshots = await prisma.modelSnapshot.count();

  console.log('📊 当前状态：');
  console.log(`   活跃模型数：${total}`);
  console.log(`   无价格模型：${noPrice}`);
  console.log(`   待补标记：${pending}`);
  console.log(`   现有快照：${snapshots}\n`);

  // 2. 列出需要回填的模型
  if (noPrice > 0) {
    const needFill = await prisma.model.findMany({
      where: { isActive: true, priceInput: 0 },
      select: { externalId: true, name: true, provider: true },
    });
    console.log(`🔍 待回填模型清单（${needFill.length}）：`);
    needFill.forEach((m) => console.log(`   - ${m.externalId} (${m.provider})`));
    console.log();
  }

  if (dryRun) {
    console.log('🟡 DRY RUN 模式，跳过实际写入');
    return;
  }

  // 3. 调用 scraper 回填
  console.log('🚀 启动 ModelScraper，回填价格 + 能力分 + 快照...\n');
  const scraper = new ModelScraper();
  await scraper.refreshAll();

  // 4. 回填后状态
  const after = {
    total: await prisma.model.count({ where: { isActive: true } }),
    priced: await prisma.model.count({
      where: { isActive: true, priceInput: { gt: 0 } },
    }),
    pending: await prisma.model.count({
      where: { isActive: true, isPending: true },
    }),
    snapshots: await prisma.modelSnapshot.count(),
  };

  console.log('\n✅ 回填完成！');
  console.log(`   活跃模型：${after.total}（之前 ${total}）`);
  console.log(`   已定价：${after.priced}（之前 ${total - noPrice}）`);
  console.log(`   待补：${after.pending}（之前 ${pending}）`);
  console.log(`   快照总数：${after.snapshots}（之前 ${snapshots}）`);

  // 5. 如果还有 pending，列出 warning
  if (after.pending > 0) {
    const stillPending = await prisma.model.findMany({
      where: { isActive: true, isPending: true },
      select: { externalId: true, name: true, provider: true },
    });
    console.log(`\n⚠️ 以下 ${stillPending.length} 个模型仍待补：`);
    stillPending.forEach((m) => console.log(`   - ${m.externalId} (${m.provider})`));
    console.log('\n可能原因：');
    console.log('   1. scraper.ts 的 PRICING_TABLE 没覆盖该 externalId');
    console.log('   2. 官方定价页 403/超时（已 fallback 到第三方）');
    console.log('   3. 模型是新的，docs/38-AI模型数据源清单.md 还未登记');
  }
}

main()
  .catch((err) => {
    console.error('\n❌ 回填失败：', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });