/**
 * AI 早报 — 内容修复器（schema 校验前的容错层）
 * 路径：src/features/daily-briefing/lib/postprocess.ts
 *
 * 设计目的：LLM 输出经常违反 schema 严格约束（如 distribution 只有 3 个元素、
 *   independentSources=0、primaryLink 超长），改 prompt 治标不治本。
 *   这层在 schema parse 前自动补全/修正，让"LLM 偶尔出格"不影响最终输出。
 *
 * 修复规则（保守策略：只补全不破坏，不删除已有数据）：
 *   1. overview.distribution 必须 exactly 4 个（A/B/C/D），缺哪个补 count=0
 *   2. overview.confidenceLegend 必须 exactly 4 个（A/B/C/D），缺哪个补默认 label/rule
 *   3. items[].independentSources 若 ≤0 则改为 1（schema 要求 ≥1）
 *   4. verificationTable.rows[].primaryLink 若 >30 字符则截断到 27 + "…"
 *   5. trends 若 != 3 条则强制取前 3 / 重复最后一条补到 3
 *   6. tlDr 若 < 2 条则补默认文案（不应发生，prompt 要求 3 条）
 *   7. 跨字段一致性：以 items[].confidenceLevel 为准重算 overview.distribution，
 *      并同步 cover.stats 里的"条精选新闻"与"置信度分布"两张卡
 *      （实测 2026-09-13：LLM 给出的 cover=distribution 合计 11 条、items 实际 8 条，
 *       同一份内容出现 4 套互相矛盾的置信度数字，纯靠 prompt 约束不住）
 *   8. items[].summary 与 whyMatters 融合（仅 coding 方向）—— direction-detail 页
 *      只渲染 summary 不渲染 whyMatters，把 whyMatters 的核心句嵌入 summary 前缀，
 *      避免 249 字 whyMatters 被引擎静默丢掉（实测 2026-09-16）
 *
 * 不动：
 *   - items 数组长度（schema min(3).max(15)，不在 postprocess 范围）
 *   - primaryLinks（schema 没长度限制）
 *   - 任何字段的实际值（只补全缺失，不臆造）
 */
import type { DailyReportContent } from './types';
import { logger } from '@/lib/observability/logger';

const DEFAULT_CONFIDENCE_LEGEND: Record<'A' | 'B' | 'C' | 'D', { label: string; color: 'primary' | 'secondary' | 'accent'; rule: string }> = {
  A: { label: 'A 极高', color: 'primary', rule: '≥3 个相互独立的信源，且可追溯到一手官方材料' },
  B: { label: 'B 高',   color: 'primary', rule: '2 个独立信源，或 1 个信源 + 一手官方材料' },
  C: { label: 'C 中',   color: 'secondary', rule: '单一信源报道；含「多家转载同一家独家」（转载数量 ≠ 独立信源数量）' },
  D: { label: 'D 存疑', color: 'accent', rule: '关键数字互相矛盾，或全部可溯源到同一原始信源且无官方确认' },
};

const ALL_LEVELS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

const PRIMARY_LINK_MAX = 20; // 与 slide-engine verification page schema 保持一致

/**
 * 深度克隆 + 类型守卫：确保 input 是可安全操作的对象。
 * 完全非对象输入（string / number / null / undefined）直接返回空结构兜底，
 * 避免运行时 TypeError 或属性访问崩溃。
 */
function safeClone(input: unknown): Record<string, unknown> {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(input));
  } catch {
    return {};
  }
}

/** 主入口：先深度克隆防污染，再逐条修复 */
export function repairContent(input: DailyReportContent | Record<string, unknown>): DailyReportContent {
  const c = safeClone(input) as Record<string, unknown>;

  // 规则 7 的依据必须取自**原始输入**：
  // 下面的规则 3.6 会把缺失/非法的 confidenceLevel 一律改写成 'C'，
  // 之后再读 items 就分不清"LLM 说是 C"和"我们兜底成 C"了。
  const rawLevels: Array<'A' | 'B' | 'C' | 'D'> = (() => {
    const rawItems = (input as Record<string, unknown> | null | undefined)?.items;
    if (!Array.isArray(rawItems)) return [];
    return rawItems
      .map((it) => String((it as Record<string, unknown>)?.confidenceLevel ?? ''))
      .filter((lv): lv is 'A' | 'B' | 'C' | 'D' => (ALL_LEVELS as string[]).includes(lv));
  })();

  // 1. distribution 必须 4 个
  if (c.overview && typeof c.overview === 'object') {
    const overview = c.overview as Record<string, unknown>;
    if (Array.isArray(overview.distribution)) {
      const dist = overview.distribution as Array<Record<string, unknown>>;
      const have = new Set(dist.map((d) => String(d?.level ?? '')).filter(Boolean));
      overview.distribution = ALL_LEVELS.map(level => {
        const found = dist.find((d) => String(d?.level ?? '') === level);
        return found ?? { level, count: 0 };
      });
      void have;
    }

    // 2. confidenceLegend 必须 4 个
    if (Array.isArray(overview.confidenceLegend)) {
      const legend = overview.confidenceLegend as Array<Record<string, unknown>>;
      overview.confidenceLegend = ALL_LEVELS.map(level => {
        const found = legend.find((l) => String(l?.level ?? '') === level);
        if (found) return found;
        return { level, ...DEFAULT_CONFIDENCE_LEGEND[level] };
      });
    }

    // 6. tlDr 至少 2 条
    if (Array.isArray(overview.tlDr) && (overview.tlDr as unknown[]).length < 2) {
      const tl = overview.tlDr as string[];
      while (tl.length < 2) {
        tl.push('请查看下方原始新闻列表');
      }
    }
  }

  // 3. independentSources ≤0 → 1
  if (Array.isArray(c.items)) {
    c.items = (c.items as Array<Record<string, unknown>>).map((it) => {
      const n = Number(it?.independentSources);
      if (!Number.isFinite(n) || n < 1) {
        return { ...it, independentSources: 1 };
      }
      return it;
    });
  }

  // 3.5 authors[].status 必须是 'ok' | 'warn'
  if (Array.isArray(c.authors)) {
    c.authors = (c.authors as Array<Record<string, unknown>>).map((a) => {
      const s = a?.status;
      if (s !== 'ok' && s !== 'warn') {
        return { ...a, status: 'warn' as const };
      }
      return a;
    });
  }

  // 3.6 confidenceLevel / confidence 必须是 'A' | 'B' | 'C' | 'D'
  if (Array.isArray(c.items)) {
    c.items = (c.items as Array<Record<string, unknown>>).map((it) => {
      const cl = it?.confidenceLevel;
      if (!['A', 'B', 'C', 'D'].includes(cl as string)) {
        return { ...it, confidenceLevel: 'C' as const };
      }
      return it;
    });
  }
  if (c.verificationTable && typeof c.verificationTable === 'object') {
    const vt = c.verificationTable as Record<string, unknown>;
    if (Array.isArray(vt.rows)) {
      vt.rows = (vt.rows as Array<Record<string, unknown>>).map((r) => {
        const cf = r?.confidence;
        if (!['A', 'B', 'C', 'D'].includes(cf as string)) {
          return { ...r, confidence: 'C' as const };
        }
        return r;
      });
    }
  }

  // 3.7 sources.*[].url 必须是合法 url，否则用占位（避免 z.string().url() 抛错）
  const URL_PLACEHOLDER = 'https://example.com';
  const sanitizeUrl = (u: unknown): string => {
    if (typeof u !== 'string' || u.length === 0) return URL_PLACEHOLDER;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return URL_PLACEHOLDER;
      return u;
    } catch {
      return URL_PLACEHOLDER;
    }
  };
  if (c.sources && typeof c.sources === 'object') {
    const s = c.sources as Record<string, unknown>;
    for (const key of ['skills', 'videoAuthors', 'crossSources', 'officialLinks'] as const) {
      if (Array.isArray(s[key])) {
        s[key] = (s[key] as Array<Record<string, unknown>>).map((it) => ({ ...it, url: sanitizeUrl(it?.url) }));
      }
    }
  }
  if (Array.isArray(c.items)) {
    c.items = (c.items as Array<Record<string, unknown>>).map((it) => {
      if (!Array.isArray(it?.primaryLinks)) return it;
      const links = it.primaryLinks as Array<Record<string, unknown>>;
      return { ...it, primaryLinks: links.map((p) => ({ ...p, url: sanitizeUrl(p?.url) })) };
    });
  }

  // 8. items[].summary 与 whyMatters 融合（仅 coding 方向，超出 145 字截断）
  // 必须在规则 4（primaryLink 截断）之后执行：避免 summary 被改后影响其他字段
  if (Array.isArray(c.items)) {
    c.items = (c.items as Array<Record<string, unknown>>).map(mergeWhyMattersIntoSummary);
  }

  // 4. primaryLink 超长 → 截断（undefined / null 跳过）
  if (c.verificationTable && typeof c.verificationTable === 'object') {
    const vt = c.verificationTable as Record<string, unknown>;
    if (Array.isArray(vt.rows)) {
      vt.rows = (vt.rows as Array<Record<string, unknown>>).map((r) => {
        const pl = r?.primaryLink;
        if (typeof pl !== 'string') return r;
        if (pl.length > PRIMARY_LINK_MAX) {
          return { ...r, primaryLink: pl.slice(0, PRIMARY_LINK_MAX - 1) + '…' };
        }
        return r;
      });
    }
  }

  // 5. trends 必须 3 条
  if (Array.isArray(c.trends)) {
    if (c.trends.length === 0) {
      c.trends = [
        { rank: 1, title: '数据暂不可用', description: 'LLM 总结功能暂不可用' },
        { rank: 2, title: '数据暂不可用', description: 'LLM 总结功能暂不可用' },
        { rank: 3, title: '数据暂不可用', description: 'LLM 总结功能暂不可用' },
      ];
    } else if (c.trends.length < 3) {
      const last = c.trends[c.trends.length - 1] as Record<string, unknown>;
      while ((c.trends as unknown[]).length < 3) {
        c.trends.push({ rank: (c.trends as unknown[]).length + 1, title: last.title, description: last.description });
      }
    } else if (c.trends.length > 3) {
      c.trends = c.trends.slice(0, 3);
    }
  }

  // 7. 跨字段一致性：distribution 以 items[].confidenceLevel 为准重算，
  //    cover.stats 的"条数 / 置信度分布"卡同步（按 label 关键词匹配）
  //    注意：仅当原始输入里至少有一条带合法置信度时才重算 —— 否则说明 LLM 没给明细，
  //    无从核对，保留原值（也避免把内容清零）
  if (Array.isArray(c.items) && rawLevels.length > 0) {
    const items = c.items as Array<Record<string, unknown>>;
    const actual = { A: 0, B: 0, C: 0, D: 0 } as Record<(typeof ALL_LEVELS)[number], number>;
    for (const lv of rawLevels) actual[lv] += 1;

    const distText = ALL_LEVELS.filter((l) => actual[l] > 0).map((l) => `${l}${actual[l]}`).join('·');

    if (c.overview && typeof c.overview === 'object') {
      const overview = c.overview as Record<string, unknown>;
      if (Array.isArray(overview.distribution)) {
        const before = JSON.stringify(overview.distribution);
        const recomputed = ALL_LEVELS.map((level) => ({ level, count: actual[level] }));
        if (before !== JSON.stringify(recomputed)) {
          logger.warn('[briefing/postprocess] distribution 与 items 不一致，已按 items 重算', {
            before,
            after: JSON.stringify(recomputed),
          });
          overview.distribution = recomputed;
        }
      }
    }

    if (c.cover && typeof c.cover === 'object') {
      const cover = c.cover as Record<string, unknown>;
      if (Array.isArray(cover.stats)) {
        cover.stats = (cover.stats as Array<Record<string, unknown>>).map((s) => {
          const label = String(s?.label ?? '');
          if (label.includes('精选')) {
            return { ...s, value: String(items.length) };
          }
          if (label.includes('置信度分布')) {
            return { ...s, value: distText };
          }
          return s;
        });
      }
    }
  }

  return c as unknown as DailyReportContent;
}

/**
 * P1-PPT-1.4：把 whyMatters 的核心句嵌入 summary 前缀
 *
 * 背景：direction-detail 页只渲染 summary（不渲染 whyMatters），
 *   但生成侧经常写了 whyMatters 就把 summary 写得很短（150 字左右）。
 *   结果：whyMatters 的 249 字内容被引擎静默丢掉，页面右栏只有 summary 一段。
 *
 * 策略：
 *   - 只在 coding 方向处理（embodied / rumor 有各自 whyMatters 展示路径）
 *   - 取 whyMatters 第一句（中文句号/问号/感叹号 截断）作为 prefix
 *   - 拼到 summary 前，超出 145 字符则截断 summary
 *   - 若 whyMatters 为空或与 summary 重合度高，跳过融合
 */
const WHY_MATTERS_SPLIT = /[。！？!?]/;
const SUMMARY_MAX_CHARS = 145;
const SUMMARY_MIN_CHARS_FOR_MERGE = 50;

function pickFirstSentence(s: string): string {
  const idx = s.search(WHY_MATTERS_SPLIT);
  if (idx < 0) return s.trim();
  return s.slice(0, idx + 1).trim();
}

function jaccardCharSimple(a: string, b: string): number {
  const sa = new Set(a.replace(/\s+/g, ''));
  const sb = new Set(b.replace(/\s+/g, ''));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function mergeWhyMattersIntoSummary(item: Record<string, unknown>): Record<string, unknown> {
  const summary = String(item?.summary ?? '').trim();
  const whyMatters = String(item?.whyMatters ?? '').trim();
  const direction = String(item?.direction ?? '');

  // 仅 coding 方向融合；summary 太短（说明 whyMatters 是真正信息源）才动
  if (direction !== 'coding') return item;
  if (!whyMatters) return item;
  if (summary.length < SUMMARY_MIN_CHARS_FOR_MERGE) return item;
  if (summary.length >= SUMMARY_MAX_CHARS) return item;

  const firstSentence = pickFirstSentence(whyMatters);
  if (!firstSentence) return item;

  // 与现有 summary 重合度高 → 跳过（避免重复）
  if (jaccardCharSimple(firstSentence, summary) > 0.6) return item;

  const prefix = `💡${firstSentence} `;
  const merged = (prefix + summary).slice(0, SUMMARY_MAX_CHARS);
  return { ...item, summary: merged };
}
