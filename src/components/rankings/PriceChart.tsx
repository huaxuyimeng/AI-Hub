/**
 * 价格 / 能力 / 速度走势图组件（Batch 7 升级）
 *
 * 改动（vs 旧版）：
 *   1. 30 天滚动窗口（自动过滤老快照）
 *   2. 4 个指标：input / output 价格 + intelligence + speed
 *   3. 波动预警：单次变化 > 10% 的数据点标红 + tooltip 提示
 *   4. 颜色统一：primary=输入 / secondary=输出 / accent=能力 / accentDark=速度
 */

'use client';

interface Snapshot {
  id: string;
  priceInput: number;
  priceOutput: number;
  intelligence: number | null;
  speed: number | null;
  source: string;
  snapshotAt: string;
}

interface PriceChartProps {
  snapshots: Snapshot[];
}

const WIDTH = 700;
const HEIGHT = 280;
const PADDING = { top: 20, right: 20, bottom: 40, left: 60 };
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** 价格变化超过此比例（10%）标记为"大幅波动" */
const PRICE_CHANGE_ALERT_THRESHOLD = 0.1;

export function PriceChart({ snapshots }: PriceChartProps) {
  // 1. 30 天滚动窗口过滤
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const recent = snapshots.filter((s) => new Date(s.snapshotAt).getTime() >= cutoff);

  if (recent.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-12 px-6 text-center text-sm">
        <p className="font-medium text-foreground">暂无近 30 天价格历史</p>
        <p className="mt-1 text-muted-foreground">
          {snapshots.length > 0
            ? `数据库中还有 ${snapshots.length} 条更早的快照，但已超过 30 天窗口。请等待 cron 追加新快照。`
            : '首次刷新后会记录第一条快照，cron 每天 06:00 自动更新 1 次。'}
        </p>
      </div>
    );
  }

  // 按时间升序
  const sorted = [...recent].sort((a, b) =>
    new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime()
  );

  if (sorted.length === 1) {
    const only = sorted[0];
    return (
      <div className="rounded-lg border bg-card py-10 px-6 text-center text-sm">
        <p className="font-medium text-foreground">仅 1 条快照，暂无法绘制走势</p>
        <p className="mt-2 text-muted-foreground">
          当前定价：
          <span className="mx-1 font-mono">输入 ${only.priceInput.toFixed(2)} /M</span>
          ·
          <span className="mx-1 font-mono">输出 ${only.priceOutput.toFixed(2)} /M</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          快照时间：{new Date(only.snapshotAt).toLocaleString()}（等待下次 cron 追加）
        </p>
      </div>
    );
  }

  // -------------------------
  // 价格 Y 轴（input / output）
  // -------------------------
  const allPrices = sorted.flatMap((s) => [s.priceInput, s.priceOutput]);
  const minPrice = Math.min(...allPrices, 0);
  const maxPrice = Math.max(...allPrices, 1);

  // -------------------------
  // 能力 / 速度 Y 轴（独立比例，因为单位不同）
  // -------------------------
  const intels = sorted.map((s) => s.intelligence).filter((v): v is number => v != null);
  const speeds = sorted.map((s) => s.speed).filter((v): v is number => v != null);
  const minIntel = intels.length > 0 ? Math.min(...intels, 0) : 0;
  const maxIntel = intels.length > 0 ? Math.max(...intels, 100) : 100;
  const minSpeed = speeds.length > 0 ? Math.min(...speeds, 0) : 0;
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds, 10) : 10;

  // -------------------------
  // 时间 X 轴
  // -------------------------
  const startTime = new Date(sorted[0].snapshotAt).getTime();
  const endTime = new Date(sorted[sorted.length - 1].snapshotAt).getTime();
  const timeSpan = endTime - startTime || 1;

  const xScale = (iso: string) => {
    const t = new Date(iso).getTime();
    return PADDING.left + ((t - startTime) / timeSpan) * (WIDTH - PADDING.left - PADDING.right);
  };

  const yScalePrice = (price: number) => {
    return PADDING.top + (1 - (price - minPrice) / (maxPrice - minPrice || 1)) * (HEIGHT - PADDING.top - PADDING.bottom);
  };

  const yScaleIntel = (intel: number) => {
    return PADDING.top + (1 - (intel - minIntel) / (maxIntel - minIntel || 1)) * (HEIGHT - PADDING.top - PADDING.bottom);
  };

  const yScaleSpeed = (spd: number) => {
    return PADDING.top + (1 - (spd - minSpeed) / (maxSpeed - minSpeed || 1)) * (HEIGHT - PADDING.top - PADDING.bottom);
  };

  // 路径
  const inputPath = sorted.map((s) => `${xScale(s.snapshotAt)},${yScalePrice(s.priceInput)}`).join(' ');
  const outputPath = sorted.map((s) => `${xScale(s.snapshotAt)},${yScalePrice(s.priceOutput)}`).join(' ');
  const intelPath = intels.length > 1
    ? sorted.filter((s) => s.intelligence != null).map((s) => `${xScale(s.snapshotAt)},${yScaleIntel(s.intelligence!)}`).join(' ')
    : '';
  const speedPath = speeds.length > 1
    ? sorted.filter((s) => s.speed != null).map((s) => `${xScale(s.snapshotAt)},${yScaleSpeed(s.speed!)}`).join(' ')
    : '';

  // 检测价格变化预警（前一点 → 当前点）
  const priceChangeAlerts = new Map<string, { input?: number; output?: number }>();
  sorted.forEach((s, i) => {
    if (i === 0) return;
    const prev = sorted[i - 1];
    const alerts: { input?: number; output?: number } = {};
    if (prev.priceInput > 0) {
      const change = Math.abs((s.priceInput - prev.priceInput) / prev.priceInput);
      if (change >= PRICE_CHANGE_ALERT_THRESHOLD) alerts.input = change;
    }
    if (prev.priceOutput > 0) {
      const change = Math.abs((s.priceOutput - prev.priceOutput) / prev.priceOutput);
      if (change >= PRICE_CHANGE_ALERT_THRESHOLD) alerts.output = change;
    }
    if (alerts.input || alerts.output) {
      priceChangeAlerts.set(s.id, alerts);
    }
  });

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-primary" />
          输入价 ($/M)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-secondary" />
          输出价 ($/M)
        </span>
        {intels.length > 1 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded bg-accent" />
            能力分 (0-100)
          </span>
        )}
        {speeds.length > 1 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded bg-amber-600" />
            速度 (tokens/s)
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full">
        {/* Y 轴 - 价格 */}
        <line
          x1={PADDING.left}
          x2={PADDING.left}
          y1={PADDING.top}
          y2={HEIGHT - PADDING.bottom}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
        {[minPrice, (minPrice + maxPrice) / 2, maxPrice].map((p, i) => (
          <g key={i}>
            <text
              x={PADDING.left - 6}
              y={yScalePrice(p) + 4}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              ${p.toFixed(2)}
            </text>
          </g>
        ))}

        {/* X 轴 */}
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={HEIGHT - PADDING.bottom}
          y2={HEIGHT - PADDING.bottom}
          stroke="currentColor"
          strokeOpacity={0.2}
        />

        {/* 输入价折线 */}
        <polyline
          points={inputPath}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
        />

        {/* 输出价折线 */}
        <polyline
          points={outputPath}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth={2}
          strokeOpacity={0.7}
        />

        {/* 能力分折线（独立比例） */}
        {intelPath && (
          <polyline
            points={intelPath}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            strokeOpacity={0.8}
          />
        )}

        {/* 速度折线（独立比例） */}
        {speedPath && (
          <polyline
            points={speedPath}
            fill="none"
            stroke="#D97706"
            strokeWidth={1.5}
            strokeDasharray="2 2"
            strokeOpacity={0.8}
          />
        )}

        {/* 数据点 */}
        {sorted.map((s) => {
          const alert = priceChangeAlerts.get(s.id);
          const alertColor = alert ? '#DC2626' : null;
          return (
            <g key={s.id}>
              <circle
                cx={xScale(s.snapshotAt)}
                cy={yScalePrice(s.priceInput)}
                r={alert?.input ? 5 : 3}
                fill={alertColor ?? 'hsl(var(--primary))'}
                stroke={alert?.input ? '#DC2626' : 'none'}
                strokeWidth={alert?.input ? 2 : 0}
              >
                <title>
                  {`输入 $${s.priceInput.toFixed(2)} (${new Date(s.snapshotAt).toLocaleDateString()})`}
                  {alert?.input ? `\n⚠️ 价格大幅波动 (${(alert.input * 100).toFixed(1)}%)` : ''}
                </title>
              </circle>
              <circle
                cx={xScale(s.snapshotAt)}
                cy={yScalePrice(s.priceOutput)}
                r={alert?.output ? 5 : 3}
                fill={alertColor ?? 'hsl(var(--secondary))'}
                stroke={alert?.output ? '#DC2626' : 'none'}
                strokeWidth={alert?.output ? 2 : 0}
              >
                <title>
                  {`输出 $${s.priceOutput.toFixed(2)} (${new Date(s.snapshotAt).toLocaleDateString()})`}
                  {alert?.output ? `\n⚠️ 价格大幅波动 (${(alert.output * 100).toFixed(1)}%)` : ''}
                </title>
              </circle>
            </g>
          );
        })}

        {/* 日期标签 */}
        <text
          x={PADDING.left}
          y={HEIGHT - 8}
          textAnchor="start"
          fontSize={10}
          fill="currentColor"
          opacity={0.6}
        >
          {new Date(sorted[0].snapshotAt).toLocaleDateString()}
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 8}
          textAnchor="end"
          fontSize={10}
          fill="currentColor"
          opacity={0.6}
        >
          {new Date(sorted[sorted.length - 1].snapshotAt).toLocaleDateString()}
        </text>

        {/* 30 天窗口右边界标线（如果数据跨过 30 天，显示当前 30 天窗口的右边界） */}
        {Date.now() > endTime + THIRTY_DAYS_MS && (
          <text
            x={WIDTH - PADDING.right}
            y={PADDING.top - 4}
            textAnchor="end"
            fontSize={9}
            fill="currentColor"
            opacity={0.4}
          >
            30 天窗口
          </text>
        )}
      </svg>

      {/* 警告条幅：如有波动 */}
      {priceChangeAlerts.size > 0 && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠️ 检测到 {priceChangeAlerts.size} 次价格大幅波动（单次变化 ≥ 10%），鼠标悬停红点查看详情
        </div>
      )}
    </div>
  );
}
