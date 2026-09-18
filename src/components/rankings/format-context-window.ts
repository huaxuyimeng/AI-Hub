/**
 * tokens 数字格式化工具（Batch 6 共享）
 * 把 128000 / 200000 / 1000000 / 2000000 等格式化成"128K / 200K / 1M / 2M"
 *
 * 用于：
 *   - RankingsTable 列（src/components/rankings/RankingsTable.tsx）
 *   - 模型详情页徽章（src/app/(app)/rankings/[id]/page.tsx）
 *
 * 设计原则：本地纯函数，零依赖，可单测
 */
export function formatContextWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '—';
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 0 })}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}
