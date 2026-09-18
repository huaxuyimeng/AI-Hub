/**
 * AI 早报 — 信源白名单（独立信源判定）
 *
 * 核心思路：参考 ai-news-kit `docs/03-置信度评级规则.md` 的硬规则——
 * 「转载数量 ≠ 独立信源数量」。
 *
 * 来源字段：tier
 * - tier 1：一手官方信源（公司官网 / arXiv / 监管文件）—— 1 份材料可独立撑起 B 级
 * - tier 2：可信报道（自己采访 / 独立核验过的媒体）
 * - tier 3：聚合 / 转载 / 索引站 —— 不算独立信源
 *
 * 同 tier 内不同信源算独立（默认）
 * 同 tier 同主体（如「量子位」和「量子位早知道」）算 1 个
 * tier 3 互相之间不算独立（转载链）
 *
 * 来源：参考 `D:\1Money\AI新闻\ai-news-kit\docs\03-置信度评级规则.md` § 二「独立信源」
 */

export type SourceTier = 1 | 2 | 3;

/**
 * 信源白名单（手动维护，6+ 个核心源）
 *
 * 注意：本表与 Prisma `NewsSource.name` 字段对应。新增源请：
 * 1. 在此表加 tier
 * 2. 在 `notes` 字段说明分类依据
 */
export interface SourceEntry {
  /** 与 NewsSource.name 匹配（精确匹配，case-insensitive） */
  name: string;
  tier: SourceTier;
  /** 主体（同主体多个栏目合并）—— 用于「同源转载不算独立」 */
  group: string;
  /** 备注（人工核验依据） */
  notes?: string;
}

/**
 * 6+ 核心源白名单
 *
 * 来源依据：
 * - tier 1（官方一手）：Anthropic 官方博客 / DeepSeek 官方 / arXiv
 * - tier 2（独立报道）：量子位（独立采访） / 36Kr AI / TechCrunch AI / MIT TR
 * - tier 3（聚合 / 转载）：AITNT / AIBot / HackerNews（聚合 + 转载）
 */
export const SOURCE_TIERS: SourceEntry[] = [
  // ────────────────────────────────────────────
  // tier 1：一手官方（可独立撑 B 级）
  // ────────────────────────────────────────────
  { name: 'Anthropic News',         tier: 1, group: 'anthropic', notes: '官方博客，论文、公告直接发布' },
  { name: 'OpenAI Blog',            tier: 1, group: 'openai',    notes: '官方博客' },
  { name: 'DeepMind Blog',          tier: 1, group: 'deepmind',  notes: '官方博客' },
  { name: 'DeepSeek Blog',          tier: 1, group: 'deepseek',  notes: '官方博客' },
  { name: 'arXiv AI',               tier: 1, group: 'arxiv',     notes: '一手论文预印本' },
  { name: 'Hugging Face Blog',      tier: 1, group: 'huggingface', notes: '官方博客' },

  // ────────────────────────────────────────────
  // tier 2：独立报道
  // ────────────────────────────────────────────
  { name: '量子位',                 tier: 2, group: 'qbitai',    notes: '中文 AI 独立采访' },
  { name: '机器之心',               tier: 2, group: 'jiqizhixin', notes: '中文 AI 独立采访' },
  { name: '36Kr AI',                tier: 2, group: '36kr',      notes: '中文独立报道' },
  { name: 'InfoQ AI',               tier: 2, group: 'infoq',     notes: '中文技术深度报道' },
  { name: '极客公园',               tier: 2, group: 'geekpark',  notes: '中文综合科技' },
  { name: 'TechCrunch AI',          tier: 2, group: 'techcrunch', notes: '英文独立报道' },
  { name: 'MIT Technology Review AI', tier: 2, group: 'mit',      notes: '英文独立深度' },
  { name: 'The Verge AI',           tier: 2, group: 'verge',     notes: '英文独立报道' },

  // ────────────────────────────────────────────
  // tier 3：聚合 / 转载 / 索引（不算独立信源）
  // ────────────────────────────────────────────
  { name: 'AITNT 全球 AI 新闻',     tier: 3, group: 'aitnt',     notes: '聚合站，索引性质' },
  { name: 'AIBot',                  tier: 3, group: 'aibot',     notes: '聚合 + 转载' },
  { name: 'Hacker News',            tier: 3, group: 'hn',        notes: '社区聚合，单帖多源' },
  { name: '雷锋网',                 tier: 3, group: 'leiphone',  notes: '聚合转载性质' },
];

/**
 * 查找信源条目（name 不区分大小写）
 *
 * @returns 找到返回 entry，未找到返回 null（视为 tier 3 / 聚合性质）
 */
export function findSourceEntry(name: string): SourceEntry | null {
  const lower = name.toLowerCase();
  return SOURCE_TIERS.find(e => e.name.toLowerCase() === lower) ?? null;
}

/**
 * 判定一组来源是否含「一手官方材料」
 *
 * 规则：tier 1 任一即可（不论其他 tier 几）
 *
 * @param sources 来源名称列表
 * @returns 是否含一手官方
 */
export function hasPrimaryOfficial(sources: string[]): boolean {
  return sources.some(s => findSourceEntry(s)?.tier === 1);
}

/**
 * 计算「独立信源数」（核心算法）
 *
 * 规则（按 ai-news-kit 硬规则）：
 * 1. 同 group 算 1 个（同一媒体集团 / 同一官方账号）
 * 2. tier 3 互相之间不算独立（转载链）
 * 3. tier 1 / tier 2 各自算独立
 * 4. tier 1 + tier 2 同时存在可叠加
 *
 * @example
 * computeIndependentSources(['TechCrunch AI', 'AITNT 全球 AI 新闻', '量子位'])
 * // → 2（TechCrunch 是 tier 2，量子位是 tier 2，AITNT 是 tier 3 不算）
 *
 * @example
 * computeIndependentSources(['Anthropic News', '量子位'])
 * // → 2（tier 1 + tier 2）
 */
export function computeIndependentSources(sources: string[]): number {
  const groups = new Set<string>();
  let hasTier1 = false;
  let hasTier2 = false;

  for (const s of sources) {
    const entry = findSourceEntry(s);
    if (!entry) {
      // 未知源视为 tier 3（保守：不计独立）
      continue;
    }
    if (entry.tier === 3) continue; // tier 3 不算
    groups.add(`${entry.tier}:${entry.group}`);
    if (entry.tier === 1) hasTier1 = true;
    if (entry.tier === 2) hasTier2 = true;
  }

  return groups.size;
}

/**
 * 判定置信度等级（v2：基于白名单）
 *
 * 与旧版 `computeConfidenceLevel` 区别：
 * - 旧版用 `new Set(sources).size` → 把 tier 3 聚合站算成独立信源
 * - 新版按 tier + group 合并 → 转载 / 聚合 / 同集团不算独立
 *
 * @param sources 来源名称列表
 * @returns A / B / C / D
 */
export function computeConfidenceBySources(sources: string[]): 'A' | 'B' | 'C' | 'D' {
  const n = computeIndependentSources(sources);
  const hasPrimary = hasPrimaryOfficial(sources);

  if (n >= 3) return 'A';                    // ≥3 独立信源
  if (n === 2 || (n === 1 && hasPrimary)) return 'B'; // 2 独立 / 1 + 一手
  if (n >= 1) return 'C';                    // 单一信源（不算 tier 3）
  return 'D';                                // 全是 tier 3 或空
}
