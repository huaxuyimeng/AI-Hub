/**
 * Top 3 领奖台组件
 */

import Link from 'next/link';

interface TopModel {
  id: string;
  externalId: string;
  name: string;
  provider: string;
  valueScore: number;
  priceInput: number;
  priceOutput: number;
  intelligence: number | null;
}

interface Top3PodiumProps {
  models: TopModel[];
}

const MEDAL_COLORS = [
  // 语义化奖牌色（oklch 在亮/暗模式下均有良好对比度）
  // 金色：黄-橙谱系  银色：蓝-灰谱系  铜色：橙-棕谱系
  'bg-amber-100/20 text-amber-400 border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-300',
  'bg-slate-300/20 text-slate-400 border-slate-400/40 dark:bg-slate-600/20 dark:text-slate-300',
  'bg-orange-300/20 text-orange-400 border-orange-400/40 dark:bg-orange-600/15 dark:text-orange-300',
];
const MEDAL_NAMES = ['冠军', '亚军', '季军'];

export function Top3Podium({ models }: Top3PodiumProps) {
  if (models.length === 0) return null;

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {models.map((m, i) => (
        <Link
          key={m.id}
          href={`/rankings/${m.id}`}
          className="group rounded-lg border bg-card p-4 transition hover:border-primary/50"
        >
          <div className="flex items-start justify-between">
            <span className={'rounded border px-2 py-0.5 text-xs font-medium ' + MEDAL_COLORS[i]}>
              {MEDAL_NAMES[i]}
            </span>
            <span className="text-2xl font-bold tabular-nums text-muted-foreground">
              {m.valueScore > 0 && m.intelligence != null ? m.valueScore.toFixed(1) : '—'}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold group-hover:text-primary">{m.name}</h3>
          <p className="text-xs text-muted-foreground">{m.provider}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">输入价</div>
              <div className="font-mono">
                {m.priceInput > 0 ? `$${m.priceInput.toFixed(2)}/M` : <span className="text-warning">待补</span>}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">能力分</div>
              <div className="font-mono">{m.intelligence ?? '—'}</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}