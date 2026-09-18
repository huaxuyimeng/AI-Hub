/**
 * QA Gate（M5）
 * 管线末端：lint → 降级重排 → 报告
 * 确保每次生成都通过 L1-L6 布局检查
 */

import type { ThemeTokens } from '../contracts/theme';
import type { PlacedSlide } from '../contracts/geometry';
import type { LintReport } from '../contracts/lint';
import { lintDeck } from './lint';

export type { LintReport } from '../contracts/lint';

export type QAGateOptions = {
  /** 最大降级重排轮数，默认 2 */
  maxRetries?: number;
  /** 是否在所有 error 解决后才算通过 */
  strict?: boolean;
};

const DEFAULTS: Required<QAGateOptions> = {
  maxRetries: 2,
  strict: true,
};

/**
 * QA Gate 主函数
 * 输入：PlacedSlide[] + ThemeTokens
 * 输出：LintReport + 是否通过
 *
 * 流程：
 * 1. lintDeck 检查所有错误
 * 2. 如果没有 error，直接返回 passed=true
 * 3. 如果有 error 且 maxRetries > 0，触发降级回调
 * 4. 降级后重新检查，最多 maxRetries 轮
 * 5. 最终报告返回
 */
export function runQAGate(
  slides: PlacedSlide[],
  theme: ThemeTokens,
  options: QAGateOptions = {},
  onDegrade?: (slides: PlacedSlide[], errorCount: number) => PlacedSlide[],
): LintReport {
  const opts = { ...DEFAULTS, ...options };

  let currentSlides = slides;
  // 兜底初始化：lintDeck 首次调用作为基线
  let report: LintReport = lintDeck(currentSlides, theme);

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    report = lintDeck(currentSlides, theme);

    // 如果没有 error，或者不是 strict 模式，直接通过
    if (report.passed || !opts.strict) {
      return report;
    }

    // 有 error，尝试降级
    if (attempt < opts.maxRetries && onDegrade) {
      const errorCount = report.issues.filter(i => i.level === 'error').length;
      currentSlides = onDegrade(currentSlides, errorCount);
      if (currentSlides === slides) {
        // 降级函数没有修改，返回原报告
        break;
      }
    } else {
      // 达到最大重试次数或没有降级回调
      break;
    }
  }

  // 兜底：循环结束时用最后状态返回
  return report;
}

/**
 * 简化版 QA Gate：不自动降级，只返回 lint 报告
 */
export function checkQA(slides: PlacedSlide[], theme: ThemeTokens): LintReport {
  return lintDeck(slides, theme);
}

/**
 * 检查单页
 */
export function checkSlide(
  slide: PlacedSlide,
  theme: ThemeTokens,
): LintReport {
  const issues = lintDeck([slide], theme);
  return {
    ...issues,
    passed: issues.passed,
  };
}

/**
 * 判断 QA 是否通过
 */
export function isQAPassed(report: LintReport): boolean {
  return report.passed;
}

/**
 * 获取 error 级别问题数量
 */
export function getErrorCount(report: LintReport): number {
  return report.issues.filter(i => i.level === 'error').length;
}

/**
 * 获取 warn 级别问题数量
 */
export function getWarnCount(report: LintReport): number {
  return report.issues.filter(i => i.level === 'warn').length;
}

/**
 * 格式化 QA 报告为可读字符串
 */
export function formatQAReport(report: LintReport): string {
  const lines: string[] = [];

  lines.push(`QA Gate Report: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);

  const errors = report.issues.filter(i => i.level === 'error');
  const warns = report.issues.filter(i => i.level === 'warn');

  if (errors.length > 0) {
    lines.push(`\n❌ ${errors.length} Error(s):`);
    errors.forEach(issue => {
      lines.push(`  [${issue.rule}] Page ${issue.pageNo}: ${issue.detail}`);
      if (issue.boxId) {
        lines.push(`    Box: ${issue.boxId} (slot: ${issue.boxId})`);
      }
    });
  }

  if (warns.length > 0) {
    lines.push(`\n⚠️  ${warns.length} Warning(s):`);
    warns.forEach(issue => {
      lines.push(`  [${issue.rule}] Page ${issue.pageNo}: ${issue.detail}`);
    });
  }

  return lines.join('\n');
}
