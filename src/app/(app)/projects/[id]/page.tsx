'use client';

// C-8 修复：项目详情页
//   - 删 SEED_FILES，改用 trpc.file.files 从 DB 拉真实文件
//   - 文件内容预览走 trpc.file.fileContent（按需懒加载）
//   - "跑代码审查"按钮：先并行拉取所有文件内容，再调 analysis.run
//   - 新增上传按钮（单文件 / 文件夹）和删除按钮
//
// 数据流：
//   trpc.file.files({ projectId })  →  list
//   trpc.file.fileContent({ fileId }) →  preview pane
//   /api/upload/file (POST)         →  R2 + File 表 upsert
//   trpc.file.deleteFile            →  soft delete + 异步删 R2

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
  IconFile,
  IconFolder,
  IconPlus,
  IconPlayerPlay,
  IconAlertTriangle,
  IconLoader2,
  IconTrash,
  IconUpload,
  IconArrowUp,
  IconGripVertical,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { BackButton } from '@/components/ui/back-button';
import { CodeBlock } from '@/components/ui/code-block';
import { AnalysisReportModal } from '@/components/analysis/AnalysisReportModal';
import { DEFAULT_CATEGORIES } from '@/lib/analysis/categories';

/** 构造空 breakdown（按 8 类都 100 分，问题为空），用于 onSuccess 缓存 miss 时 */
function makeEmptyBreakdown() {
  return {
    summary: '加载中…',
    issueCount: 0,
    categories: DEFAULT_CATEGORIES.map((c) => ({
      key: c.key,
      name: c.name,
      score: 100,
      weight: c.weight,
      problems: [],
    })),
  };
}

/**
 * C-8.2：简单信号量，限制并发数。
 * 与 refresh-terms/scraper.ts 中的实现一致（本地副本，避免跨文件依赖）。
 */
class AsyncSemaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  fileId?: string;
  children?: TreeNode[];
}

function buildTree(files: Array<{ id: string; path: string }>): TreeNode[] {
  const root: TreeNode = { name: '/', path: '', isDir: true, children: [] };
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      acc = acc ? `${acc}/${name}` : name;
      const isLast = i === parts.length - 1;
      let node = cur.children?.find((c) => c.name === name);
      if (!node) {
        node = {
          name,
          path: acc,
          isDir: !isLast,
          fileId: isLast ? f.id : undefined,
          children: !isLast ? [] : undefined,
        };
        cur.children!.push(node);
      }
      cur = node;
    }
  }
  return root.children ?? [];
}

function TreeView({
  nodes,
  level,
  onSelect,
  selectedPath,
  onDelete,
  askConfirm,
}: {
  nodes: TreeNode[];
  level: number;
  onSelect: (n: TreeNode) => void;
  selectedPath: string | null;
  onDelete: (fileId: string) => void;
  askConfirm: ReturnType<typeof useConfirm>[0];
}) {
  return (
    <div>
      {nodes.map((n) => (
        <TreeRow
          key={n.path}
          node={n}
          level={level}
          onSelect={onSelect}
          selectedPath={selectedPath}
          onDelete={onDelete}
          askConfirm={askConfirm}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  level,
  onSelect,
  selectedPath,
  onDelete,
  askConfirm,
}: {
  node: TreeNode;
  level: number;
  onSelect: (n: TreeNode) => void;
  selectedPath: string | null;
  onDelete: (fileId: string) => void;
  askConfirm: ReturnType<typeof useConfirm>[0];
}) {
  const [open, setOpen] = useState(level < 2);
  const active = selectedPath === node.path;
  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={
            // 优化 A：活跃态加左侧主色竖条 + 整块轻微主色底，目录也支持 active（指向目录内文件时）
            'group flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-accent ' +
            (active
              ? 'border-l-2 border-primary bg-primary/10 pl-[calc(0.5rem-2px)] text-primary font-medium'
              : '')
          }
          style={{ paddingLeft: 8 + level * 12 }}
        >
          {open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
          <IconFolder size={12} className="text-muted-foreground" />
          {node.name}
        </button>
        {open && node.children && (
          <TreeView
            nodes={node.children}
            level={level + 1}
            onSelect={onSelect}
            selectedPath={selectedPath}
            onDelete={onDelete}
            askConfirm={askConfirm}
          />
        )}
      </div>
    );
  }
  return (
    <div
      className={
        // 优化 A：active 态加左侧主色条 + 加深主色底，强化"我正看着这个文件"
        'group flex w-full items-center gap-1 rounded-md text-left text-xs hover:bg-accent ' +
        (active
          ? 'border-l-2 border-primary bg-primary/15 pl-[calc(0.5rem-2px)] text-primary font-medium'
          : '')
      }
      style={{ paddingLeft: 8 + level * 12 }}
    >
      <button
        type="button"
        onClick={() => onSelect(node)}
        className="flex flex-1 items-center gap-1 px-2 py-1"
      >
        <span className="w-3" />
        <IconFile size={12} className={active ? 'text-primary' : 'text-muted-foreground'} />
        <span className="truncate">{node.name}</span>
      </button>
      {node.fileId && (
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            // C-14 一致性：删除确认改用 useConfirm（替掉原生 confirm）
            const ok = await askConfirm({
              title: '删除文件',
              description: `确认删除文件「${node.name}」？删除会同时清理 R2 上的对象。`,
              confirmText: '删除',
              cancelText: '取消',
              destructive: true,
            });
            if (ok) onDelete(node.fileId!);
          }}
          // 优化 E：桌面悬停显示 / 触屏（无 hover）改为始终半透明显示，避免 mobile 永远找不到删除
          className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-60"
          aria-label={`删除 ${node.name}`}
          title="删除"
        >
          <IconTrash size={10} />
        </button>
      )}
    </div>
  );
}

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const toast = useToast();
  // C-14 一致性：删除文件确认改用 useConfirm
  const [askConfirm, ConfirmNode] = useConfirm();

  const utils = trpc.useUtils();
  const projectQ = trpc.project.byId.useQuery({ id });
  const analysesQ = trpc.analysis.list.useQuery({ projectId: id, take: 20 });
  const filesQ = trpc.file.files.useQuery({ projectId: id });

  // 选中文件的 id（用 id 而非 path，因为 path 可能非唯一）
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileContentQ = trpc.file.fileContent.useQuery(
    { fileId: selectedId! },
    { enabled: !!selectedId },
  );

  // H-35 修复：展开分析详情，查看 issues
  const [expandedAnalysisId, setExpandedAnalysisId] = useState<string | null>(null);
  const analysisDetailQ = trpc.analysis.byId.useQuery(
    { id: expandedAnalysisId! },
    { enabled: !!expandedAnalysisId },
  );

  // Analysis report modal state
  // 2026-09-09 修复：原本只支持"刚跑完分析时打开"，现在支持从历史记录重新打开
  const [reportModal, setReportModal] = useState<{
    analysis: NonNullable<ReturnType<typeof trpc.analysis.run.useMutation>['data']>;
    breakdown: { summary: string; issueCount: number; issues?: Array<Record<string, unknown>>; categories?: unknown };
  } | null>(null);

  /**
   * 从历史记录打开报告弹窗。
   * 与 runAnalysisMut.onSuccess 走同一条路径（依赖 analysisDetailQ 异步加载 breakdown），
   * 但 analysis 元数据从历史记录拿（避免再调一次 analysis.run）。
   */
  function setReportModalFromHistory(
    analysisId: string,
    overall: number,
    issueCount: number,
    model: string,
  ) {
    setReportModal({
      analysis: {
        // 这些字段是从 history item 拿的，不是真实的 run 结果
        // - score/issueCount/model 来自 DB
        // - analysisId 用于触发 analysisDetailQ 加载 breakdown
        // - isMock=false（历史记录里没有 isMock 标记，统一按真实分析处理）
        // - usage 显示为 0（避免误导——历史记录里看不到当时的真实 token）
        analysisId,
        score: overall,
        issueCount,
        model,
        isMock: false,
        usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
      },
      breakdown: makeEmptyBreakdown(),
    });
  }

  // 上传状态
  const [uploading, setUploading] = useState(false);
  // 优化 D：上传进度计数（success / total），给用户更明确的反馈
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // "准备分析"状态：先拉所有文件内容再调 analysis.run
  const [preparing, setPreparing] = useState(false);

  // 优化 B+G：代码预览区 ref + 切换文件时回到顶部 + 滚动一段距离显示"回到顶部"按钮
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // 优化 G：选中文件变化 → 滚动容器回到顶部
  useEffect(() => {
    if (selectedId && previewScrollRef.current) {
      previewScrollRef.current.scrollTop = 0;
      setShowBackToTop(false);
    }
  }, [selectedId]);

  // 2026-09-11：文件树列宽可拖拽调节（夹缝颜色随主题色）
  //  - 范围 180 ~ 420px（"间距不能太大"，限制左右极值避免拉飞）
  //  - 持久化到 localStorage（key = aihub-file-tree-width）
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(256);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem('aihub-file-tree-width'));
    if (Number.isFinite(saved) && saved >= 180 && saved <= 420) {
      setFileTreeWidth(saved);
    }
  }, []);
  const splitterDragRef = useRef<{ startX: number; startW: number } | null>(null);
  function onSplitterPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    splitterDragRef.current = { startX: e.clientX, startW: fileTreeWidth };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  function onSplitterPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const ctx = splitterDragRef.current;
    if (!ctx) return;
    const next = Math.max(180, Math.min(420, ctx.startW + (e.clientX - ctx.startX)));
    setFileTreeWidth(next);
  }
  function onSplitterPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!splitterDragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    splitterDragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.localStorage.setItem('aihub-file-tree-width', String(fileTreeWidth));
  }

  // 2026-09-11：右侧分析记录列宽可拖拽调节（夹缝颜色随主题色）
  //  - 范围 240 ~ 480px（限制极值）
  //  - 持久化到 localStorage（key = aihub-analysis-width）
  const [analysisWidth, setAnalysisWidth] = useState<number>(320);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem('aihub-analysis-width'));
    if (Number.isFinite(saved) && saved >= 240 && saved <= 480) {
      setAnalysisWidth(saved);
    }
  }, []);
  const rightSplitterDragRef = useRef<{ startX: number; startW: number } | null>(null);
  function onRightSplitterPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    rightSplitterDragRef.current = { startX: e.clientX, startW: analysisWidth };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  function onRightSplitterPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const ctx = rightSplitterDragRef.current;
    if (!ctx) return;
    // 拖左边分隔条 = 左边拉宽 = 右边变小，所以加反向
    const next = Math.max(240, Math.min(480, ctx.startW - (e.clientX - ctx.startX)));
    setAnalysisWidth(next);
  }
  function onRightSplitterPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!rightSplitterDragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    rightSplitterDragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.localStorage.setItem('aihub-analysis-width', String(analysisWidth));
  }

  // 选中的 File 元信息（用于 content 面板的语言标签）
  const selectedMeta = useMemo(
    () => filesQ.data?.find((f) => f.id === selectedId) ?? null,
    [filesQ.data, selectedId],
  );
  const tree = useMemo(
    () => buildTree(filesQ.data ?? []),
    [filesQ.data],
  );

  // 跑代码审查
  // Fix #17：失败时弹 toast，避免用户只看到底部一条小字
  // Fix #19 报告弹窗：成功时打开居中弹窗（含评分动画 + 问题列表 + Markdown 下载）
  const runAnalysisMut = trpc.analysis.run.useMutation({
    onSuccess: (data) => {
      utils.analysis.list.invalidate({ projectId: id });
      utils.project.byId.invalidate({ id });
      // Fix #19 v2：打开弹窗（breakdown 通过 analysis.byId 在弹窗内异步加载）
      setExpandedAnalysisId(data.analysisId);
      // 先尝试从已有 cache 拿（如果刚完成分析，byId 可能已经有数据）
      const cached = utils.analysis.byId.getData({ id: data.analysisId });
      if (cached?.score?.breakdown) {
        try {
          const bd = JSON.parse(cached.score.breakdown);
          // 兼容旧结构（issues[]）→ 转新结构（categories[]）
          setReportModal({ analysis: data, breakdown: bd });
        } catch {
          setReportModal({ analysis: data, breakdown: makeEmptyBreakdown() });
        }
      } else {
        setReportModal({ analysis: data, breakdown: makeEmptyBreakdown() });
      }
      toast.success(`评分 ${data.score}，共 ${data.issueCount} 个问题`);
    },
    onError: (e) => toast.error(`分析失败：${e.message}`),
  });

  // analysisDetailQ 异步加载完整 breakdown（含 categories）
  const modalBreakdown = useMemo(() => {
    if (!reportModal) return null;
    if (!expandedAnalysisId) return null;
    const detail = analysisDetailQ.data;
    if (!detail?.score?.breakdown) return null;
    try {
      const bd = JSON.parse(detail.score.breakdown);
      // 新结构（v2）：{ summary, issueCount, categories: [{ key, name, score, weight, problems: [...] }] }
      // 旧结构兼容：{ summary, issueCount, issues: [...] }（缺失 categories）
      if (Array.isArray(bd.categories) && bd.categories.length > 0) return bd;
      if (Array.isArray(bd.issues) && bd.issues.length > 0) {
        // 老结构 → 转新结构：所有问题塞进「代码质量」类别
        return {
          summary: bd.summary ?? '',
          issueCount: bd.issueCount ?? bd.issues.length,
          categories: [{
            key: 'architecture',
            name: '代码质量（旧）',
            score: reportModal.analysis.score,
            weight: 1,
            problems: bd.issues,
          }],
        };
      }
      return makeEmptyBreakdown();
    } catch {
      return null;
    }
  }, [reportModal, expandedAnalysisId, analysisDetailQ.data]);

  // 上传处理（单文件）
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    await uploadAll(Array.from(list), undefined);
    e.target.value = '';
  }

  // 上传处理（文件夹）
  async function handleFolderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    // 用 webkitRelativePath 作为 path（保留目录结构）
    const files = Array.from(list).map((f) => ({
      file: f,
      path: f.webkitRelativePath || f.name,
    }));
    await uploadAll(files.map((x) => x.file), files.map((x) => x.path));
    e.target.value = '';
  }

  async function uploadAll(
    files: File[],
    paths: (string | undefined)[] | undefined,
  ) {
    setUploading(true);
    // 收集每个文件的失败原因，最后汇总 + 头部 toast 给前 3 条
    type FailRecord = { path: string; reason: string };
    const failedItems: FailRecord[] = [];
    let success = 0;

    // C-8.2 优化：上限 3 并发上传（文件夹上传 50+ 文件不再串行 1 个 1 个）；
    //             AsyncSemaphore 与 scrape/rankings 内部实现一致
    const sem = new AsyncSemaphore(3);
    // 优化 D：上传进度计数初始化
    setUploadProgress({ done: 0, total: files.length });

    const tasks = files.map((f, i) => {
      const path = paths?.[i] ?? f.name;
      return sem.run(async () => {
        try {
          const fd = new FormData();
          fd.append('file', f);
          fd.append('projectId', id);
          fd.append('path', path);
          const res = await fetch('/api/upload/file', { method: 'POST', body: fd, signal: AbortSignal.timeout(60_000) });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            const reason = data.error || `HTTP ${res.status}`;
            failedItems.push({ path, reason });
            console.warn(`Upload failed for ${path}:`, reason);
            return;
          }
          success++;
          // 优化 D：每完成一个更新计数
          setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        } catch (err) {
          const reason = (err as Error).message || '网络错误';
          failedItems.push({ path, reason });
          console.warn(`Upload error for ${path}:`, err);
        }
      });
    });
    await Promise.allSettled(tasks);

    utils.file.files.invalidate({ projectId: id });

    if (failedItems.length === 0) {
      toast.success(`已上传 ${success} 个文件`);
    } else if (success === 0) {
      toast.error(`全部 ${failedItems.length} 个文件上传失败`);
    } else {
      toast.warning(`上传 ${success} 个，失败 ${failedItems.length} 个`);
    }
    // 头几条失败原因单独 toast，便于用户看到为什么失败、重试时不重蹈覆辙
    for (const f of failedItems.slice(0, 3)) {
      const short = f.path.length > 32 ? '…' + f.path.slice(-30) : f.path;
      toast.error(`${short}：${f.reason}`);
    }

    setUploading(false);
    setUploadProgress(null); // 优化 D：清理进度
  }

  // 删除文件
  const deleteFileMut = trpc.file.deleteFile.useMutation({
    onSuccess: () => {
      utils.file.files.invalidate({ projectId: id });
      if (selectedId) setSelectedId(null);
      toast.info('已删除');
    },
    onError: (e) => toast.error(e.message),
  });
  function handleDeleteFile(fileId: string) {
    deleteFileMut.mutate({ fileId });
  }

  // 跑代码审查：先拉所有内容，再调 analysis
  async function handleRunAnalysis() {
    const files = filesQ.data ?? [];
    if (files.length === 0) {
      toast.warning('请先上传文件');
      return;
    }
    setPreparing(true);
    // Fix #18：preparing 至少持续 400ms，避免快速失败时一闪而过、用户感知不到错误
    const minPreparing = new Promise<void>((resolve) => setTimeout(resolve, 400));
    try {
      const results = await Promise.allSettled(
        files.map((f) => utils.file.fileContent.fetch({ fileId: f.id })),
      );
      const analysisInput = files
        .map((f, i) => {
          const r = results[i];
          if (r.status !== 'fulfilled' || !r.value.content) return null;
          return {
            path: f.path,
            language: f.language ?? undefined,
            content: r.value.content,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (analysisInput.length === 0) {
        toast.error('所有文件内容加载失败，无法分析');
        return;
      }
      if (analysisInput.length < files.length) {
        toast.warning(
          `仅 ${analysisInput.length}/${files.length} 个文件内容加载成功，已跳过失败的`,
        );
      }
      runAnalysisMut.mutate({ projectId: id, files: analysisInput });
    } finally {
      // 让 preparing 至少 400ms 再关，避免 toast / 状态条一闪
      await minPreparing;
      setPreparing(false);
    }
  }

  if (projectQ.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">加载中…</div>;
  }
  if (projectQ.error) {
    return (
      <div className="p-8">
        <ErrorState message={projectQ.error.message} onRetry={() => projectQ.refetch()} />
      </div>
    );
  }
  if (!projectQ.data) return <div className="p-8 text-sm">项目不存在</div>;
  const p = projectQ.data;

  const noFiles = (filesQ.data?.length ?? 0) === 0 && !filesQ.isLoading;
  const isRunning = runAnalysisMut.isPending || preparing;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <BackButton href="/projects" title="返回项目列表" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold" title={p.name}>
              {p.name}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              /{p.slug} · {p.visibility}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {p.latestScore != null && (
            <div className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1 text-sm">
              <span className="text-xs text-muted-foreground">最新评分</span>
              <span className="font-semibold text-primary">{p.latestScore.toFixed(0)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleRunAnalysis}
            disabled={isRunning || noFiles}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            title={noFiles ? '请先上传文件' : '基于已上传的真实文件跑代码审查'}
          >
            <IconLoader2 size={14} className={isRunning ? 'animate-spin' : ''} />
            {preparing ? '加载文件中…' : runAnalysisMut.isPending ? '分析中…' : '跑代码审查'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div
          className="hidden shrink-0 overflow-y-auto border-r-2 border-r-foreground/10 bg-card p-2 shadow-[1px_0_4px_rgba(0,0,0,0.04)] md:block"
          style={{ width: fileTreeWidth }}
        >
          <div className="mb-2 flex items-center justify-between px-2 text-xs text-muted-foreground">
            <span>文件 {filesQ.data ? `(${filesQ.data.length})` : ''}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="上传文件"
                aria-label="上传文件"
              >
                <IconUpload size={11} />
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={uploading}
                className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="上传文件夹"
                aria-label="上传文件夹"
              >
                <IconFolder size={11} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.json,.md,.css,.html,.yaml,.yml,.toml,.sh,.sql,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-ignore - webkitdirectory is non-standard
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={handleFolderUpload}
            />
          </div>
          {uploading && (
            // 优化 D：上传中显示 N/M 计数 + 进度条，比 "上传中…" 更具体
            <div className="mb-2 rounded bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
              <div className="flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5">
                  <IconLoader2 size={10} className="animate-spin" />
                  上传中
                </span>
                {uploadProgress && (
                  <span className="font-mono">
                    {uploadProgress.done}/{uploadProgress.total}
                  </span>
                )}
              </div>
              {uploadProgress && uploadProgress.total > 0 && (
                <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {filesQ.isLoading ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">加载中…</div>
          ) : noFiles ? (
            // 优化 C：空状态强化 —— 显式标识 + 大 icon + 主操作按钮（不只是整块可点，弱发现性）
            <div className="mx-2 mt-2 rounded-lg border-2 border-dashed border-primary/30 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <IconUpload size={20} className="text-primary" />
              </div>
              <div className="mb-1 text-sm font-medium text-foreground">还没有文件</div>
              <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">
                上传单个文件，或选一个文件夹<br />
                整体导入（保留目录结构）
              </p>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <IconFile size={12} />
                  上传文件
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
                >
                  <IconFolder size={12} />
                  上传文件夹
                </button>
              </div>
            </div>
          ) : (
            <TreeView
              nodes={tree}
              level={0}
              onSelect={(n) => !n.isDir && n.fileId && setSelectedId(n.fileId)}
              selectedPath={selectedMeta?.path ?? null}
              onDelete={handleDeleteFile}
              askConfirm={askConfirm}
            />
          )}
        </div>

        {/* 2026-09-11：文件树/预览 分隔条 ——
              可拖拽调节左列宽，hover 高亮（主色），拖动时显示夹缝（主色细线） */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调节文件树宽度"
          aria-valuenow={fileTreeWidth}
          aria-valuemin={180}
          aria-valuemax={420}
          tabIndex={0}
          onPointerDown={onSplitterPointerDown}
          onPointerMove={onSplitterPointerMove}
          onPointerUp={onSplitterPointerUp}
          onPointerCancel={onSplitterPointerUp}
          onKeyDown={(e) => {
            // 键盘可达：← 缩小 / → 放大（步长 16px）
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              const next = Math.max(180, fileTreeWidth - 16);
              setFileTreeWidth(next);
              window.localStorage.setItem('aihub-file-tree-width', String(next));
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              const next = Math.min(420, fileTreeWidth + 16);
              setFileTreeWidth(next);
              window.localStorage.setItem('aihub-file-tree-width', String(next));
            }
          }}
          className="group hidden w-1 shrink-0 cursor-col-resize touch-none bg-border transition-colors hover:w-1.5 hover:bg-primary/60 md:block"
        >
          {/* 拖拽时 / 聚焦时显示的"夹缝"提示 —— 主色细线 + grip 图标 */}
          <div className="pointer-events-none flex h-full w-full items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <IconGripVertical size={10} className="text-primary" />
          </div>
        </div>

        {/* Mobile: 文件选择下拉 */}
        <div className="border-b bg-card px-3 py-2 md:hidden">
          <select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
            aria-label="选择文件"
          >
            <option value="">— 选择文件 —</option>
            {filesQ.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path}
              </option>
            ))}
          </select>
        </div>

        <div
          ref={previewScrollRef}
          // 优化 B：监听滚动，超出 300px 显示"回到顶部"按钮
          onScroll={(e) => {
            const top = (e.target as HTMLDivElement).scrollTop;
            setShowBackToTop(top > 300);
          }}
          className="relative flex-1 overflow-x-auto overflow-y-auto"
        >
          {!selectedId ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <IconFile size={28} className="opacity-30" />
              <span>{noFiles ? '请先上传文件' : '从左侧文件树选择一个文件'}</span>
              {!noFiles && (
                <span className="text-[11px] text-muted-foreground/70">选中文件后这里会显示内容预览</span>
              )}
            </div>
          ) : fileContentQ.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <IconLoader2 size={14} className="mr-2 animate-spin" />
              加载内容…
            </div>
          ) : fileContentQ.error ? (
            (() => {
              const msg = fileContentQ.error.message;
              const isR2Error =
                msg.includes('R2') ||
                msg.includes('文件存储') ||
                msg.includes('文件预览');
              return isR2Error ? (
                <div className="m-6 rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-700">
                  <p className="font-medium">⚠️ 文件预览需要配置 R2 存储</p>
                  <p className="mt-1 text-xs text-amber-600">
                    请在环境变量中配置 CLOUDFLARE_R2_* 后重新访问。
                    当前可正常上传文件，配置后文件内容预览将自动恢复。
                  </p>
                </div>
              ) : (
                <div className="p-8 text-sm text-destructive">
                  加载失败：{msg}
                </div>
              );
            })()
          ) : fileContentQ.data ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs">
                <span className="font-medium">{fileContentQ.data.path}</span>
                {fileContentQ.data.language && (
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {fileContentQ.data.language}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {(fileContentQ.data.sizeBytes / 1024).toFixed(1)} KB
                </span>
              </div>
              {fileContentQ.data.truncated ? (
                <div className="p-8 text-sm text-muted-foreground">
                  文件过大（{(fileContentQ.data.sizeBytes / 1024).toFixed(1)} KB），暂不支持内联预览
                </div>
              ) : (
                <CodeBlock
                  code={fileContentQ.data.content ?? ''}
                  language={fileContentQ.data.language ?? 'plaintext'}
                  filename={fileContentQ.data.path.split('/').pop() || fileContentQ.data.path}
                  className="flex-1 border-white/10 bg-black/30 shadow-inner"
                />
              )}
            </div>
          ) : null}
          {/* 优化 B：滚动超过 300px 时显示"回到顶部"按钮 */}
          {showBackToTop && (
            <button
              type="button"
              onClick={() => previewScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur transition hover:bg-primary hover:text-primary-foreground"
              aria-label="回到顶部"
              title="回到顶部"
            >
              <IconArrowUp size={12} />
              顶部
            </button>
          )}
        </div>

        {/* 2026-09-11：右侧分隔条 —— 可拖拽调节分析记录列宽，
              hover 高亮（主色），拖动时显示夹缝（主色细线） */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调节分析记录宽度"
          aria-valuenow={analysisWidth}
          aria-valuemin={240}
          aria-valuemax={480}
          tabIndex={0}
          onPointerDown={onRightSplitterPointerDown}
          onPointerMove={onRightSplitterPointerMove}
          onPointerUp={onRightSplitterPointerUp}
          onPointerCancel={onRightSplitterPointerUp}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              const next = Math.max(240, analysisWidth - 16);
              setAnalysisWidth(next);
              window.localStorage.setItem('aihub-analysis-width', String(next));
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              const next = Math.min(480, analysisWidth + 16);
              setAnalysisWidth(next);
              window.localStorage.setItem('aihub-analysis-width', String(next));
            }
          }}
          className="group hidden w-1 shrink-0 cursor-col-resize touch-none bg-border transition-colors hover:w-1.5 hover:bg-primary/60 lg:block"
        >
          <div className="pointer-events-none flex h-full w-full items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <IconGripVertical size={10} className="text-primary" />
          </div>
        </div>

        <div
          className="hidden shrink-0 overflow-y-auto border-l-2 border-l-foreground/10 bg-card shadow-[-1px_0_4px_rgba(0,0,0,0.04)] lg:block"
          style={{ width: analysisWidth }}
        >
          <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">
            分析记录
          </div>
          <div className="space-y-2 p-3">
            {analysesQ.data?.items.length === 0 && (
              <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                暂无分析 · 点上面按钮跑一次
              </div>
            )}
            {analysesQ.data?.items.map((a) => {
              const sev =
                a.score?.overall != null && a.score.overall >= 80
                  ? 'text-success'
                  : a.score?.overall != null && a.score.overall >= 60
                  ? 'text-warning'
                  : 'text-destructive';
              const isExpanded = expandedAnalysisId === a.id;
              return (
                <div key={a.id} className="rounded-md border bg-background text-xs">
                  {/* 2026-09-09 B-02 修复：外层改为 div + role=button + 键盘事件，
                      内部「打开报告」是真 button —— 之前 button 嵌套 button 触发 hydration error */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedAnalysisId(isExpanded ? null : a.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedAnalysisId(isExpanded ? null : a.id);
                      }
                    }}
                    className="w-full cursor-pointer p-3 text-left transition hover:bg-accent/30"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {a.id.slice(0, 8)}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{a.status}</span>
                    </div>
                    <div className="mb-1 flex items-center justify-between">
                      <span>模型</span>
                      <span className="font-mono text-[10px]">{a.aiModel ?? '—'}</span>
                    </div>
                    {a.score?.overall != null && (
                      <div className="mb-1 flex items-center justify-between">
                        <span>评分</span>
                        <span className={'font-semibold ' + sev}>
                          {a.score.overall.toFixed(0)} / 100
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>问题</span>
                      <span className="inline-flex items-center gap-1">
                        <IconAlertTriangle size={11} />
                        {a._count.issues}
                        {isExpanded ? <IconChevronUp size={11} /> : <IconChevronDown size={11} />}
                      </span>
                    </div>
                  </div>
                  {/* 2026-09-09 新增：「打开报告」按钮——独立于展开按钮，
                      让用户能在不丢当前选中文件的情况下重新查看完整报告弹窗 */}
                  {a.status === 'COMPLETED' && (
                    <div className="px-3 pb-3">
                      <button
                        type="button"
                        onClick={() => {
                          // 复用现有的 reportModal 打开逻辑：先 setExpandedAnalysisId，
                          // analysisDetailQ 异步加载完成后 modalBreakdown 会自动计算
                          setReportModalFromHistory(a.id, a.score?.overall ?? 0, a._count.issues, a.aiModel ?? '');
                          setExpandedAnalysisId(a.id);
                        }}
                        className="w-full rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/20"
                        title="重新打开完整报告弹窗"
                      >
                        📄 打开报告
                      </button>
                    </div>
                  )}

                  {/* H-35: 展开后显示 issues 详情（按严重等级排序） */}
                  {isExpanded && (
                    <div className="border-t px-3 py-2">
                      {analysisDetailQ.isLoading && (
                        <div className="py-2 text-center text-[11px] text-muted-foreground">加载详情…</div>
                      )}
                      {analysisDetailQ.data?.score?.breakdown && (() => {
                        try {
                          const bd = JSON.parse(analysisDetailQ.data.score.breakdown);
                          const issues = Array.isArray(bd.issues) ? bd.issues : [];
                          const summary = bd.summary ?? '';
                          // Fix #14：summary 截断展示，最多 500 字。完整内容在
                          //          score.breakdown 里（可单独加「展开」按钮查看）
                          const displayedSummary = summary.length > 500
                            ? summary.slice(0, 500) + '…'
                            : summary;
                          return (
                            <div className="space-y-2">
                              {displayedSummary && (
                                <p className="rounded bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                                  {displayedSummary}
                                </p>
                              )}
                              {issues.length === 0 && (
                                <div className="py-2 text-center text-[11px] text-muted-foreground">
                                  ✓ 未发现明显问题
                                </div>
                              )}
                              {issues.map((it: { severity?: string; category?: string; message?: string; suggestion?: string; filePath?: string; startLine?: number | null; endLine?: number | null }, idx: number) => {
                                const sevColor =
                                  it.severity === 'CRITICAL' ? 'border-destructive bg-destructive/5'
                                    : it.severity === 'HIGH' ? 'border-destructive/50 bg-destructive/5'
                                    : it.severity === 'MEDIUM' ? 'border-warning/50 bg-warning/5'
                                    : 'border-muted-foreground/30 bg-muted/30';
                                const sevBadge =
                                  it.severity === 'CRITICAL' ? 'bg-destructive text-destructive-foreground'
                                    : it.severity === 'HIGH' ? 'bg-destructive/80 text-destructive-foreground'
                                    : it.severity === 'MEDIUM' ? 'bg-warning/80 text-white'
                                    : 'bg-muted text-muted-foreground';
                                return (
                                  <div key={idx} className={'rounded border p-2 ' + sevColor}>
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                      <span className={'rounded px-1.5 py-0.5 text-[9px] font-medium ' + sevBadge}>
                                        {it.severity ?? '?'}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {it.category ?? ''}
                                      </span>
                                    </div>
                                    <p className="text-[11px] leading-relaxed">{it.message}</p>
                                    {it.suggestion && (
                                      <p className="mt-1 border-t pt-1 text-[10px] text-muted-foreground">
                                        💡 {it.suggestion}
                                      </p>
                                    )}
                                    {it.filePath && (
                                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                        📍 {it.filePath}{typeof it.startLine === 'number' ? `:${it.startLine}-${it.endLine ?? it.startLine}` : ''}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        } catch {
                          return <div className="py-2 text-[11px] text-muted-foreground">报告格式异常</div>;
                        }
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {runAnalysisMut.error && (
        <div className="border-t bg-destructive/10 px-6 py-2 text-xs text-destructive">
          分析失败：{runAnalysisMut.error.message}
        </div>
      )}
      {/* Fix #19：分析完成时显示居中报告弹窗（含评分动画 + 问题列表 + Markdown 下载） */}
      {reportModal && modalBreakdown && (
        <AnalysisReportModal
          analysis={reportModal.analysis}
          breakdown={modalBreakdown}
          projectName={projectQ.data?.name ?? '项目'}
          onClose={() => {
            setReportModal(null);
            setExpandedAnalysisId(null);
            runAnalysisMut.reset();
          }}
        />
      )}
      <ConfirmNode />
    </div>
  );
}
