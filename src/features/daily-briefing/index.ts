/**
 * AI 早报功能 — 公开 API
 *
 * 推荐用法：
 *   import { BriefingToast, BriefingPanel } from '@/features/daily-briefing';
 *   import { dailyReportRouter } from '@/features/daily-briefing';
 *
 * 子模块直接路径：
 *   import type { DailyReportContent } from '@/features/daily-briefing/lib/types';
 *   import { generateDailyReport } from '@/features/daily-briefing/lib/generate';
 *   import { adaptV1ToV4 } from '@/features/daily-briefing/lib/adapters/v1-to-v4';
 */

// Components
export { BriefingToast } from './components/BriefingToast';
export { BriefingPanel } from './components/BriefingPanel';
export { SlidePreview } from './components/SlidePreview';

// Server (router + cron logic)
export { dailyReportRouter } from './server/router';
export { runDailyReportCron } from './server/cron';

// Lib — types
export type {
  DailyReportContent,
  Item,
  DirectionIndex,
  VerificationRow,
  VideoAuthor,
  Trend,
  HeroMetric,
  PrimaryLink,
  ConfidenceLevel,
  DirectionKey,
  BriefingTheme,
} from './lib/types';
export {
  DailyReportContentSchema,
  BRIEFING_THEMES,
  CONFIDENCE_META,
  DIRECTION_META,
  LIMITS,
  enforceLimits,
  truncate,
} from './lib/types';

// Lib — generation + collection
export { generateDailyReport } from './lib/generate';
export { collectDailyNews, beijingDateString } from './lib/collect';

// Lib — pptx
export { buildBriefingPptx, briefingFileName } from './lib/build-pptx';

// Lib — themes
export { BRIEFING_PALETTES, getPalette, css } from './lib/themes';
export type { BriefingPalette } from './lib/themes';

// Lib — adapters
export { adaptV1ToV4, isV1Content } from './lib/adapters/v1-to-v4';
