'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { IconKey, IconCopy, IconCheck, IconRefresh } from '@tabler/icons-react';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function ApiKeysPanel() {
  const utils = trpc.useUtils();
  const listApiKeys = trpc.project.listApiKeys.useQuery();
  const toast = useToast();
  const [askConfirm, ConfirmNode] = useConfirm();
  const createKey = trpc.project.createApiKey.useMutation({
    onSuccess: () => utils.project.listApiKeys.invalidate(),
  });
  const revokeKey = trpc.project.revokeApiKey.useMutation({
    onSuccess: () => utils.project.listApiKeys.invalidate(),
  });

  const [newName, setNewName] = useState('');
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleCreate() {
    if (!newName.trim()) return;
    createKey.mutate(
      { name: newName },
      {
        onSuccess: (data) => {
          setJustCreated(data.plainKey);
          setNewName('');
          toast.success('API Key 已创建');
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  async function handleCopy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = key;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        toast.success('已复制到剪贴板');
        setTimeout(() => setCopied(false), 1500);
      } catch {
        toast.error('复制失败，请手动复制');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  async function handleRevoke(id: string, label: string) {
    const ok = await askConfirm({
      title: '撤销 API Key',
      description: `撤销 Key「${label}」？此 Key 立即失效。`,
      confirmText: '撤销',
      destructive: true,
    });
    if (ok) {
      revokeKey.mutate(
        { id },
        {
          onSuccess: () => toast.info('已撤销'),
          onError: (e) => toast.error(e.message),
        }
      );
    }
  }

  return (
    <Section
      title="API Key"
      subtitle="用于调用 REST API（如 /api/v1/projects）。仅在创建时显示明文一次。"
    >
      <div className="mb-4 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          placeholder="Key 名称（如：本地开发）"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!newName.trim() || createKey.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          <IconKey size={14} />
          {createKey.isPending ? '创建中…' : '创建'}
        </button>
      </div>

      {justCreated && (
        <div className="mb-4 animate-fade-in rounded-md border border-green-500/30 bg-green-500/10 p-3">
          <div className="mb-1.5 text-xs font-medium text-green-600">
            新 Key 已创建（仅显示一次）：
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-[11px]">
              {justCreated}
            </code>
            <button
              type="button"
              onClick={() => handleCopy(justCreated)}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent"
            >
              {copied ? (
                <>
                  <IconCheck size={12} className="text-green-600" />
                  已复制
                </>
              ) : (
                <>
                  <IconCopy size={12} />
                  复制
                </>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">名称</th>
              <th className="px-4 py-2 text-left font-medium">前缀</th>
              <th className="px-4 py-2 text-left font-medium">创建时间</th>
              <th className="px-4 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {listApiKeys.data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  还没有 API Key
                </td>
              </tr>
            )}
            {listApiKeys.data?.items.map((k) => (
              <tr key={k.id} className="border-t hover:bg-accent/30 transition">
                <td className="px-4 py-2.5">{k.label ?? '未命名'}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{k.keyLast4}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {new Date(k.createdAt).toLocaleString('zh-CN')}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id, k.label ?? '未命名')}
                    className="inline-flex items-center gap-1 rounded-md p-1.5 text-destructive opacity-70 hover:bg-destructive/10 hover:opacity-100"
                    title="撤销"
                  >
                    <IconRefresh size={12} />
                    撤销
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ConfirmNode()}
    </Section>
  );
}
