'use client';

/**
 * AnalysisReportModal v2 - 代码审查报告弹窗
 *
 * 结构
 *   - Header：标题 + 下载 + 关闭
 *   - Hero：总分滚动动画 + 等级 + 问题数 + 分类数
 *   - Body：左侧 8 大分类列表 / 右侧问题详情（含 evidence / violation / suggestion）
 *   - Footer：模型 + Tokens
 *
 * Props
 *   breakdown  来自 analysis.byId 查询（undefined 时回退 Score.breakdown），含 categories 数组
 *   analysis   来自 analysis.run 查询（undefined 时为模拟结果），含 score / issueCount / isMock / usage
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { IconX, IconDownload, IconAlertTriangle, IconAlertHexagon, IconCircleCheck, IconCircleDot, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { DEFAULT_CATEGORIES, severityCount, type CategoryKey, type Problem } from '@/lib/analysis/categories';

interface CategoryBreakdown {
  key: CategoryKey;
  name: string;
  score: number;
  weight: number;
  problems: Array<Problem & { category?: string }>;
}

/** 检查文件清单（2026-09-09 新增，回答"检查了哪些地方"） */
interface ManifestEntry {
  path: string;
  sizeBytes: number;
  language: string | null;
}

interface Manifest {
  fileCount: number;
  totalBytes: number;
  files: ManifestEntry[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface Breakdown {
  summary: string;
  issueCount: number;
  categories: CategoryBreakdown[];
  /** 2026-09-09 新增：true = AI 输出解析失败（不是 0 问题） */
  parseFailed?: boolean;
  parseFailureReason?: string | null;
  /** 2026-09-09 新增：检查清单 */
  manifest?: Manifest;
}

interface AnalysisResult {
  score: number;
  issueCount: number;
  model: string;
  usage: { inputTokens: number; outputTokens: number; cost: number };
  isMock?: boolean;
}

interface Props {
  analysis: AnalysisResult;
  breakdown: Breakdown;
  projectName: string;
  onClose: () => void;
}

const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
type Sev = (typeof SEV_ORDER)[number];

const SEV_LABELS: Record<Sev, string> = {
  CRITICAL: '严重',
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

const SEV_BADGE: Record<Sev, string> = {
  CRITICAL: 'bg-destructive text-destructive-foreground',
  HIGH: 'bg-destructive/80 text-white',
  MEDIUM: 'bg-warning/80 text-white',
  LOW: 'bg-muted text-muted-foreground',
};

const SEV_TEXT: Record<Sev, string> = {
  CRITICAL: 'text-destructive',
  HIGH: 'text-destructive',
  MEDIUM: 'text-warning',
  LOW: 'text-muted-foreground',
};

const SEV_BORDER: Record<Sev, string> = {
  CRITICAL: 'border-destructive bg-destructive/5',
  HIGH: 'border-destructive/50 bg-destructive/5',
  MEDIUM: 'border-warning/50 bg-warning/5',
  LOW: 'border-muted-foreground/30 bg-muted/30',
};

function scoreGrade(score: number) {
  if (score >= 80) return { label: '良好', color: 'text-success', icon: IconCircleCheck };
  if (score >= 60) return { label: '及格', color: 'text-warning', icon: IconCircleDot };
  return { label: '需改进', color: 'text-destructive', icon: IconAlertHexagon };
}

/** 数字滚动动画 Hook（ease-out cubic）*/
function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    startRef.current = 0;
    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const progress = Math.min((ts - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

/** 构建 Markdown 下载内容，包含全部问题及 evidence / violation / suggestion。*/
function buildMarkdown(projectName: string, analysis: AnalysisResult, breakdown: Breakdown): string {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const grade = scoreGrade(analysis.score);

  // 取得分最差的 3 个分类
  const worst = [...breakdown.categories].sort((a, b) => a.score - b.score).slice(0, 3);

  let md = `# 代码审查报告\n\n`;
  md += `**项目**：${projectName}\n`;
  md += `**时间**：${now}\n`;
  md += `**模型**：${analysis.usage.inputTokens > 0 ? analysis.model : '（未调用）'}\n`;
  if (analysis.isMock) md += `**dev-mock** 模式：AI 未真实调用，以下为本地模拟数据\n`;
  md += `\n`;

  // 2026-09-09 新增：解析失败警告（放在最显眼位置）
  if (breakdown.parseFailed) {
    md += `> ⚠️ **AI 输出解析失败**（${breakdown.parseFailureReason ?? '未知原因'}）\n`;
    md += `> 本报告未生成有效的 8 类分组与问题列表。请在项目页「分析记录」中点击「重新跑一次」或更换 AI 模型。\n\n`;
  }

  md += `## 总览\n\n`;
  md += `| 总分 | 等级 | 问题数 |\n|---|---|---|\n`;
  md += `| **${analysis.score}** / 100 | ${grade.label} | ${analysis.issueCount} 个 |\n\n`;
  md += `### Tokens 用量\n\n- 输入：${analysis.usage.inputTokens} tokens\n- 输出：${analysis.usage.outputTokens} tokens\n- 总成本：$${analysis.usage.cost.toFixed(4)}\n\n`;

  // 2026-09-09 新增：检查清单（回答"检查了哪些地方"）
  if (breakdown.manifest && breakdown.manifest.fileCount > 0) {
    const m = breakdown.manifest;
    md += `## 检查清单\n\n`;
    md += `本次审查基于 **${m.fileCount} 个文件**，总 **${(m.totalBytes / 1024).toFixed(1)} KB**，使用模型 \`${m.model}\`。\n\n`;
    md += `| # | 文件路径 | 大小 | 语言 |\n|---|---|---|---|\n`;
    m.files.forEach((f, i) => {
      md += `| ${i + 1} | \`${f.path}\` | ${(f.sizeBytes / 1024).toFixed(1)} KB | ${f.language ?? '—'} |\n`;
    });
    md += `\n`;
  }

  // 8 大类得分表格
  md += `## 分类得分\n\n`;
  md += `| 分类 | 得分 | 权重 | 问题数量 |\n|---|---|---|---|\n`;
  for (const c of breakdown.categories) {
    md += `| ${c.name} | ${c.score} | ${(c.weight * 100).toFixed(0)}% | ${c.problems.length} |\n`;
  }
  md += `\n`;

  if (breakdown.summary) {
    md += `## 总结\n\n${breakdown.summary}\n\n`;
  }

  md += `## 最需优先修复\n\n`;
  md += worst.map((c, i) => `${i + 1}. **${c.name}**：${c.score} 分，${c.problems.length} 个问题`).join('\n');
  md += `\n\n`;

  // 逐类输出问题明细
  md += `## 各分类问题明细\n\n`;
  for (const c of breakdown.categories) {
    if (c.problems.length === 0) {
      md += `### ✓ ${c.name}（${c.score} 分）\n\n未发现问题\n\n`;
      continue;
    }
    md += `### ${c.name}（${c.score} 分，${c.problems.length} 个问题）\n\n`;
    md += `> ${DEFAULT_CATEGORIES.find((d) => d.key === c.key)?.description ?? ''}\n\n`;
    const sorted = [...c.problems].sort((a, b) => {
      const ia = SEV_ORDER.indexOf(a.severity as Sev);
      const ib = SEV_ORDER.indexOf(b.severity as Sev);
      return ia - ib;
    });
    for (const p of sorted) {
      md += `#### [${SEV_LABELS[p.severity as Sev] ?? p.severity}] ${p.message}\n\n`;
      if (p.evidence) md += `- **证据**：\`${p.evidence}\`\n`;
      if (p.violation) md += `- **违反规则**：\`${p.violation}\`\n`;
      if (p.filePath) {
        md += `- **位置**：\`${p.filePath}\``;
        if (typeof p.startLine === 'number') {
          md += ` L${p.startLine}`;
          if (typeof p.endLine === 'number' && p.endLine !== p.startLine) md += `-${p.endLine}`;
        }
        md += '\n';
      }
      if (p.suggestion) md += `- **建议**：\`${p.suggestion}\`\n`;
      md += '\n';
    }
  }

  md += `---\n*由 AIHub 代码审查系统生成 · v2 报告模板*\n`;
  return md;
}

export function AnalysisReportModal({ analysis, breakdown, projectName, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [activeKey, setActiveKey] = useState<CategoryKey>(
    breakdown.categories.reduce((worst, c) => (c.score < worst.score ? c : worst), breakdown.categories[0]).key,
  );
  const [expandedProblems, setExpandedProblems] = useState<Set<number>>(new Set());
  const animatedScore = useCountUp(analysis.score);
  const grade = scoreGrade(animatedScore);
  const GradeIcon = grade.icon;

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleDownload = () => {
    const md = buildMarkdown(projectName, analysis, breakdown);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `代码审查报告-${projectName}-${ts}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeCategory = useMemo(
    () => breakdown.categories.find((c) => c.key === activeKey) ?? breakdown.categories[0],
    [breakdown.categories, activeKey],
  );

  const toggleProblem = (idx: number) => {
    setExpandedProblems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const sortedProblems = useMemo(() => {
    return [...activeCategory.problems].sort((a, b) => {
      const ia = SEV_ORDER.indexOf(a.severity as Sev);
      const ib = SEV_ORDER.indexOf(b.severity as Sev);
      return ia - ib;
    });
  }, [activeCategory.problems]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="代码审查报告"
    >
      <div className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />

      <div
        className={`relative z-10 flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl transition-all duration-300 ${
          visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b bg-background/95 px-6 py-4 backdrop-blur-sm">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <GradeIcon size={20} className={grade.color} />
              代码审查报告
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{projectName} · 8 大类模型</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              title="下载 Markdown 报告"
            >
              <IconDownload size={14} />
              下载报告
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="关闭"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Hero score */}
        <div className={`shrink-0 border-b px-6 py-5 ${analysis.isMock ? 'bg-warning/5' : ''}`}>
          <div className="flex items-center justify-center gap-8">
            <div className="text-center">
              <div className={`text-6xl font-bold tracking-tight ${SEV_TEXT[analysis.score >= 80 ? 'LOW' : analysis.score >= 60 ? 'MEDIUM' : 'CRITICAL']}`}>
                {animatedScore}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">/ 100 总分</div>
            </div>
            <div className="h-14 w-px bg-border" />
            <div className="text-center">
              <div className={`text-2xl font-semibold ${grade.color}`}>{grade.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">等级</div>
            </div>
            <div className="h-14 w-px bg-border" />
            <div className="text-center">
              <div className="text-2xl font-semibold">{analysis.issueCount}</div>
              <div className="mt-1 text-xs text-muted-foreground">问题数</div>
            </div>
            <div className="h-14 w-px bg-border" />
            <div className="text-center">
              <div className="text-2xl font-semibold">{breakdown.categories.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">分类数</div>
            </div>
          </div>

          {analysis.isMock && (
            <div className="mt-4 flex items-center gap-2 rounded-md bg-warning/15 px-3 py-2 text-xs text-warning">
              <IconAlertTriangle size={13} />
              dev-mock 模式：AI 未真实调用，当前展示为本地模拟数据，仅供参考
            </div>
          )}

          {/* 2026-09-09 新增：解析失败警告（红色横幅，最显眼位置） */}
          {breakdown.parseFailed && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <IconAlertHexagon size={13} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">AI 输出解析失败，未生成有效报告</p>
                <p className="mt-0.5 text-destructive/80">
                  原因：{breakdown.parseFailureReason ?? '未知'}。
                  请在项目页「分析记录」中点击「重新跑一次」或更换 AI 模型（如换用 deepseek-chat 替代推理模型）。
                </p>
              </div>
            </div>
          )}

          {/* 2026-09-09 新增：检查清单（回答"检查了哪些地方"） */}
          {breakdown.manifest && breakdown.manifest.fileCount > 0 && (
            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                检查了哪些文件？（{breakdown.manifest.fileCount} 个，{(breakdown.manifest.totalBytes / 1024).toFixed(1)} KB）
              </summary>
              <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto rounded-md border bg-muted/20 p-2 text-[11px] font-mono">
                {breakdown.manifest.files.map((f) => (
                  <li key={f.path} className="flex items-center justify-between gap-2">
                    <span className="truncate">{f.path}</span>
                    <span className="shrink-0 text-muted-foreground">{(f.sizeBytes / 1024).toFixed(1)} KB</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* Body 主体区域 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧 分类列表 */}
          <div className="w-64 shrink-0 overflow-y-auto border-r bg-muted/20 p-3">
            <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">8 大分类</div>
            <div className="space-y-1">
              {breakdown.categories.map((c) => {
                const isActive = c.key === activeKey;
                const counts = severityCount(c.problems as Problem[]);
                const totalProblems = c.problems.length;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setActiveKey(c.key)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background hover:bg-accent/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${isActive ? 'text-primary' : ''}`}>
                        {c.name}
                      </span>
                      <span className={`text-lg font-bold ${SEV_TEXT[c.score >= 80 ? 'LOW' : c.score >= 60 ? 'MEDIUM' : 'CRITICAL']}`}>
                        {c.score}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>权重 {(c.weight * 100).toFixed(0)}%</span>
                      {totalProblems > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono">
                            {counts.CRITICAL > 0 && <span className="text-destructive">{counts.CRITICAL} 个 </span>}
                            {counts.HIGH > 0 && <span className="text-destructive">{counts.HIGH} 个 </span>}
                            {counts.MEDIUM > 0 && <span className="text-warning">{counts.MEDIUM} 个 </span>}
                            {counts.LOW > 0 && <span>{counts.LOW} 个</span>}
                          </span>
                        </>
                      )}
                      {totalProblems === 0 && <span className="text-success">✓ 无问题</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右侧 问题详情 */}
          <div className="flex-1 overflow-y-auto">
            <div className="border-b px-6 py-4">
              <div className="flex items-baseline gap-3">
                <h3 className="text-lg font-semibold">{activeCategory.name}</h3>
                <span className={`text-2xl font-bold ${SEV_TEXT[activeCategory.score >= 80 ? 'LOW' : activeCategory.score >= 60 ? 'MEDIUM' : 'CRITICAL']}`}>
                  {activeCategory.score} 分
                </span>
                <span className="text-xs text-muted-foreground">
                  · 权重 {(activeCategory.weight * 100).toFixed(0)}% · {activeCategory.problems.length} 个问题
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {DEFAULT_CATEGORIES.find((d) => d.key === activeCategory.key)?.description}
              </p>
            </div>

            <div className="px-6 py-5">
              {sortedProblems.length === 0 ? (
                <div className="rounded-md border border-success/30 bg-success/5 p-6 text-center text-sm text-success">
                  <IconCircleCheck size={32} className="mx-auto mb-2" />
                  该分类未发现问题，表现良好
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedProblems.map((p, idx) => {
                    const isExpanded = expandedProblems.has(idx);
                    return (
                      <div key={idx} className={`rounded-lg border p-4 ${SEV_BORDER[p.severity as Sev] ?? 'border-border'}`}>
                        <div className="flex items-start gap-3">
                          <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${SEV_BADGE[p.severity as Sev] ?? ''}`}>
                            {SEV_LABELS[p.severity as Sev] ?? p.severity}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-relaxed">{p.message}</p>

                            {(p.violation || p.filePath || p.evidence) && (
                              <button
                                type="button"
                                onClick={() => toggleProblem(idx)}
                                className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                {isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                                {isExpanded ? '收起详情' : '展开详情'}
                              </button>
                            )}

                            {isExpanded && (
                              <div className="mt-3 space-y-2 border-t border-border/50 pt-3 text-xs">
                                {p.violation && (
                                  <div>
                                    <span className="font-medium text-foreground">违反规则：</span>
                                    <span className="text-muted-foreground">{p.violation}</span>
                                  </div>
                                )}
                                {p.evidence && (
                                  <div>
                                    <span className="font-medium text-foreground">证据：</span>
                                    <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                      {p.evidence}
                                    </code>
                                  </div>
                                )}
                                {p.filePath && (
                                  <div>
                                    <span className="font-medium text-foreground">位置：</span>
                                    <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                      {p.filePath}
                                      {typeof p.startLine === 'number' && `:${p.startLine}`}
                                      {typeof p.endLine === 'number' && p.endLine !== p.startLine && `-${p.endLine}`}
                                    </code>
                                  </div>
                                )}
                                {p.suggestion && (
                                  <div className="rounded-md bg-primary/5 p-2">
                                    <span className="font-medium text-foreground">修复建议：</span>
                                    <p className="mt-1 text-muted-foreground">{p.suggestion}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 总结 */}
            {breakdown.summary && (
              <div className="border-t bg-muted/20 px-6 py-4">
                <h4 className="mb-2 text-sm font-medium">整体总结</h4>
                <p className="text-sm leading-relaxed text-muted-foreground">{breakdown.summary}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t bg-muted/20 px-6 py-2.5 text-xs text-muted-foreground">
          <span>模型：{analysis.model}</span>
          <span>
            {analysis.usage.inputTokens} in / {analysis.usage.outputTokens} out ·{' '}
            {analysis.usage.cost > 0 ? `$${analysis.usage.cost.toFixed(4)}` : 'mock 数据（未计费）'}
          </span>
        </div>
      </div>
    </div>
  );
}
