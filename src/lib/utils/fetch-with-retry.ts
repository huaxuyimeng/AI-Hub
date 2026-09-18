/**
 * 带重试和退避的 fetch 工具（P1-6 修复）
 * 
 * 来源：报告 08 §3.3
 * 功能：
 *   1. 自动重试（默认 2 次）
 *   2. 指数退避（1s / 2s）
 *   3. 单源超时控制（默认 15s）
 *   4. 可配置的重试条件
 */

export interface FetchRetryOptions {
  /** 最大重试次数（默认 2） */
  maxRetries?: number
  /** 超时时间（毫秒，默认 15000） */
  timeoutMs?: number
  /** 退避基数（毫秒，默认 1500） */
  backoffMs?: number
  /** 判断是否可重试（默认全部重试） */
  retryable?: (err: Error) => boolean
}

/**
 * 带重试的 fetch
 * 
 * @param url 目标 URL
 * @param init fetch 参数
 * @param options 重试配置
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 2,
    timeoutMs = 15_000,
    backoffMs = 1500,
    retryable = () => true,
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      })
      clearTimeout(timer)

      // 成功响应
      if (res.ok) return res

      // 服务端错误 / 限流 → 重试
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`HTTP ${res.status}`)
      } else {
        // 客户端错误（4xx 但不是 429）→ 不重试
        return res
      }
    } catch (e) {
      clearTimeout(timer)
      lastError = e as Error
      if (!retryable(lastError)) throw lastError
    }

    // 退避等待（最后一次不等待）
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)))
    }
  }

  throw lastError ?? new Error('fetchWithRetry: max retries reached')
}
