// B-01: tRPC / fetch 错误 → 用户友好文案
type TRPCError = {
  data?: { code?: string; message?: string };
  message?: string;
};

/** 将 API/网络错误转换为用户友好提示 */
export function formatError(err: unknown): string {
  if (isTRPCError(err)) {
    const code = err.data?.code;
    switch (code) {
      case 'UNAUTHORIZED': return '请先登录';
      case 'FORBIDDEN': return '权限不足';
      case 'NOT_FOUND': return '内容不存在';
      case 'CONFLICT': return err.data?.message ?? '数据冲突';
      case 'BAD_REQUEST': return err.data?.message ?? '参数错误';
      case 'INTERNAL_SERVER_ERROR': return '服务器异常，请重试';
      case 'TOO_MANY_REQUESTS': return '请求过于频繁，请稍后再试';
      default: return err.data?.message ?? err.message ?? '操作失败';
    }
  }
  if (err instanceof TypeError && err.message.includes('fetch')) {
    return '网络连接失败，请检查网络';
  }
  return err instanceof Error ? err.message : '未知错误';
}

function isTRPCError(err: unknown): err is TRPCError {
  return typeof err === 'object' && err !== null && 'data' in err;
}
