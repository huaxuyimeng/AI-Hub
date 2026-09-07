// 来源：d:\1Money\design\API设计.md §二 tRPC root
// 当前阶段挂的 routers：project / chat / analysis / usage / plugin / preferences / news / rankings

import { router } from '../context';
import { projectRouter } from './project';
import { fileRouter } from './file';
import { chatRouter } from './chat';
import { analysisRouter } from './analysis';
import { usageRouter } from './usage';
import { pluginRouter } from './plugin';
import { preferencesRouter } from './preferences';
import { wallpaperRouter } from './wallpaper';
import { newsRouter } from './news';
import { rankingsRouter } from './rankings';
import { dailyReportRouter } from '@/features/daily-briefing/server/router';
import { bilibiliRouter } from './bilibili';
import { aiKeysRouter } from './ai-keys';
import { cleanupRouter } from './cleanup';
// BUG-019：cacheRouter 文件已存在但未实现（Phase 4 未完整），暂不挂载。
//   CachePanel.tsx 也未在 settings/page.tsx 引用，未启用。
//   后续如需启用"数据与缓存"面板，需：
//     1. 在 cache.ts 实现 5 个 procedure（stats/getCleanupLog/cleanPptCache/cleanSnapshots/scanOrphanR2）
//     2. 在此处挂载 cache: cacheRouter
//     3. 在 settings/page.tsx 解开 CachePanel 引用
// 来源：docs/实施记录/46-第二轮回扫与深层漏洞修复_2026.09.03.md §四

export const appRouter = router({
  project: projectRouter,
  file: fileRouter,
  chat: chatRouter,
  analysis: analysisRouter,
  usage: usageRouter,
  plugin: pluginRouter,
  preferences: preferencesRouter,
  wallpaper: wallpaperRouter,
  news: newsRouter,
  rankings: rankingsRouter,
  dailyReport: dailyReportRouter,
  bilibili: bilibiliRouter,
  aiKeys: aiKeysRouter,
  cleanup: cleanupRouter,
});

export type AppRouter = typeof appRouter;