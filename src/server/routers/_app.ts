// 来源：d:\1Money\design\API设计.md §二 tRPC root
// 当前阶段挂的 routers：project / chat / analysis / usage / plugin / preferences

import { router } from '../context';
import { projectRouter } from './project';
import { chatRouter } from './chat';
import { analysisRouter } from './analysis';
import { usageRouter } from './usage';
import { pluginRouter } from './plugin';
import { preferencesRouter } from './preferences';

export const appRouter = router({
  project: projectRouter,
  chat: chatRouter,
  analysis: analysisRouter,
  usage: usageRouter,
  plugin: pluginRouter,
  preferences: preferencesRouter,
});

export type AppRouter = typeof appRouter;