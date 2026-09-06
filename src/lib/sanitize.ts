/**
 * 错误信息脱敏工具（统一在 src/lib/sanitize.ts）
 *
 * 用途：清除错误信息中可能包含的 API key / Token / 内部 URL，避免泄漏给客户端。
 *
 * Provider key 前缀参考：
 *   - DeepSeek:  sk-...
 *   - Zhipu:     AKLT...（部分已知）
 *   - OpenAI:    sk-...
 *   - Anthropic: sk-ant-...
 *   - Gemini:    AIza...
 *   - xAI:       xai-...
 *   - Qwen:      sk-...
 *   - Hunyuan:   sk-...
 *
 * 安全策略：
 *   1. 精确前缀：命中已知前缀 → 整段 redact（高置信度）
 *   2. 上下文敏感：仅在 api_key/access_token/authorization 关键词附近 redact 长 base64（避免误杀）
 *   3. Bearer 头、Bearer Token、GitLab token 等已知格式
 *   4. 长连续数字（≥20 位）
 *
 * @example
 *   sanitizeError('OpenAI call failed: sk-proj-abc123456789...')
 *   // => 'OpenAI call failed: sk-***REDACTED***'
 */
export function sanitizeError(raw: string): string {
  if (!raw) return '';

  // 1. 已知前缀（高置信度，整段 redact）
  let safe = raw
    .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, 'sk-ant-***REDACTED***')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***REDACTED***')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'AIza***REDACTED***')
    .replace(/xai-[A-Za-z0-9_-]{20,}/g, 'xai-***REDACTED***')
    .replace(/AKLT[a-zA-Z0-9_-]{20,}/g, 'AKLT***REDACTED***')
    .replace(/Bearer\s+[A-Za-z0-9_.-]{20,}/gi, 'Bearer ***REDACTED***')
    .replace(/glpat-[A-Za-z0-9_-]{20,}/g, 'glpat-***REDACTED***');

  // 2. 上下文敏感 redact：仅当长 base64 在敏感关键词附近时才 redact
  const contextRegex = /(api[_-]?key|access[_-]?token|secret[_-]?key|authorization)["':=\s]+([A-Za-z0-9+/_-]{40,})/gi;
  safe = safe.replace(contextRegex, (_, kw, _val) => `${kw}: ***REDACTED***`);

  // 3. 长连续数字
  safe = safe.replace(/\b(\d{20,})\b/g, '***NUM***');

  return safe;
}

// ─── Project public view ─────────────────────────────────────────────────────

/**
 * 把内部 Project 转为对外暴露的形态（去除敏感字段）
 *
 * @param p 数据库 Project 记录
 * @returns 公开发布形态
 */
/**
 * 把内部 Project 转为对外暴露的形态（去除敏感字段）。
 *
 * 设计：返回**默认对象**而非 null，让前端可以无脑访问字段。
 * 输入非法时返回最小占位对象（id 为空），前端仍可正常展示。
 */
export interface PublicProject {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  visibility: string;
  latestScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const EMPTY_PROJECT: PublicProject = {
  id: '',
  name: '',
  slug: null,
  description: null,
  visibility: 'private',
  latestScore: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

export function toPublicProject(p: unknown): PublicProject {
  if (!p || typeof p !== 'object') return { ...EMPTY_PROJECT };
  const obj = p as Record<string, unknown>;
  const score = obj.latestScore;
  return {
    id: String(obj.id ?? ''),
    // BUG-28 修复（2026-09-06）：不再返回 tenantId，避免泄露租户标识给客户端
    name: String(obj.name ?? ''),
    slug: obj.slug == null ? null : String(obj.slug),
    description: obj.description == null ? null : String(obj.description),
    visibility: String(obj.visibility ?? 'private'),
    latestScore: typeof score === 'number' ? score : score == null ? null : Number(score),
    createdAt: obj.createdAt instanceof Date ? obj.createdAt : new Date(String(obj.createdAt ?? Date.now())),
    updatedAt: obj.updatedAt instanceof Date ? obj.updatedAt : new Date(String(obj.updatedAt ?? Date.now())),
  };
}
