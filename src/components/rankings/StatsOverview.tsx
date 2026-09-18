/**
 * 排行统计概览组件
 */

interface Model {
  externalId: string;
  name: string;
  provider: string;
  priceInput: number;
  priceOutput: number;
  intelligence: number | null;
  isPending: boolean;
}

interface StatsOverviewProps {
  models: Model[];
}

export function StatsOverview({ models }: StatsOverviewProps) {
  const stats = {
    total: models.length,
    verified: models.filter((m) => !m.isPending).length,
    pending: models.filter((m) => m.isPending).length,
    avgPrice: models.length > 0
      ? models.reduce((sum, m) => sum + (m.priceInput * 0.7 + m.priceOutput * 0.3), 0) / models.length
      : 0,
    providers: new Set(models.map((m) => m.provider)).size,
  };

  const cards = [
    { label: '总模型数', value: stats.total },
    { label: '已验证', value: stats.verified, hint: stats.pending > 0 ? `${stats.pending} 个待验证` : undefined },
    { label: '厂商数', value: stats.providers },
    {
      label: '平均混合价',
      value: stats.avgPrice > 0 ? `$${stats.avgPrice.toFixed(2)}/M` : '—',
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{card.label}</div>
          <div className="mt-1 text-2xl font-semibold">{card.value}</div>
          {card.hint && (
            <div className="mt-0.5 text-[10px] text-warning">{card.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}