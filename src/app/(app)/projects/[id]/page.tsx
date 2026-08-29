'use client';

import { useState, useMemo } from 'react';
import {
  IconChevronRight,
  IconChevronDown,
  IconFile,
  IconFolder,
  IconPlus,
  IconPlayerPlay,
  IconAlertTriangle,
  IconLoader2,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { ErrorState } from '@/components/ui/error-state';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '/', path: '', isDir: true, children: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      const isLast = i === parts.length - 1;
      let node = cur.children?.find((c) => c.name === name);
      if (!node) {
        node = { name, path, isDir: !isLast, children: !isLast ? [] : undefined };
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
}: {
  nodes: TreeNode[];
  level: number;
  onSelect: (n: TreeNode) => void;
  selectedPath: string | null;
}) {
  return (
    <div>
      {nodes.map((n) => (
        <TreeRow key={n.path} node={n} level={level} onSelect={onSelect} selectedPath={selectedPath} />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  level,
  onSelect,
  selectedPath,
}: {
  node: TreeNode;
  level: number;
  onSelect: (n: TreeNode) => void;
  selectedPath: string | null;
}) {
  const [open, setOpen] = useState(level < 2);
  const active = selectedPath === node.path;
  const isSeed = SEED_FILES.some((f) => f.path === node.path);
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
          <TreeView nodes={node.children} level={level + 1} onSelect={onSelect} selectedPath={selectedPath} />
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className={
        'flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-accent ' +
        (active ? 'bg-primary/10 text-primary font-medium' : '')
      }
      style={{ paddingLeft: 8 + level * 12 }}
    >
      <span className="w-3" />
      <IconFile size={12} className="text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      {isSeed && (
        <span className="ml-1 shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
          示例
        </span>
      )}
    </button>
  );
}

const SEED_FILES = [
  {
    path: 'src/index.ts',
    language: 'typescript',
    content:
      "// Entry point - HTTP server bootstrap\n" +
      "import express from 'express';\n\n" +
      "export function createApp() {\n" +
      "  const app = express();\n" +
      "  app.get('/', (_, res) => res.send('ok'));\n" +
      "  return app;\n" +
      "}\n",
  },
  {
    path: 'src/auth/login.ts',
    language: 'typescript',
    content:
      "// WARNING: demo token check, missing expiration\n" +
      "export function verifyToken(token: string): boolean {\n" +
      "  return token.length > 0;\n" +
      "}\n",
  },
  {
    path: 'src/util/db.ts',
    language: 'typescript',
    content:
      "// WARNING: SQL string concat - injection risk\n" +
      "export function findUser(id: string) {\n" +
      "  return db.query('SELECT * FROM users WHERE id = ' + id);\n" +
      "}\n",
  },
];

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const utils = trpc.useUtils();
  const projectQ = trpc.project.byId.useQuery({ id });
  const analysesQ = trpc.analysis.list.useQuery({ projectId: id, take: 20 });
  const runAnalysis = trpc.analysis.run.useMutation({
    onSuccess: () => {
      utils.analysis.list.invalidate({ projectId: id });
      utils.project.byId.invalidate({ id });
    },
  });

  const [files] = useState(SEED_FILES);
  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files]);
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const selectedFile = files.find((f) => f.path === selected);

  if (projectQ.isLoading) return <div className="p-8 text-sm text-muted-foreground">加载中…</div>;
  if (projectQ.error)
    return (
      <div className="p-8">
        <ErrorState message={projectQ.error.message} onRetry={() => projectQ.refetch()} />
      </div>
    );
  if (!projectQ.data) return <div className="p-8 text-sm">项目不存在</div>;
  const p = projectQ.data;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div>
          <div className="text-lg font-semibold">{p.name}</div>
          <div className="text-xs text-muted-foreground">
            /{p.slug} · {p.visibility}
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
            onClick={() => runAnalysis.mutate({ projectId: p.id, files })}
            disabled={runAnalysis.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <IconLoader2 size={14} className={runAnalysis.isPending ? 'animate-spin' : ''} />
            {runAnalysis.isPending ? '分析中…' : '跑代码审查'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 shrink-0 overflow-y-auto border-r bg-card p-2">
          <div className="mb-2 flex items-center justify-between px-2 text-xs text-muted-foreground">
            <span>文件</span>
            <button
              type="button"
              disabled
              title="上传功能开发中"
              className="cursor-not-allowed opacity-40"
            >
              <IconPlus size={11} />
            </button>
          </div>
          <TreeView nodes={tree} level={0} onSelect={(n) => setSelected(n.path)} selectedPath={selected} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {selectedFile ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs">
                <span className="font-medium">{selectedFile.path}</span>
                <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {selectedFile.language}
                </span>
              </div>
              <pre className="flex-1 overflow-auto bg-background p-4 font-mono text-xs leading-relaxed">
                <code>{selectedFile.content}</code>
              </pre>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              请选择一个文件
            </div>
          )}
        </div>

        <div className="w-80 shrink-0 overflow-y-auto border-l bg-card">
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

      {runAnalysis.error && (
        <div className="border-t bg-destructive/10 px-6 py-2 text-xs text-destructive">
          分析失败：{runAnalysis.error.message}
        </div>
      )}
      {runAnalysis.data && (
        <div className="border-t bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
          分析完成 · 评分 {runAnalysis.data.score} · {runAnalysis.data.issueCount} 个问题 · 消耗{' '}
          {runAnalysis.data.usage.inputTokens} in / {runAnalysis.data.usage.outputTokens} out
        </div>
      )}
    </div>
  );
}