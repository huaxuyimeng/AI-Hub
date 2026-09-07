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

import { useState, useMemo, useRef } from 'react';
import {
  IconChevronRight,
  IconChevronDown,
  IconFile,
  IconFolder,
  IconPlus,
  IconPlayerPlay,
  IconAlertTriangle,
  IconLoader2,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { BackButton } from '@/components/ui/back-button';

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
            'flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-accent ' +
            (active ? 'bg-primary/10 text-primary' : '')
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
        'group flex w-full items-center gap-1 rounded-md text-left text-xs hover:bg-accent ' +
        (active ? 'bg-primary/10 text-primary font-medium' : '')
      }
      style={{ paddingLeft: 8 + level * 12 }}
    >
      <button
        type="button"
        onClick={() => onSelect(node)}
        className="flex flex-1 items-center gap-1 px-2 py-1"
      >
        <span className="w-3" />
        <IconFile size={12} className="text-muted-foreground" />
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
          className="mr-1 hidden rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
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

  // 上传状态
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // "准备分析"状态：先拉所有文件内容再调 analysis.run
  const [preparing, setPreparing] = useState(false);

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
  const runAnalysisMut = trpc.analysis.run.useMutation({
    onSuccess: () => {
      utils.analysis.list.invalidate({ projectId: id });
      utils.project.byId.invalidate({ id });
    },
  });

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

    const tasks = files.map((f, i) => {
      const path = paths?.[i] ?? f.name;
      return sem.run(async () => {
        try {
          const fd = new FormData();
          fd.append('file', f);
          fd.append('projectId', id);
          fd.append('path', path);
          const res = await fetch('/api/upload/file', { method: 'POST', body: fd });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            const reason = data.error || `HTTP ${res.status}`;
            failedItems.push({ path, reason });
            console.warn(`Upload failed for ${path}:`, reason);
            return;
          }
          success++;
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
        <div className="hidden w-64 shrink-0 overflow-y-auto border-r bg-card p-2 md:block">
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
            <div className="mb-2 flex items-center gap-1.5 rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
              <IconLoader2 size={10} className="animate-spin" />
              上传中…
            </div>
          )}
          {filesQ.isLoading ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">加载中…</div>
          ) : noFiles ? (
            <div className="mx-2 rounded-md border border-dashed p-4 text-center text-[11px] text-muted-foreground">
              <IconPlus size={14} className="mx-auto mb-1 opacity-50" />
              还没有文件
              <div className="mt-1 text-[10px]">点上方按钮上传</div>
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

        <div className="flex-1 overflow-x-auto overflow-y-auto">
          {!selectedId ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {noFiles ? '请先上传文件' : '请选择一个文件'}
            </div>
          ) : fileContentQ.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <IconLoader2 size={14} className="mr-2 animate-spin" />
              加载内容…
            </div>
          ) : fileContentQ.error ? (
            <div className="p-8 text-sm text-destructive">
              加载失败：{fileContentQ.error.message}
            </div>
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
                <pre className="flex-1 overflow-auto bg-background p-4 font-mono text-xs leading-relaxed">
                  <code>{fileContentQ.data.content}</code>
                </pre>
              )}
            </div>
          ) : null}
        </div>

        <div className="hidden w-80 shrink-0 overflow-y-auto border-l bg-card lg:block">
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
              return (
                <div key={a.id} className="rounded-md border bg-background p-3 text-xs">
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
                    </span>
                  </div>
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
      {runAnalysisMut.data && (
        <div className="border-t bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
          分析完成 · 评分 {runAnalysisMut.data.score} · {runAnalysisMut.data.issueCount} 个问题 ·
          消耗 {runAnalysisMut.data.usage.inputTokens} in / {runAnalysisMut.data.usage.outputTokens} out
        </div>
      )}
      <ConfirmNode />
    </div>
  );
}
