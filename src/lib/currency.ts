// V-05: USD→CNY 汇率常量（前端展示用）。env 里的 USD_TO_CNY 是服务端权威值，
// 这里作为客户端默认值（NEXT_PUBLIC_ 前缀可在 .env.local 覆盖）。
//
// 整合 v3 §5.2：用量页改用统一金额格式化入口
//   - centsToCNY(cents)         → "¥12.34"
//   - centsToUSD(cents)         → "$0.1234"
//   - formatCents(cents, opts)  → "¥12.34 / $1.23"

export const USD_TO_CNY: number =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USD_TO_CNY
    ? Number(process.env.NEXT_PUBLIC_USD_TO_CNY)
    : 7.2) || 7.2;

/** 客户端调用：cents → CNY 元 */
export function centsToCNY(cents: number, rate = USD_TO_CNY): string {
  return `¥${((cents / 100) * rate).toFixed(2)}`;
}

/** 客户端调用：cents → USD（带 $ 前缀） */
export function centsToUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * 客户端调用：cents → 紧凑 USD（4 位小数）
 * 用法：明细表格、精确费用展示
 */
export function centsToUSDCompact(cents: number): string {
  return `$${(cents / 100).toFixed(4)}`;
}

/**
 * 客户端调用：cents → 同时显示 CNY + USD
 * 用法：单卡需要双货币时
 */
export function formatCents(cents: number, opts?: { rate?: number; compact?: boolean }): string {
  const rate = opts?.rate ?? USD_TO_CNY;
  return `${centsToCNY(cents, rate)} · ${opts?.compact ? centsToUSDCompact(cents) : centsToUSD(cents)}`;
}