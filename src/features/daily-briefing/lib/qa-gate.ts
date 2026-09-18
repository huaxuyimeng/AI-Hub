/**
 * AI 早报生成 — QA 守门员（C1）
 *
 * 职责：
 *   - 跑在 LLM 输出 → DB 持久化 → PPT 渲染 之间的"质量门"
 *   - 不阻止生成；只记录 lint 报告，error 超阈值时把 degraded 升级 + 写 error 字段
 *   - 让"PPT 跑出来了但很丑"变得可观测、可拦截
 *
 * 设计原则：
 *   - 新引擎（slide-engine）才是 lint 的事实来源；旧 build-pptx.ts 路径无法直接 lint 几何
 *     所以这里用"新引擎跑一遍 layout + lint"作为守门（仅做 lint，渲染仍走旧路径）
 *   - 永远不抛错——门倒下也只是 degraded=true，不会阻断用户
 *
 * 调用入口：
 *   - generate.ts 写库前（ensureLayoutQuality）
 *   - build-pptx.ts 渲染前（optional，不阻断）
 */

import type { DailyReportContent } from './types';
import { registerBriefingPageTypes } from '@/lib/slide-engine/templates/briefing/slides';
import { paperTheme } from '@/lib/slide-engine/templates/briefing/theme';
import {
  planBriefingDeck,
  planBriefingToPlacedSlides,
} from '@/lib/slide-engine/templates/briefing/plan';
import { lintDeck } from '@/lib/slide-engine/qa/lint';
import type { LintIssue, LintReport } from '@/lib/slide-engine/contracts/lint';
import { logger } from '@/lib/observability/logger';

export type LayoutQAReport = {
  /** lint 跑通了（0 error） */
  passed: boolean;
  /** 全部 issue 列表（error + warn） */
  issues: LintIssue[];
  /** 总页数（lint 跑出来的） */
  pageCount: number;
  /** 跑 lint 用了多少毫秒 */
  durationMs: number;
};

/**
 * 同步执行 lint 守门。
 * - 不会抛错；失败也返回 report（passed=false）
 * - 静默：warn 不写入 error 字段；只有 error 才计入
 */
export function runLayoutQA(content: DailyReportContent): LayoutQAReport {
  const t0 = Date.now();
  try {
    registerBriefingPageTypes();
    const entries = planBriefingDeck(content);
    const placed = planBriefingToPlacedSlides(entries, paperTheme);
    const report = lintDeck(placed, paperTheme);

    const errorCount = report.issues.filter((i) => i.level === 'error').length;
    const warnCount = report.issues.filter((i) => i.level === 'warn').length;
    const durationMs = Date.now() - t0;

    logger.debug('[briefing/qa-gate] lint completed', {
      date: content.date,
      pages: placed.length,
      errors: errorCount,
      warns: warnCount,
      durationMs,
    });

    return {
      passed: report.passed,
      issues: report.issues,
      pageCount: placed.length,
      durationMs,
    };
  } catch (err) {
    // 守门员自己挂了不算用户的锅：返回 passed=false + 单条 fatal issue
    logger.error('[briefing/qa-gate] lint crashed', {
      date: content.date,
      error: (err as Error).message,
    });
    return {
      passed: false,
      issues: [
        {
          rule: 'L1',
          pageNo: 0,
          level: 'error',
          detail: `QA 守门员自身失败：${(err as Error).message}`,
        },
      ],
      pageCount: 0,
      durationMs: Date.now() - t0,
    };
  }
}

/**
 * 守门员给上游生成器的"升级 degraded"判定。
 * 规则：
 *   - error > 0   → 返回 reason（写 error 字段，但不阻断生成）
 *   - pass 但 warn > 3 → 返回 reason（轻度告警）
 *   - 其他 → 返回 null（不升级 degraded）
 *
 * 注意：这里**不**直接调用 schema 重校验（那是 C2 的事）。
 */
export function upgradeDegradedReason(qa: LayoutQAReport): string | null {
  const errors = qa.issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    const sample = errors.slice(0, 3).map((e) => `[${e.rule}]P${e.pageNo}:${e.detail}`).join('；');
    return `布局 lint ${errors.length} 条 error：${sample}${errors.length > 3 ? '…' : ''}`;
  }

  const warns = qa.issues.filter((i) => i.level === 'warn');
  if (warns.length > 3) {
    return `布局 lint ${warns.length} 条 warn（密度/同型连续等）`;
  }

  return null;
}
