/**
 * PPTX 构建调度（双引擎切换点）
 * 路径：src/features/daily-briefing/lib/build-pptx-dispatch.ts
 *
 * 职责：这是全项目**唯一**应该被 router / cron 调用去拿 PPTX Buffer 的地方。
 * 调用方不再感知底下是旧引擎还是新引擎。
 *
 * 为什么需要单独一层：
 *   直接在 router 里写 if/else 会让"影子模式"（两套都跑再比对）无从落脚 ——
 *   影子模式不是分支，是"主路径 + 旁路观测"，必须有独立编排层。
 *
 * 数据流：
 *   legacy  → buildBriefingPptx()（旧引擎）
 *   shadow  → buildBriefingPptx() 作为产出 + renderBriefingPptxWithReport() 旁路观测（不污染产出）
 *   engine  → renderBriefingPptxWithReport()；失败且允许回落时降级到旧引擎
 */

import { logger } from '@/lib/observability/logger';
import { buildBriefingPptx } from './build-pptx';
import {
  renderBriefingPptxWithReport,
  LayoutValidationError,
  type RenderBriefingResult,
} from './render-pptx';
import { resolveTheme } from './theme-adapter';
import { getEngineConfig, describeMode, type PptxEngineMode } from './pptx-engine-config';
import type { DailyReportContent } from './types';

export type BuildPptxOutcome = {
  buffer: Buffer;
  /** 实际产出该 Buffer 的引擎 */
  producedBy: 'legacy' | 'engine';
  /** 生效的配置模式（可能与 producedBy 不同，如 shadow 模式下 producedBy 恒为 legacy） */
  mode: PptxEngineMode;
  /** 新引擎 lint 报告（legacy 模式下为 null） */
  engineReport: RenderBriefingResult | null;
  /** engine 模式下新引擎失败并回落旧引擎时，记录失败原因 */
  fallbackReason: string | null;
  durationMs: number;
};

// ============================================================================
// 影子比对
// ============================================================================

type ShadowDiff = {
  pageCountMatch: boolean;
  legacyCrashed: boolean;
  engineCrashed: boolean;
  engineErrorCount: number;
  engineWarnCount: number;
  engineBoxCount: number;
  legacyBytes: number;
  engineBytes: number;
  /** 新引擎 lint 未通过 —— 这是切流前最关键的观察指标 */
  engineLintFailed: boolean;
};

/**
 * 旁路跑新引擎，记录与旧引擎的结构差异。
 *
 * 原则：影子模式**绝不能影响产出**，也**绝不能影响请求成功与否**。
 * 所以整体 try/catch，失败只记日志。
 */
async function runShadowComparison(
  content: DailyReportContent,
  legacyBuffer: Buffer,
  themeId: string | null | undefined,
): Promise<void> {
  try {
    const engine = await renderBriefingPptxWithReport(content, {
      theme: resolveTheme(content, themeId),
      // 影子模式必须非严格：lint 有 error 也要把报告跑出来，这正是我们要观测的东西
      strict: false,
    });

    const engineErrors = engine.report.issues.filter((i) => i.level === 'error').length;
    const engineWarns = engine.report.issues.filter((i) => i.level === 'warn').length;

    const diff: ShadowDiff = {
      pageCountMatch: engine.pageCount > 0,
      legacyCrashed: false,
      engineCrashed: false,
      engineErrorCount: engineErrors,
      engineWarnCount: engineWarns,
      engineBoxCount: engine.boxCount,
      legacyBytes: legacyBuffer.length,
      engineBytes: engine.buffer.length,
      engineLintFailed: engineErrors > 0,
    };

    logger.info('[briefing/shadow] 双引擎比对', {
      date: content.date,
      ...diff,
    });

    if (engineErrors > 0) {
      logger.warn('[briefing/shadow] 新引擎 lint 未通过，暂不可切流', {
        date: content.date,
        errors: engineErrors,
        sample: engine.report.issues
          .filter((i) => i.level === 'error')
          .slice(0, 5)
          .map((i) => `${i.rule}/P${i.pageNo}/${i.boxId ?? '-'}:${i.detail}`),
      });
    }
  } catch (err) {
    // 影子观测失败不影响任何东西，只留痕
    logger.warn('[briefing/shadow] 新引擎旁路运行失败（不影响产出）', {
      date: content.date,
      error: (err as Error).message,
    });
  }
}

// ============================================================================
// 主调度
// ============================================================================

/**
 * 构建早报 PPTX。
 *
 * 这是全项目统一入口。行为由 BRIEFING_PPTX_ENGINE 决定，见 pptx-engine-config.ts。
 *
 * @param content 早报内容（v4 schema）
 * @param themeId DB 里的主题标识（可选）
 *
 * @throws 仅当最权威的引擎也失败时抛出（legacy 模式=旧引擎失败；engine 模式=新引擎失败且不允许回落）
 */
export async function buildBriefingPptxAuto(
  content: DailyReportContent,
  themeId?: string | null,
): Promise<BuildPptxOutcome> {
  const cfg = getEngineConfig();
  const t0 = Date.now();

  // ---- legacy：完全保持原行为 ----
  if (cfg.mode === 'legacy') {
    const buffer = await buildBriefingPptx(content);
    return {
      buffer,
      producedBy: 'legacy',
      mode: cfg.mode,
      engineReport: null,
      fallbackReason: null,
      durationMs: Date.now() - t0,
    };
  }

  // ---- shadow：旧引擎产出，新引擎旁路 ----
  if (cfg.mode === 'shadow') {
    const buffer = await buildBriefingPptx(content);
    await runShadowComparison(content, buffer, themeId);
    return {
      buffer,
      producedBy: 'legacy',
      mode: cfg.mode,
      engineReport: null,
      fallbackReason: null,
      durationMs: Date.now() - t0,
    };
  }

  // ---- engine：新引擎唯一权威 ----
  try {
    const engine = await renderBriefingPptxWithReport(content, {
      theme: resolveTheme(content, themeId),
      strict: true, // 有 error 就拒绝产出被砍断的 PPT
    });

    logger.info('[briefing/dispatch] 新引擎产出成功', {
      date: content.date,
      mode: describeMode(cfg.mode),
      pages: engine.pageCount,
      bytes: engine.buffer.length,
      durationMs: engine.durationMs,
    });

    return {
      buffer: engine.buffer,
      producedBy: 'engine',
      mode: cfg.mode,
      engineReport: engine,
      fallbackReason: null,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const reason =
      err instanceof LayoutValidationError
        ? err.message
        : `新引擎渲染异常：${(err as Error).message}`;

    if (!cfg.allowLegacyFallback) {
      logger.error('[briefing/dispatch] 新引擎失败且不允许回落，请求失败', {
        date: content.date,
        reason,
      });
      throw err;
    }

    logger.error('[briefing/dispatch] 新引擎失败，回落旧引擎', {
      date: content.date,
      reason,
    });

    const buffer = await buildBriefingPptx(content);
    return {
      buffer,
      producedBy: 'legacy',
      mode: cfg.mode,
      engineReport: null,
      fallbackReason: reason,
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * 仅跑新引擎的 lint（不渲染）。
 * 用于：生成阶段的 QA 守门、管理端预览诊断。
 */
export async function lintBriefingContent(
  content: DailyReportContent,
  themeId?: string | null,
): Promise<RenderBriefingResult['report']> {
  const { report } = await renderBriefingPptxWithReport(content, {
    theme: resolveTheme(content, themeId),
    strict: false,
    skipRender: true, // lint 只要几何 + 报告，不必真的渲染 PPTX
  });
  return report;
}
