/**
 * Artificial Analysis 静态数据集（Batch 8）
 *
 * 来源：landing/tools/fetch-aa-rankings.mjs 抓取的 JSON
 * 文件：landing/assets/data/aa-rankings.json
 * 抓取时间：见 AA_FETCHED_AT（自动嵌入）
 *
 * 为什么用静态而不是 HTTP 抓：
 *   1. AA 官方**没有公开 REST API**（landing 脚本爬的是 Next.js RSC 载荷）
 *   2. 站点首页只展示 Top ~11 模型，是**首页图表口径**
 *   3. HTTP 实时抓：Vercel function 10s 超时 + 风控风险 + 304 缓存不可控
 *   4. 静态化后可走 CDN、Vercel Edge Cache、build-time 校验
 *
 * 怎么更新：
 *   node landing/tools/fetch-aa-rankings.mjs  # 生成新 JSON
 *   cp landing/assets/data/aa-rankings.json src/lib/rankings/aa-static-data.json
 *   node scripts/regen-aa-static-data.mjs    # 自动转成 TS（可写脚本，本次手工转）
 *
 * 映射规则：
 *   - AA label 标准化成 lowercase-kebab，匹配 AIHub externalId
 *   - 例："Claude Fable 5.1" → "claude-fable-5"（去空格 + 简化）
 *   - 例："GPT-6 Astra (max)" → "gpt-6-astra"
 *   - 例："DeepSeek V4.1 Flash (max)" → "deepseek-v4.1-flash"
 *
 * 设计：导出**标准化后的** key → 数据，scraper 直接 lookup 即可
 */

import aaRawJson from './aa-static-data.json';

interface AAItem {
  label: string;
  value: number;
  url: string | null;
}

interface AAChart {
  key: string;
  label: string;
  unit: string;
  order: 'asc' | 'desc';
  items: AAItem[];
}

interface AARawJson {
  source: string;
  sourceUrl: string;
  methodology: string;
  fetchedAt: string;
  note: string;
  charts: AAChart[];
}

const AA_DATA = aaRawJson as AARawJson;

/** 数据抓取时间（ISO 字符串）—— 用于 UI 显示「数据更新于 X」 */
export const AA_FETCHED_AT = AA_DATA.fetchedAt;

/** 数据源声明（给 UI 显示） */
export const AA_SOURCE = {
  name: AA_DATA.source,
  url: AA_DATA.sourceUrl,
  methodology: AA_DATA.methodology,
  note: AA_DATA.note,
};

/** label → externalId 标准化映射 */
function normalizeLabelToExternalId(label: string): string {
  let s = label.toLowerCase().trim();

  // 去掉括号后缀：(max), (high), (max with fallback)
  s = s.replace(/\s*\((max|high|low|max with fallback)([^)]*)\)\s*$/i, '');

  // 通用转换：空格 → 连字符，去掉尾部 ".x" 后的版本号（保留如 "4.1" / "5.6"）
  s = s.replace(/\s+/g, '-');

  // 厂商前缀归一
  s = s.replace(/^claude-/, 'claude-');
  s = s.replace(/^gpt-/, 'gpt-');
  s = s.replace(/^gemini-/, 'gemini-');

  // 特定映射（人工覆盖）
  const SPECIFIC_MAP: Record<string, string> = {
    'claude-fable-5.1': 'claude-fable-5',          // AIHub 用 fable-5，AA 用 5.1
    'claude-fable-5': 'claude-fable-5',
    'claude-opus-5': 'claude-opus-5',
    'claude-sonnet-5': 'claude-sonnet-5',
    'claude-haiku-4.5': 'claude-haiku-4.5',
    'claude-haiku-4.5-thinking': 'claude-haiku-4.5',
    'gpt-6-astra': 'gpt-6-astra',
    'gpt-5.6-luna': 'gpt-5.6-luna',
    'deepseek-v4.1-flash': 'deepseek-v4-pro',     // 用户已合并 deepseek-flash → deepseek-v4-pro
    'deepseek-v4-pro-0813': 'deepseek-v4-pro',
    'gemini-3.8-flash': 'gemini-3.8-flash',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'grok-4.6': 'grok-4.6',
    'grok-4.5': 'grok-4.5',
    'kimi-k3': 'kimi-k3',
    'glm-5.3': 'glm-5.3',
    'muse-spark-1.3': 'muse-spark-1',
  };

  if (SPECIFIC_MAP[s]) return SPECIFIC_MAP[s];
  return s;
}

/** 内部：按 externalId 索引的 AA 数据 */
const INDEXED_AA_DATA: Record<string, {
  intelligence?: number;
  speed?: number;
  costPerTask?: number;
  label: string;
  url: string | null;
}> = {};

(function buildIndex() {
  for (const chart of AA_DATA.charts) {
    for (const item of chart.items) {
      const extId = normalizeLabelToExternalId(item.label);
      if (!INDEXED_AA_DATA[extId]) {
        INDEXED_AA_DATA[extId] = { label: item.label, url: item.url };
      }
      const slot = INDEXED_AA_DATA[extId];
      if (chart.key === 'artificialAnalysisIntelligenceIndex') {
        slot.intelligence = item.value;
      } else if (chart.key === 'medianOutputSpeed') {
        slot.speed = item.value;
      } else if (chart.key === 'costPerIntelligenceIndexTask') {
        slot.costPerTask = item.value;
      }
    }
  }
})();

/**
 * 公开：按 externalId 查询 AA 数据
 * @param externalId AIHub 标准 ID（如 "deepseek-flash"）
 * @returns 找到则返回数据；找不到则 null（让调用方走兜底）
 */
export function lookupAAData(externalId: string): {
  intelligence?: number;
  speed?: number;
  costPerTask?: number;
  label: string;
  url: string | null;
} | null {
  return INDEXED_AA_DATA[externalId] ?? null;
}

/** 调试用：导出全部已索引的 key（生产代码不要用） */
export function _debugListKeys(): string[] {
  return Object.keys(INDEXED_AA_DATA);
}
