/**
 * 排行榜表格组件
 */

import Link from 'next/link';
import { formatContextWindow } from './format-context-window';

interface RankingRow {
  id: string;
  externalId: string;
  name: string;
  provider: string;
  rank: number;
  valueScore: number;
  blendPrice: number;
  priceInput: number;
  priceOutput: number;
  intelligence: number | null;
  speed: number | null;
  contextWindow: number | null; // Batch 6
  isPending: boolean;
  isExcluded: boolean;
  excludeReason?: string | null;
}

interface RankingsTableProps {
  models: RankingRow[];
  loading?: boolean;
}

export function RankingsTable({ models, loading }: RankingsTableProps) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-12 text-center text-sm text-muted-foreground">
        暂无模型数据
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      {/* H-28 修复：补充 <caption> 以便屏幕阅读器读出表格用途（a11y） */}
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">AI 模型性价比排行表，共 {models.length} 条记录</caption>
        <thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium">排名</th>
            <th className="px-4 py-3 text-left font-medium">模型</th>
            <th className="px-4 py-3 text-left font-medium">厂商</th>
            <th className="px-4 py-3 text-right font-medium">性价比</th>
            <th className="hidden md:table-cell px-4 py-3 text-right font-medium">输入价</th>
            <th className="hidden md:table-cell px-4 py-3 text-right font-medium">输出价</th>
            <th className="hidden md:table-cell px-4 py-3 text-right font-medium">能力分</th>
            <th className="hidden md:table-cell px-4 py-3 text-right font-medium">速度</th>
            <th className="hidden md:table-cell px-4 py-3 text-right font-medium">上下文</th>
            <th className="px-4 py-3 text-center font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} className="border-b last:border-0 transition hover:bg-muted/30">
              <td className="px-4 py-3">
                <span className="font-mono tabular-nums">
                  {m.isExcluded ? '—' : `#${m.rank}`}
                </span>
              </td>
              <td className="px-4 py-3">
                <Link href={`/rankings/${m.id}`} className="font-medium hover:text-primary hover:underline">
                  {m.name}
                </Link>
                {m.isExcluded && m.excludeReason && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{m.excludeReason}</div>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{m.provider}</td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">
                {m.valueScore > 0 ? m.valueScore.toFixed(1) : '—'}
              </td>
              <td className="hidden md:table-cell px-4 py-3 text-right font-mono tabular-nums text-xs">
                ${m.priceInput.toFixed(2)}
              </td>
              <td className="hidden md:table-cell px-4 py-3 text-right font-mono tabular-nums text-xs">
                ${m.priceOutput.toFixed(2)}
              </td>
              <td className="hidden md:table-cell px-4 py-3 text-right font-mono tabular-nums text-xs">
                {m.intelligence ?? '—'}
              </td>
              <td className="hidden md:table-cell px-4 py-3 text-right font-mono tabular-nums text-xs">
                {m.speed ?? '—'}
              </td>
              <td className="hidden md:table-cell px-4 py-3 text-right font-mono tabular-nums text-xs">
                {m.contextWindow ? formatContextWindow(m.contextWindow) : '—'}
              </td>
              <td className="px-4 py-3 text-center">
                {m.isPending ? (
                  <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] text-warning">
                    待验证
                  </span>
                ) : (
                  <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] text-success">
                    已验证
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}