// V-05: USD→CNY 汇率常量（前端展示用）。env 里的 USD_TO_CNY 是服务端权威值，
// 这里作为客户端默认值（NEXT_PUBLIC_ 前缀可在 .env.local 覆盖）。
export const USD_TO_CNY: number =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USD_TO_CNY
    ? Number(process.env.NEXT_PUBLIC_USD_TO_CNY)
    : 7.2) || 7.2;

// 客户端调用：cents → CNY 元
export function centsToCNY(cents: number, rate = USD_TO_CNY): string {
  return `¥${((cents / 100) * rate).toFixed(2)}`;
}
