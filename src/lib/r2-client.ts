// 客户端的 R2 配置探针
// 不能直接 import 'server-only' 的 lib/env，客户端只关心三个变量是否都有非空值
// 这些值通过 next.config.js 的 public env 暴露

export function isR2ConfiguredClient(): boolean {
  if (typeof window === 'undefined') return false;
  // 通过 window.__AIHUB_CONFIG__ 暴露（R2 凭据绝不能暴露）
  const cfg = (window as unknown as { __AIHUB_R2_READY?: boolean }).__AIHUB_R2_READY;
  return Boolean(cfg);
}