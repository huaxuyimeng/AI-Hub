'use client';

/**
 * AI 早报 — 管理面板
 * 今日早报状态 + 16:9 预览 + 6 主题切换 + 下载/删除/重新生成 + 历史列表
 */

import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SlidePreview } from './SlidePreview';
import { BRIEFING_PALETTES, css } from '@/features/daily-briefing/lib/themes';
import { BRIEFING_THEMES } from '@/lib/slide-engine/templates/briefing/theme';
import { registerBriefingPageTypes } from '@/lib/slide-engine/templates/briefing/slides';
import { planBriefingDeck } from '@/lib/slide-engine/templates/briefing/plan';
import { BRIEFING_PHASES, BRIEFING_PHASE_LABELS } from '@/features/daily-briefing/lib/types';
import type { BriefingTheme, DailyReportContent } from '@/features/daily-briefing/lib/types';
import { cleanText } from '@/lib/news/parsers/types';
import type { LintIssue } from '@/lib/slide-engine/contracts/lint';

function formatRelativeDate(dateStr: string): string {
  const today = new Date(Date.now() + 8 * 3600 * 1000);
  const d = new Date(dateStr);
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return `${diff} 天前`;
  return dateStr;
}

function base64ToBlob(base64: string, mime: string): Blob {
  // B-05 修复：原代码 atob(base64) 无保护，非法 base64 会抛 InvalidCharacterError 直接崩页面
  // （详见 2026-09-09 全量 Bug 排查）。改为降级为空 Blob + console.error，
  // 由调用方（handleDownload）通过 try/catch + toast 提示用户。
  let bin: string;
  try {
    bin = atob(base64);
  } catch {
    console.warn('[BriefingPanel] base64 解码失败，已跳过附件预览');
    return new Blob([], { type: mime });
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * O5 闭环：把 error 字段（"布局 lint 3 条 error：[L1]P2:...; ..."）解析为结构化数组
 * 这样 UI 可以用 list / count / severity 来展示，而不是一坨字符串
 */
export interface QaIssueSummary {
  /** L1=页内溢出 / L2=页间重叠 / L3=内容密度 / ... */
  rule: string;
  pageNo: number;
  detail: string;
}

export interface QaErrorSummary {
  kind: 'lint-errors' | 'lint-warns' | 'other';
  count: number;
  issues: QaIssueSummary[];
  raw: string;
}

export function parseQaError(error: string): QaErrorSummary {
  // 兼容中英文冒号 / 分号（避免英文 `error:` 和中文分号错切）
  const COLON = `[：:]`;   // 匹配 `：` 或 `:`
  const SEP = `[；;]`;     // 匹配 `；` 或 `;`
  // 形如："布局 lint 3 条 error：[L1]P2:封面页 caption 溢出 5px；[L2]P3:box 重叠 12px；..."
  const lintErrMatch = error.match(new RegExp(`布局 lint (\\d+) 条 error${COLON}(.+)$`));
  if (lintErrMatch) {
    const count = parseInt(lintErrMatch[1], 10);
    const part = lintErrMatch[2];
    // 切分 "；/;"，每段形如 "[L1]P2:封面页 caption 溢出 5px"
    // 进一步细分：每段内只按 `[Lx]P<num>:` 切，避免把 detail 里的中文分号误切
    const issues: QaIssueSummary[] = part
      .split(new RegExp(`\\s*${SEP}\\s*(?=\\[\\w+\\]P\\d+${COLON})`))
      .filter(Boolean)
      .map(seg => {
        const m = seg.match(new RegExp(`\\[(\\w+)\\]P(\\d+)${COLON}(.+)`));
        if (m) return { rule: m[1], pageNo: parseInt(m[2], 10), detail: m[3].trim() };
        return { rule: '?', pageNo: 0, detail: seg };
      });
    return { kind: 'lint-errors', count, issues, raw: error };
  }
  const lintWarnMatch = error.match(/布局 lint (\d+) 条 warn/);
  if (lintWarnMatch) {
    return { kind: 'lint-warns', count: parseInt(lintWarnMatch[1], 10), issues: [], raw: error };
  }
  return { kind: 'other', count: 0, issues: [], raw: error };
}

/** 将 DailyReportContent 转换为 Markdown 格式（v4：研究报告风格）
 * O4 闭环：附加 QA 报告块——让 Markdown 文件本身带有"这次生成质量如何"的元数据
 */
function generateMarkdownReport(
  content: import('@/features/daily-briefing/lib/types').DailyReportContent,
  meta?: { degraded?: boolean; error?: string | null; pptxBuiltAt?: Date | null },
): string {
  const lines: string[] = [
    `# AI 日报 · ${content.date}`,
    '',
    `> ${content.cover.subtitle || 'AI 新闻日报'}`,
    '',
    `> ${content.cover.emphasis}`,
    '',
    `**本期数据**：${content.cover.stats.map(s => `${s.value} ${s.label}`).join(' · ')}`,
    '',
    // O4 闭环：QA 元数据块——如果用户拿到 Markdown 没网也能看到「这次生成是否降级」
    ...(meta?.degraded
      ? [
          '',
          '> ⚠️ **生成质量提示**：本期为**降级版**——AI 文案生成失败，仅展示原始抓取摘要。',
          meta.error ? `> 失败原因：\`${meta.error.slice(0, 200)}\`` : '',
          '',
        ]
      : []),
    '---',
    '',
    '## 本期概览与置信度评级方法',
    '',
    content.overview.methodNote,
    '',
    '### TL;DR',
    '',
  ];
  content.overview.tlDr.forEach((line, i) => {
    lines.push(`${i + 1}. ${cleanText(line)}`);
  });
  lines.push('', '### 置信度评级', '');
  content.overview.confidenceLegend.forEach(c => {
    lines.push(`- **${c.label}**：${c.rule}`);
  });
  lines.push('', '### 置信度分布', '');
  content.overview.distribution.forEach(d => {
    lines.push(`- ${d.level}：${d.count} 条`);
  });

  // 方向索引
  content.directions.forEach(dir => {
    lines.push('', '---', '', `## ${dir.title}`, '', cleanText(dir.subtitle), '');
    dir.summaryItems.forEach(it => {
      lines.push(`${it.rank}. **${cleanText(it.title)}**（${it.confidence}）— ${cleanText(it.oneLine)}`);
    });
  });

  lines.push('', '---', '', '## 新闻详情', '');
  content.items.forEach((item, i) => {
    lines.push(`### ${i + 1}. ${cleanText(item.title)}`);
    lines.push(`- 方向：${item.direction === 'coding' ? 'AI Coding' : item.direction === 'embodied' ? '具身智能' : '传闻待验'}`);
    lines.push(`- 来源：${cleanText(item.source)}${item.category ? ` · ${item.category}` : ''} · ${item.publishedAt}`);
    lines.push(`- 置信度：${item.confidenceLevel} · 独立信源 ${item.independentSources} · 转载 ${item.totalReposts}`);
    if (item.heroMetrics.length > 0) {
      lines.push(`- **核心数据**：${item.heroMetrics.map(m => `${m.value} ${m.label}`).join(' · ')}`);
    }
    lines.push('');
    lines.push(cleanText(item.summary ?? ''));
    if (item.whyMatters) {
      lines.push('');
      lines.push(`> 💡 **为何值得关注**：${cleanText(item.whyMatters)}`);
    }
    if (item.whyDoubtful.length > 0) {
      lines.push('');
      lines.push(`> ⚠️ **为何评为 D 存疑**：`);
      item.whyDoubtful.forEach((d, i) => lines.push(`> ${i + 1}. ${cleanText(d)}`));
    }
    if (item.comment) {
      lines.push('');
      lines.push(`> 💡 **点评**：${cleanText(item.comment)}`);
    }
    lines.push('');
    lines.push(`🔗 原文：${cleanText(item.url ?? '')}`);
    if (item.primaryLinks.length > 0) {
      lines.push('');
      lines.push('**一手来源**：');
      item.primaryLinks.forEach(pl => {
        lines.push(`- [${cleanText(pl.source)}](${cleanText(pl.url)})`);
      });
    }
    lines.push('', '---', '');
  });

  // 趋势
  lines.push('## 三条趋势判断', '');
  content.trends.forEach(t => {
    lines.push(`### ${t.rank}. ${cleanText(t.title)}`);
    lines.push(cleanText(t.description), '');
  });

  // 信源
  lines.push('## 信源清单', '');
  const blocks = [
    { name: '聚合源', items: content.sources.skills },
    { name: '视频作者', items: content.sources.videoAuthors },
    { name: '第三方交叉源', items: content.sources.crossSources },
    { name: '一手官方', items: content.sources.officialLinks },
  ];
  blocks.forEach(b => {
    lines.push(`### ${b.name}`);
    b.items.forEach(it => lines.push(`- [${cleanText(it.name)}](${cleanText(it.url)})`));
    lines.push('');
  });

  // O4 闭环：附加生成元数据（让 Markdown 文档自带 QA 信息）
  lines.push('', '---', '', '## 生成元数据', '');
  lines.push(`- 生成时间：${content.generatedAt}`);
  if (meta?.pptxBuiltAt) {
    lines.push(`- PPT 缓存构建时间：${new Date(meta.pptxBuiltAt).toISOString()}`);
  } else {
    lines.push('- PPT 缓存：未构建');
  }
  lines.push(`- 内容版本：v${content.version}`);
  if (meta?.degraded) {
    lines.push(`- 质量状态：⚠️ 降级版${meta.error ? `（${meta.error.slice(0, 100)}）` : ''}`);
  } else {
    lines.push('- 质量状态：✅ 标准版');
  }
  lines.push('', '---', '', '*由 AIHub 自动生成 · 仅供参考*');
  return lines.join('\n');
}

export function BriefingPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  // ===== 全部 Hooks（Rules of Hooks：所有 hook 必须每次 render 以相同顺序执行）=====
  const toast = useToast();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [viewDate, setViewDate] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [smoothTick, setSmoothTick] = useState(0);
  // O1 闭环：本地主题态——点色板立刻变色（不等 server 响应）；server 返回后被覆盖
  const [localTheme, setLocalTheme] = useState<BriefingTheme | null>(null);
  // O5 闭环：QA 详情面板展开态（点击 "查看详细 lint" 打开）
  const [qaExpanded, setQaExpanded] = useState(false);

  const todayQuery = trpc.dailyReport.today.useQuery(undefined, {
    enabled: open,
    refetchInterval: (query) => (query.state.data?.status === 'generating' ? 1500 : false),
  });
  const listQuery = trpc.dailyReport.list.useQuery(undefined, { enabled: open });
  const historyQuery = trpc.dailyReport.get.useQuery(
    { date: viewDate ?? '' },
    { enabled: open && !!viewDate && viewDate !== todayQuery.data?.date },
  );

  const history = useMemo(
    () => (listQuery.data ?? []).filter(r => r.date !== todayQuery.data?.date),
    [listQuery.data, todayQuery.data?.date],
  );

  useEffect(() => {
    if (open) { setPage(1); setViewDate(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = prev; };
  }, [open, onClose]);

  const generateMut = trpc.dailyReport.generate.useMutation({
    onSuccess: (data) => toast.success(data.message),
    onError: (e) => toast.error(`触发失败：${e.message}`),
  });
  const regenerateMut = trpc.dailyReport.regenerate.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.dailyReport.today.invalidate();
      utils.dailyReport.list.invalidate();
    },
    onError: (e) => toast.error(`重新生成失败：${e.message}`),
  });
  const setThemeMut = trpc.dailyReport.setTheme.useMutation({
    onSuccess: (_data, variables) => {
      // O2 闭环：明确告诉用户「切完主题后下次下载会重建」，避免用户疑惑
      toast.success(`已切换到「${variables.theme}」主题，下次下载将重新构建 PPT`);
      utils.dailyReport.today.invalidate();
      utils.dailyReport.get.invalidate();
      utils.dailyReport.list.invalidate();
      // 本地态让 server 响应回来清掉（避免后续 query 覆盖本地选择）
      // —— 但保留 localTheme 直到用户关掉面板再清
    },
  });
  const deleteMut = trpc.dailyReport.delete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      setDeleteTarget(null);
      if (!viewingToday) setViewDate(null);
      todayQuery.refetch();
      listQuery.refetch();
    },
    onError: (e) => toast.error(`删除失败：${e.message}`),
  });
  const downloadQuery = trpc.dailyReport.download.useQuery(
    { date: '' },
    { enabled: false, retry: false },
  );

  // ===== 条件变量（依赖 hooks 返回值）=====
  type Status = 'none' | 'ready' | 'generating' | 'failed' | 'querying';
  const viewingToday = !viewDate || viewDate === todayQuery.data?.date;
  const current = viewingToday ? todayQuery.data : historyQuery.data;
  const currentDate = viewingToday ? todayQuery.data?.date : viewDate;
  const content = current?.content ?? null;
  // O4 闭环：把"今天"和"历史"的元数据统一提取（类型安全的窄化版）
  const metaInfo = {
    degraded: current?.degraded ?? false,
    error: viewingToday ? (todayQuery.data?.error ?? null) : null,
    pptxBuiltAt: viewingToday ? (todayQuery.data?.pptxBuiltAt ?? null) : (historyQuery.data?.pptxBuiltAt ?? null),
  };
  // O1 闭环：在 IIFE 外提前算 activeTheme（IIFE 内消费）
  const activeTheme: BriefingTheme = localTheme ?? (current?.theme as BriefingTheme) ?? 'paper';

  const todayStatus = todayQuery.data?.status as Status | undefined;
  const status: Status = viewingToday ? (todayStatus ?? 'none') : 'ready';
  const isGenerating = status === 'generating';

  // 进度条平滑动画：在同一 phase 内，每 250ms 推进一格，避免 LLM 长调用时进度条卡死
  // （Rules of Hooks：必须位于下方 early return 之前）
  useEffect(() => {
    if (!isGenerating) { setSmoothTick(0); return; }
    const id = setInterval(() => setSmoothTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [isGenerating]);

  // ===== Guards（必须在所有 hooks 之后）=====
  if (typeof document === 'undefined') return null;
  if (!open) return null;

  // ===== Handlers =====
  const handleDownload = async () => {
    if (!currentDate) return;
    try {
      const res = await downloadQuery.refetch();
      if (res.data?.base64) {
        const blob = base64ToBlob(res.data.base64, res.data.mimeType);
        // B-05 修复：base64ToBlob 在解码失败时返回空 Blob，直接下载会得到 0 字节文件。
        //          用 size 检测兜底：0 字节 → 报错。
        if (blob.size === 0) {
          toast.error('文件解码失败，请重试或联系管理员');
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = res.data.fileName; a.click();
        URL.revokeObjectURL(url);
        toast.success(res.data.cacheHit ? '从缓存下载完成' : '文件已生成并下载');
      } else {
        toast.error('下载失败，请稍后重试');
      }
    } catch {
      toast.error('下载失败，请检查网络后重试');
    }
  };

  const handleDownloadMarkdown = () => {
    if (!content || !currentDate) return;
    // O4 闭环：把 degraded + error + pptxBuiltAt 也写进 Markdown（用户离线也能看到 QA 信息）
    const md = generateMarkdownReport(content, metaInfo);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `AIHub-AI早报-${currentDate}.md`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Markdown 下载完成');
  };

  // 页数唯一来源：直接问 slide-engine 要 deck 长度。
  // 旧实现在这里手抄了一份 legacy 的页数公式（封面+概览+各方向的索引/hero/两列卡/三列卡…），
  // 切流后它和真实产出的 PPTX 已不是同一套页序 —— 属于第三份「页数真相」，删掉。
  // 刻意不用 useMemo：本组件在 331 行有提前 return，在其之后调用 Hook 会破坏 Hook 顺序。
  // planBriefingDeck 只是纯对象构建（无 I/O、无 React），重复执行成本可忽略。
  const tp = (() => {
    if (!content) return 0;
    // registerBriefingPageTypes() 已幂等；try 只包住规划，避免把「已注册」误判成 0 页
    registerBriefingPageTypes();
    try {
      return planBriefingDeck(content).length;
    } catch {
      return 0;
    }
  })();

  // ===== 状态机 =====
  const isReady = status === 'ready' && !!content;
  const isFailed = status === 'failed';
  const isNone = status === 'none' || status === 'querying';
  const isError = todayQuery.isError;

  const phaseOrder: readonly string[] = BRIEFING_PHASES;
  const phaseLabel = BRIEFING_PHASE_LABELS;
  const currentPhase = todayQuery.data?.phase ?? 'collect';
  const phaseText = phaseLabel[currentPhase as keyof typeof phaseLabel] ?? '正在生成…';

  // 根据 phase 计算基础进度；同 phase 内按 elapsed 时间加 0~6% 平滑推进
  const phaseIdx = phaseOrder.indexOf(currentPhase);
  const basePct = phaseIdx >= 0
    ? (phaseIdx + 1) / (phaseOrder.length + 1)
    : (isGenerating ? 0.1 : 0);
  // 同 phase 内每 1.5s 多走 2%，最多 +6%，避免 100% 假象
  const elapsedSeconds = isGenerating ? Math.floor(smoothTick / 6) : 0;
  const phasePct = Math.min(basePct + Math.min(elapsedSeconds * 0.02, 0.06), 0.99);

  // 修复：Portal 到 body，避免被父级 stacking context（overflow + transform）困住而穿透
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-[1060px] flex-col overflow-hidden rounded-lg border border-border bg-card"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
              Daily Briefing
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">AI 早报</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {currentDate ? `${currentDate} · ` : ''}
              {isReady ? `共 ${tp} 页${current?.degraded ? ' · 降级版' : ''}` : ''}
              {isGenerating && '正在生成中…'}
              {isFailed && '生成失败'}
              {isError && '查询出错'}
              {isNone && !isError && '今日早报尚未生成'}
            </p>
            {/* O3' 闭环：PPT 缓存年龄指示（让用户看到上次构建时间） */}
            {isReady && current?.pptxBuiltAt && (
              <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                📦 PPT 缓存构建于 {new Date(current.pptxBuiltAt).toLocaleString('zh-CN', { hour12: false })}
                {localTheme && localTheme !== (current.theme ?? 'paper') && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">
                    ⚠ 当前预览「{localTheme}」与缓存主题「{current.theme}」不一致，下次下载会重建
                  </span>
                )}
              </p>
            )}
            {/* 切了主题但还没下载时：缓存尚未重建 */}
            {isReady && !current?.pptxBuiltAt && (
              <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                📦 PPT 缓存未构建（首次下载将即时生成）
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isReady && (
              <>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloadQuery.isFetching}
                  className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {downloadQuery.isFetching ? '构建文件中…' : '下载 .pptx'}
                </button>
                {current?.degraded && (
                  <button
                    type="button"
                    onClick={handleDownloadMarkdown}
                    className="rounded border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    title="降级版纯文本下载（不含图表）"
                  >
                    下载 .md
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteTarget(currentDate ?? null)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  删除
                </button>
              </>
            )}
            {(isNone || isFailed) && viewingToday && (
              <>
                {isFailed && (
                  <button
                    type="button"
                    onClick={() => regenerateMut.mutate({})}
                    disabled={regenerateMut.isPending}
                    className="rounded bg-destructive/10 border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
                  >
                    {regenerateMut.isPending ? '重新生成…' : '重新生成'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => generateMut.mutate({})}
                  disabled={generateMut.isPending}
                  className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {isFailed ? '换时间重试' : '生成今日早报'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="关闭"
            >
              关闭
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* 主区：预览 / 状态 */}
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-5">
            {/* A3：错误状态（网络/服务器异常） */}
            {isError && (
              <div className="flex h-[435px] w-full max-w-[773px] flex-col items-center justify-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm">
                <p className="font-medium text-destructive">无法获取早报数据</p>
                <p className="text-xs text-muted-foreground">
                  {todayQuery.error?.message ?? '网络异常，请检查连接后重试'}
                </p>
                <button
                  type="button"
                  onClick={() => todayQuery.refetch()}
                  className="mt-1 rounded border border-border bg-background px-3 py-1.5 text-xs transition hover:bg-accent"
                >
                  重试
                </button>
              </div>
            )}
            {isGenerating && (
              <div className="flex h-[435px] w-full max-w-[773px] flex-col items-center justify-center gap-4 rounded-md border border-border bg-background px-6">
                {/* 中心大 spinner */}
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 animate-spin rounded-full border-4 border-muted-foreground/20 border-t-primary" />
                  <div className="absolute inset-3 animate-spin rounded-full border-2 border-primary/30 border-b-primary/60" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
                  <div className="h-2 w-2 rounded-full bg-primary" />
                </div>
                <p className="text-sm font-medium text-foreground">{phaseText}</p>
                <p className="text-xs text-muted-foreground">选题 → 成稿，约 30~90 秒</p>
                {/* 进度条（6 阶段 + 平滑过渡） */}
                <div className="w-full max-w-sm space-y-1.5">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>采集</span><span>选题</span><span>总览</span><span>成稿</span><span>信源</span><span>保存</span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-700 ease-out"
                      style={{ width: `${Math.round(phasePct * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground/60">
                    <span className={currentPhase === 'collect' ? 'font-semibold text-foreground' : ''}>10%</span>
                    <span className={currentPhase === 'select' ? 'font-semibold text-foreground' : ''}>25%</span>
                    <span className={['2a', '2b', '2c'].includes(currentPhase) ? 'font-semibold text-foreground' : ''}>40~85%</span>
                    <span className={currentPhase === 'persist' ? 'font-semibold text-foreground' : ''}>95%</span>
                  </div>
                  <p className="text-center text-[10px] text-muted-foreground/60">
                    {Math.round(phasePct * 100)}%
                  </p>
                </div>
              </div>
            )}
            {isFailed && !isError && (() => {
              // O5 闭环：把 error 字段解析成结构化展示（不再一坨字符串）
              const errStr = todayQuery.data?.error ?? '生成失败';
              const qa = parseQaError(errStr);
              return (
                <div className="flex h-[435px] w-full max-w-[773px] flex-col gap-3 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-6 text-sm">
                  <div>
                    <p className="font-medium text-destructive">⚠️ 数据获取异常</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {qa.kind === 'lint-errors' && `布局 lint 检测到 ${qa.count} 条 error（影响排版美观）`}
                      {qa.kind === 'lint-warns' && `布局 lint 检测到 ${qa.count} 条 warn（密度偏高）`}
                      {qa.kind === 'other' && errStr}
                    </p>
                  </div>

                  {qa.kind === 'lint-errors' && qa.issues.length > 0 && (
                    <details className="rounded border border-destructive/20 bg-background p-2 text-xs" open={qaExpanded}>
                      <summary
                        className="cursor-pointer font-medium text-foreground"
                        onClick={(e) => { e.preventDefault(); setQaExpanded(v => !v); }}
                      >
                        查看 {qa.issues.length} 条问题详情
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {qa.issues.map((iss, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
                              {iss.rule}·P{iss.pageNo}
                            </span>
                            <span className="text-foreground/80">{iss.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <p className="mt-auto text-xs text-muted-foreground">可点击上方「重新生成」再试，或下载 .md 获取纯文本版本</p>
                </div>
              );
            })()}
            {isNone && !isError && (
              <div className="flex h-[435px] w-full max-w-[773px] flex-col items-center justify-center gap-3 rounded-md border border-border bg-background text-sm text-muted-foreground">
                <p>今日早报尚未生成</p>
                <p className="text-xs">点击「生成今日早报」立即制作；此后每天 7:00 自动生成</p>
              </div>
            )}
            {isReady && (
              <>
                  <SlidePreview
                    content={content!}
                    page={page}
                    onPageChange={setPage}
                    totalPages={tp}
                    theme={BRIEFING_THEMES[activeTheme]}
                  />
                  {/* B4/B6：完整色板预览 + hover tooltip */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">风格</span>
                    {Object.values(BRIEFING_PALETTES).map(t => {
                      const isActive = activeTheme === t.id;
                      return (
                        <div key={t.id} className="group relative">
                          <button
                            type="button"
                            title={t.displayName}
                            onClick={() => {
                              // O1 闭环：本地态立即更新 → SlidePreview 立刻变色
                              setLocalTheme(t.id);
                              // 通知 server 切主题 + 清 PPT 缓存
                              if (currentDate) setThemeMut.mutate({ date: currentDate, theme: t.id });
                            }}
                            className={`h-7 w-7 rounded-full border-2 transition ${isActive
                                ? 'border-foreground ring-2 ring-foreground/30'
                                : 'border-border hover:scale-110'
                              }`}
                            style={{ background: `#${t.bg}` }}
                          />
                          {/* B6：hover 预览小色板 */}
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div
                              className="rounded-md border border-border p-1.5 text-[9px] shadow-lg"
                              style={{ background: `#${t.bg}`, minWidth: 72 }}
                            >
                              <div className="mb-1 font-semibold" style={{ color: `#${t.fg}` }}>{t.displayName}</div>
                              <div className="flex gap-1">
                                <div className="h-3 w-3 rounded-sm" style={{ background: `#${t.accent}` }} />
                                <div className="h-3 w-3 rounded-sm" style={{ background: `#${t.muted}` }} />
                                <div className="h-3 w-3 rounded-sm" style={{ background: `#${t.softBlock}` }} />
                              </div>
                              <div className="mt-1" style={{ color: `#${t.muted}` }}>Aa 演示文字</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* O5 闭环：如果是降级版（lint 报错导致 degraded），在色板下面显示轻量 QA 摘要 */}
                  {current?.degraded && metaInfo.error && (() => {
                    const qa = parseQaError(metaInfo.error);
                    if (qa.kind === 'other') return null;
                    return (
                      <details className="w-full max-w-[773px] rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                        <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">
                          ⚠️ 降级原因摘要：{qa.kind === 'lint-errors' ? `${qa.count} 条布局 lint error` : `${qa.count} 条 warn`}
                        </summary>
                        {qa.kind === 'lint-errors' && qa.issues.length > 0 && (
                          <ul className="mt-2 space-y-1.5">
                            {qa.issues.map((iss, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-400">
                                  {iss.rule}·P{iss.pageNo}
                                </span>
                                <span className="text-foreground/80">{iss.detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          建议：点击「重新生成」让 LLM 重抽，或使用「下载 .md」获取纯文本版本。
                        </p>
                      </details>
                    );
                  })()}
                </>
              )}
          </div>

          {/* 侧栏：历史列表 */}
          <div className="w-[180px] shrink-0 overflow-y-auto border-l border-border p-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              历史早报
            </p>
            <button
              type="button"
              onClick={() => { setViewDate(null); setPage(1); }}
              className={`mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition ${viewingToday ? 'bg-foreground font-medium text-background' : 'text-foreground/80 hover:bg-accent'
                }`}
            >
              <span>{todayQuery.data?.date ? formatRelativeDate(todayQuery.data.date) : '今天'}</span>
              <span className="text-[9px] opacity-70">今日</span>
            </button>
            {history.map(r => (
              <button
                key={r.date}
                type="button"
                onClick={() => { setViewDate(r.date); setPage(1); }}
                className={`mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition ${viewDate === r.date ? 'bg-foreground font-medium text-background' : 'text-foreground/80 hover:bg-accent'
                  }`}
              >
                <span>{formatRelativeDate(r.date)}</span>
                <span className="text-[9px] opacity-70">
                  {r.status === 'ready' ? (r.degraded ? '降级' : '就绪') : r.status === 'failed' ? '失败' : '…'}
                </span>
              </button>
            ))}
            {history.length === 0 && (
              <p className="mt-2 text-[10px] text-muted-foreground/60">暂无历史早报</p>
            )}
          </div>
        </div>
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除这份早报？"
        description={`${deleteTarget ?? ''} 的早报将被永久删除，之后可以重新生成。`}
        confirmText="删除"
        destructive
        onConfirm={() => deleteTarget && deleteMut.mutate({ date: deleteTarget })}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>,
    document.body
  );
}
