/**
 * 同步新闻源配置到数据库
 */
import { prismaBase as prisma } from '../src/lib/db';
import { NEWS_SOURCES } from '../src/lib/news/sources';

async function syncSources() {
  console.log(`[sync] Syncing ${NEWS_SOURCES.length} sources...`);
  
  for (const cfg of NEWS_SOURCES) {
    const existing = await prisma.newsSource.findUnique({
      where: { name: cfg.name },
    });

    if (existing) {
      // 更新 URL 和配置
      await prisma.newsSource.update({
        where: { id: existing.id },
        data: {
          url: cfg.url,
          type: cfg.type,
          priority: cfg.priority,
          enabled: cfg.enabled ?? true,
          fragile: cfg.fragile ?? false,
          notes: cfg.notes ?? null,
        },
      });
      console.log(`[sync] ✓ Updated: ${cfg.name}`);
    } else {
      // 创建新源
      await prisma.newsSource.create({
        data: {
          name: cfg.name,
          url: cfg.url,
          type: cfg.type,
          priority: cfg.priority,
          enabled: cfg.enabled ?? true,
          fragile: cfg.fragile ?? false,
          notes: cfg.notes ?? null,
        },
      });
      console.log(`[sync] ✓ Created: ${cfg.name}`);
    }
  }

  console.log('[sync] Done!');
}

syncSources()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
