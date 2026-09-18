'use client';

/**
 * AI 模型 Key 设置面板
 * 路径：src/components/settings/AiKeysPanel.tsx
 *
 * 对应 Phase 3.1 AI 模型 Key section
 * 6 个 Provider 卡片（已实现），其他 stub 报"暂未适配"
 * 测试连接 → sec-A 防护（rate limit + sanitize error + redact log）
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';
import { useConfirm } from '@/components/confirm-dialog';
import { IconKey, IconCheck, IconPlug, IconTrash, IconRefresh } from '@tabler/icons-react';

export function AiKeysPanel() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const [askConfirm, ConfirmNode] = useConfirm();

  const providersQ = trpc.aiKeys.providers.useQuery();
  const listQ = trpc.aiKeys.list.useQuery();
  const modelsQ = trpc.models.list.useQuery(undefined, { staleTime: 30_000 });
  const discoverMut = trpc.models.discover.useMutation();

  const createMut = trpc.aiKeys.create.useMutation({
    onSuccess: () => utils.aiKeys.list.invalidate(),
  });
  const revokeMut = trpc.aiKeys.revoke.useMutation({
    onSuccess: () => utils.aiKeys.list.invalidate(),
  });
  const testMut = trpc.aiKeys.test.useMutation();

  const [draft, setDraft] = useState<{ provider: string; apiKey: string; label: string } | null>(null);

  if (providersQ.isLoading) {
    return <div className="text-sm text-muted-foreground">加载中…</div>;
  }
  if (providersQ.error) {
    return <div className="text-sm text-destructive">加载 Provider 失败：{providersQ.error.message}</div>;
  }

  const providers = providersQ.data ?? [];
  const allKeys = listQ.data?.items ?? [];

  // 按 provider 分组已配置的 keys
  const keysByProvider = new Map<string, typeof allKeys>();
  for (const k of allKeys) {
    if (!keysByProvider.has(k.provider)) keysByProvider.set(k.provider, []);
    keysByProvider.get(k.provider)!.push(k);
  }

  function handleTest(provider: string, apiKey: string, model?: string) {
    if (!apiKey || apiKey.length < 8) {
      toast.error('Key 至少 8 位');
      return;
    }
    testMut.mutate(
      { provider, apiKey, model },
      {
        onSuccess: (res) => {
          if (res.ok) toast.success(`✅ ${provider} 连接成功（${res.latencyMs} ms）`);
          else toast.error(`❌ ${provider}：${res.error ?? '未知错误'}`);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  function handleSave() {
    if (!draft) return;
    createMut.mutate(
      { provider: draft.provider, apiKey: draft.apiKey, label: draft.label ?? draft.provider },
      {
        onSuccess: () => {
          toast.success(`Key 已保存（${draft.provider}）`);
          setDraft(null);
          handleTest(draft.provider, draft.apiKey); // 保存后自动测试
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  async function handleRevoke(id: string, label: string) {
    const ok = await askConfirm({
      title: '撤销 Key',
      description: `撤销 Key「${label}」？该 Key 立即失效。`,
      confirmText: '撤销',
      destructive: true,
    });
    if (ok) {
      revokeMut.mutate(
        { id },
        {
          onSuccess: () => toast.info('已撤销'),
          onError: (e) => toast.error(e.message),
        }
      );
    }
  }

  function handleRefreshModels() {
    discoverMut.mutate(undefined, {
      onSuccess: (res) => {
        utils.models.list.invalidate();
        toast.success(`模型刷新完成：${res.models} 个（${res.providers.succeeded}/${res.providers.total} 个 Provider 成功）`);
      },
      onError: (e) => toast.error(`刷新失败：${e.message}`),
    });
  }

  return (
    <>
      {ConfirmNode}
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          所有 key 以 <code className="font-mono">SHA-256 哈希</code> 存储，明文不会进数据库。
          未配置时，会自动使用服务器环境变量作为系统级兜底（key-pool-A）。
        </p>

        {/* 刷新模型按钮 + 模型计数 */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {modelsQ.data
              ? <span>
                  模型库：
                  <span className="font-medium text-foreground">{modelsQ.data.total}</span> 个
                  {modelsQ.data.source === 'fallback' && (
                    <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">静态表 · 可点击刷新从官方拉取</span>
                  )}
                </span>
              : '加载中…'}
          </div>
          <button
            type="button"
            onClick={handleRefreshModels}
            disabled={discoverMut.isPending}
            title="从各 Provider 官方 API 拉取最新模型列表"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <IconRefresh size={12} className={discoverMut.isPending ? 'animate-spin' : ''} />
            {discoverMut.isPending ? '刷新中…' : '刷新模型'}
          </button>
        </div>

        {providers.map((p) => {
          const keys = keysByProvider.get(p.id) ?? [];
          const isFull = !p.isStub;
          return (
            <div key={p.id} className="rounded-lg border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.displayName}</span>
                    <StatusBadge isStub={p.isStub} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    协议：{p.protocol} · 默认模型：{p.defaultModel}
                  </p>
                  {p.docsUrl && (
                    <a
                      className="mt-1 inline-block text-[11px] text-primary hover:underline"
                      href={p.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      文档 ↗
                    </a>
                  )}
                </div>
                {p.isStub && (
                  <span className="shrink-0 rounded-md bg-foreground/5 px-2 py-1 text-[10px] text-muted-foreground">
                    Stub
                  </span>
                )}
              </div>

              {/* 已配 keys */}
              {keys.length > 0 && (
                <div className="mt-3 space-y-1.5 rounded-md border bg-background p-2">
                  {keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <code className="font-mono text-[11px]">***{k.keyLast4}</code>
                        <span className="text-muted-foreground">·</span>
                        <span className="truncate text-muted-foreground">{k.label ?? '未命名'}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {k.lastUsedAt && (
                          <span className="text-[10px] text-muted-foreground">
                            {k.lastUsedAt.toLocaleString('zh-CN')}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRevoke(k.id, k.label ?? '未命名')}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <IconTrash size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add form */}
              {draft?.provider === p.id ? (
                <div className="mt-4 space-y-3 rounded-md border bg-background p-3">
                  <input
                    type="text"
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    placeholder="Key 名称（如：本地开发）"
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  />
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={draft.apiKey}
                      onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                      placeholder="API Key（至少 8 位）"
                      autoComplete="off"
                      className="flex-1 rounded-md border bg-card px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring/30"
                    />
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={createMut.isPending || draft.apiKey.length < 8}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      <IconCheck size={14} />
                      {createMut.isPending ? '保存中…' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      className="rounded-md border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
                    >
                      取消
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    提示：保存后会自动测试连接。结果会显示在上方 toast 中。
                  </p>
                </div>
              ) : (
                <div className="mt-4 flex justify-end gap-2">
                  {isFull && (
                    <button
                      type="button"
                      onClick={() => setDraft({ provider: p.id, apiKey: '', label: '' })}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-accent"
                    >
                      <IconKey size={12} />
                      添加 Key
                    </button>
                  )}
                  {!isFull && (
                    <button
                      type="button"
                      disabled
                      title="该 Provider 暂未适配完整协议"
                      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border bg-background/50 px-3 py-1.5 text-xs text-muted-foreground opacity-60"
                    >
                      <IconPlug size={12} />
                      暂未适配
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function StatusBadge({ isStub }: { isStub: boolean }) {
  const tone = isStub
    ? 'bg-warning/15 text-warning border-warning/30'
    : 'bg-success/15 text-success border-success/30';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${tone}`}>
      {isStub ? '部分' : '可用'}
    </span>
  );
}