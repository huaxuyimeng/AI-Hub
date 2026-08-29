'use client';

import { trpc } from '@/lib/trpc';
import { IconDownload, IconTrash, IconCheck } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';

export default function PluginsPage() {
  const utils = trpc.useUtils();
  const marketQ = trpc.plugin.marketList.useQuery();
  const installedQ = trpc.plugin.installedList.useQuery();
  const install = trpc.plugin.install.useMutation({ onSuccess: () => utils.plugin.installedList.invalidate() });
  const uninstall = trpc.plugin.uninstall.useMutation({ onSuccess: () => utils.plugin.installedList.invalidate() });

  const installedNames = new Set(installedQ.data?.map((i) => i.plugin.name) ?? []);

  return (
    <div className="flex-1 overflow-y-auto page-enter">
      <PageHeader title="插件" subtitle="扩展你的项目分析能力" />

      <div className="mx-auto max-w-5xl px-8 py-8">
        {/* 已安装 */}
        <section className="mb-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            已安装
          </h2>
          {installedQ.data?.length === 0 && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              还没安装任何插件
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {installedQ.data?.map((i) => (
              <div key={i.id} className="flex items-start justify-between rounded-lg border bg-card p-4">
                <div className="min-w-0">
                  <div className="font-medium">{i.plugin.displayName}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {i.plugin.description}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    by {i.plugin.author}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => uninstall.mutate({ installedId: i.id })}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="卸载"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* 市场 */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            插件市场
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {marketQ.data?.map((p) => {
              const installed = installedNames.has(p.name);
              return (
                <div key={p.id} className="rounded-lg border bg-card p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="font-medium">{p.displayName}</div>
                    {installed ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-xs text-success">
                        <IconCheck size={11} />
                        已安装
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => install.mutate({ pluginName: p.name })}
                        disabled={install.isPending}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        <IconDownload size={11} />
                        安装
                      </button>
                    )}
                  </div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{p.description}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.tags.split(',').map((t) => (
                      <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}