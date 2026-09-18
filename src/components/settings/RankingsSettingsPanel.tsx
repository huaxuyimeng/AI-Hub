'use client';

import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/toast';

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

export function RankingsSettingsPanel() {
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data: settings, isLoading } = trpc.preferences.getNewsSettings.useQuery();
  const updateMutation = trpc.preferences.updateNewsSettings.useMutation({
    onSuccess: () => {
      toast.success('设置已保存');
      utils.preferences.getNewsSettings.invalidate();
    },
  });

  if (isLoading) {
    return (
      <Section title="排行设置">
        <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
      </Section>
    );
  }

  const followedModels = settings?.followedModels ?? [];
  const threshold = settings?.priceAlertThreshold ?? null;

  return (
    <Section title="排行设置" subtitle="关注特定模型并设置价格预警">
      {/* 关注模型 */}
      <div className="mb-4 rounded-lg border bg-card p-5">
        <div className="text-sm font-medium mb-2">关注的模型</div>
        <p className="mb-3 text-xs text-muted-foreground">
          用逗号分隔多个模型 ID（如 gpt-4o, deepseek-flash）
        </p>
        <textarea
          value={followedModels.join(', ')}
          onChange={(e) => {
            const list = e.target.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
            updateMutation.mutate({ followedModels: list });
          }}
          placeholder="gpt-4o, deepseek-flash"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
          rows={2}
        />
      </div>

      {/* 价格预警 */}
      <div className="rounded-lg border bg-card p-5">
        <div className="text-sm font-medium mb-2">价格预警阈值</div>
        <p className="mb-3 text-xs text-muted-foreground">
          模型价格变动超过此百分比时通知（0 = 关闭）
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0} max={100} step={1}
            value={threshold ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseFloat(e.target.value) : null;
              updateMutation.mutate({ priceAlertThreshold: v });
            }}
            placeholder="例如 10"
            className="w-32 rounded-md border bg-background px-3 py-1.5 text-sm font-mono"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>
    </Section>
  );
}
