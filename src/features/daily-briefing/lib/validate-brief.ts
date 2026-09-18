/**
 * AI 早报 — Brief 业务规则校验器（Batch 2 完整实现）
 *
 * 8 类规则来源：参考 `D:\1Money\AI新闻\ai-news-kit\docs\02-每日作业手册.md` Step 5b
 *
 * 错误级别：
 * - error：必须修复，否则不发日报（如"标 A 但只有 1 个源"）
 * - warning：建议修复，不阻断（如"why <40 字"）
 *
 * 调用方：generate.ts 在 LLM 输出解析后、写入 DB 前调用
 */

import type { Brief } from './brief-schema';
import { computeIndependentSources, hasPrimaryOfficial } from './source-tiers';

/** 校验结果的严重级别 */
export type ValidationSeverity = 'error' | 'warning';

/** 单条校验结果 */
export interface ValidationIssue {
  severity: ValidationSeverity;
  /** 涉及的字段路径（如 "picks[0].lv" 或 "picks[2].sources[0]"） */
  path: string;
  /** 规则编号（对应 ai-news-kit docs/02 Step 5b） */
  rule: string;
  /** 人类可读消息 */
  message: string;
}

/** 校验结果汇总 */
export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 计算 pick 的独立信源数（基于白名单 + sources 字段）
 */
function getPickIndependentCount(pick: Brief['picks'][number]): number {
  const sourceNames = pick.sources.map(s => s.name);
  return computeIndependentSources(sourceNames);
}

function getPickHasPrimary(pick: Brief['picks'][number]): boolean {
  return hasPrimaryOfficial(pick.sources.map(s => s.name));
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 校验 Brief 的业务规则
 *
 * 错误（error）：
 * 1. 标 A 但独立信源 <3
 * 2. 标 A 但无一手来源
 * 3. 标 B/C/D 但所有来源都是转载（tier 3）
 * 4. `publishedAt` 晚于日报日期
 *
 * 警告（warning）：
 * 5. `why` <40 字
 * 6. `sources[0]` 未标注一手来源（应该排第一）
 * 7. `conflicts` 为空且标 B/C/D
 * 8. 本期无 C/D 级条目（防评级被系统性放宽）
 */
export function validateBrief(brief: Brief): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 顶级：日期合理性
  const briefDate = brief.date;
  for (const pick of brief.picks) {
    if (pick.publishedAt > briefDate) {
      issues.push({
        severity: 'error',
        path: `picks[${pick.no - 1}].publishedAt`,
        rule: 'R-04',
        message: `publishedAt (${pick.publishedAt}) 晚于日报日期 (${briefDate})`,
      });
    }
  }

  // 单条 pick 校验
  for (const pick of brief.picks) {
    const path = `picks[${pick.no - 1}]`;
    const sourceNames = pick.sources.map(s => s.name);
    const indepCount = getPickIndependentCount(pick);
    const hasPrimary = getPickHasPrimary(pick);

    // R-01: 标 A 但独立信源 <3 → error
    if (pick.lv === 'A' && indepCount < 3) {
      issues.push({
        severity: 'error',
        path: `${path}.lv`,
        rule: 'R-01',
        message: `标 A 但独立信源数 = ${indepCount}（要求 ≥3）`,
      });
    }

    // R-02: 标 A 但无一手来源 → error
    if (pick.lv === 'A' && !hasPrimary) {
      issues.push({
        severity: 'error',
        path: `${path}.lv`,
        rule: 'R-02',
        message: `标 A 但 sources 中无一手官方材料（tier 1）`,
      });
    }

    // R-03: 标 B/C/D 但所有来源都是 tier 3（转载）→ error
    if (pick.lv !== 'A' && indepCount === 0 && sourceNames.length > 0) {
      issues.push({
        severity: 'error',
        path: `${path}.lv`,
        rule: 'R-03',
        message: `标 ${pick.lv} 但所有来源都是聚合/转载（tier 3），按规则应给 D`,
      });
    }

    // R-05: why <40 字 → warning
    if (pick.why.length < 40) {
      issues.push({
        severity: 'warning',
        path: `${path}.why`,
        rule: 'R-05',
        message: `why 只有 ${pick.why.length} 字符（最少 40 字），未回答"所以呢"`,
      });
    }

    // R-06: sources[0] 未标注一手来源 → warning
    if (pick.sources.length > 0 && !pick.sources[0].isPrimary) {
      const hasAnyPrimary = pick.sources.some(s => s.isPrimary);
      if (hasAnyPrimary) {
        issues.push({
          severity: 'warning',
          path: `${path}.sources[0]`,
          rule: 'R-06',
          message: `一手来源未排第一（ai-news-kit 纪律）`,
        });
      }
    }

    // R-07: conflicts 为空且标 B/C/D → warning
    if (pick.lv !== 'A' && (!pick.conflicts || pick.conflicts === '无实质冲突')) {
      // 例外：C 级单源时 "无实质冲突" 是合理的
      if (!(pick.lv === 'C' && indepCount === 1)) {
        issues.push({
          severity: 'warning',
          path: `${path}.conflicts`,
          rule: 'R-07',
          message: `${pick.lv} 级建议写明各源差异（即便"无"也建议显式说明）`,
        });
      }
    }
  }

  // R-08: 本期无 C/D 级条目 → warning（防评级被系统性放宽）
  const hasCD = brief.picks.some(p => p.lv === 'C' || p.lv === 'D');
  if (!hasCD && brief.picks.length >= 3) {
    issues.push({
      severity: 'warning',
      path: 'picks',
      rule: 'R-08',
      message: `本期 ${brief.picks.length} 条全为 A/B，无 C/D 级——可能评级被系统性放宽`,
    });
  }

  // 汇总
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  return {
    ok: errorCount === 0,
    issues,
    errorCount,
    warningCount,
  };
}
