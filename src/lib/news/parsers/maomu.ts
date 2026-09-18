/**
 * 猫目 (maomu.com) 专用 HTML 解析器
 *
 * 页面结构：
 *   <script id="__NUXT_DATA__" type="application/json">[...]</script>
 *   NUXT_DATA 是 Vue Nuxt 的紧凑序列化格式，数组索引引用模式。
 *
 * 数据导航：
 *   [4] = { hotList:5, list:62, total:152 }
 *   [5] = [6,15,21,27,33,...]   ← 热点列表索引
 *   [62] = [63,74,83,92,...]     ← 普通列表索引
 *   每条新闻：{ cover, publishedAt, publishedAtDate, publishedAtTs,
 *                sid, sourceLink, sourceName, subtitle, title, type, views }
 *
 * AI 关键词过滤：
 *   用户要求：只有标题/摘要含 AI 相关关键词才入库。
 *   过滤词表：ai、agent、智能体、模型、llm、gpt、claude、gemini、
 *             deepseek、qwen、kimi、通义、讯飞、具身、机器人、大模型、
 *             人工智能、多模态、算力、芯片、hugging、openai、anthropic 等
 *
 * 注意：maomu.com 聚合的是多个来源的内容，sourceLink 即原始来源 URL。
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText, parseError, type SourceFetchOutcome } from './types';

const SOURCE_NAME = '猫目';
const PAGE_URL = 'https://maomu.com/news';

// AI 关键词（必须含其一才能入库，过滤掉无AI相关内容）—— BUG-021 去重
const AI_KEYWORDS = /\b(ai|agent|智能体|模型|llm|gpt|claude|gemini|deepseek|qwen|kimi|通义|讯飞|具身|机器人|大模型|人工智能|多模态|算力|芯片|hugging|openai|anthropic|xai|aigc|agentic|机器狗|机器臂|机械臂|自动驾驶|强化学习|微调|对齐|transformer|nlp|rlhf|token|embedding|向量数据库|扩散模型|diffusion|生成式|train|infer|rAG|rag)\b/i;

/**
 * 解析相对时间字符串如 "6天前"、"1天前"、"8小时前"、"16:53"
 * "16:53" 表示今天的时间（HH:MM 格式）
 */
function parseRelativeTime(timeStr: string): Date | null {
  if (!timeStr) return null;

  const now = new Date();
  const cnMatch = timeStr.match(/^(\d+)天前$/);
  if (cnMatch) {
    const days = parseInt(cnMatch[1], 10);
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  const hoursMatch = timeStr.match(/^(\d+)小时前$/);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10);
    const d = new Date(now);
    d.setHours(d.getHours() - hours);
    return d;
  }

  const minutesMatch = timeStr.match(/^(\d+)分钟前$/);
  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1], 10);
    const d = new Date(now);
    d.setMinutes(d.getMinutes() - minutes);
    return d;
  }

  // "16:53" → 今天 HH:MM
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const d = new Date(now);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  return null;
}

/**
 * 从 NUXT_DATA 数组中提取指定索引引用的值
 */
function resolveRef(data: unknown[], ref: unknown): unknown {
  return typeof ref === 'number' && ref >= 0 && ref < data.length ? data[ref] : ref;
}

/**
 * 抓取并解析猫目新闻
 */
export async function fetchMaomuNews(): Promise<SourceFetchOutcome> {
  try {
    const res = await fetchWithRetry(
      PAGE_URL,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIHub-Bot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      { maxRetries: 2, timeoutMs: 20_000 },
    );

    if (!res.ok) {
      return { items: [], error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // 提取 NUXT_DATA
    const nuxtMatch = html.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!nuxtMatch) {
      return { items: [], error: 'NUXT_DATA not found in page' };
    }

    // B-10 修复：NUXT_DATA 内容若非法 JSON，捕获后降级返回 items:[] 而非整函数抛错。
    let nuxtData: unknown[];
    try {
      nuxtData = JSON.parse(nuxtMatch[1]) as unknown[];
    } catch (e) {
      console.warn('[maomu] NUXT_DATA 不是合法 JSON，降级为空：', e);
      return { items: [], error: 'NUXT_DATA malformed JSON' };
    }

    // 导航数据结构
    const listObj = resolveRef(nuxtData, 4) as Record<string, unknown>;
    if (!listObj || typeof listObj !== 'object') {
      return { items: [], error: 'Invalid NUXT_DATA structure' };
    }

    const hotListRefs = resolveRef(nuxtData, 5) as number[];
    const listItemRefs = resolveRef(nuxtData, listObj['list'] as number) as number[];

    const allIndices = [
      ...(Array.isArray(hotListRefs) ? hotListRefs : []),
      ...(Array.isArray(listItemRefs) ? listItemRefs : []),
    ];

    const items: SourceFetchOutcome['items'] = [];

    for (const idx of allIndices) {
      const itemData = resolveRef(nuxtData, idx) as Record<string, unknown>;
      if (!itemData || typeof itemData !== 'object') continue;

      const title = String(resolveRef(nuxtData, itemData['title'] as number) ?? '');
      const sourceLink = String(resolveRef(nuxtData, itemData['sourceLink'] as number) ?? '');
      const publishedAtRaw = String(resolveRef(nuxtData, itemData['publishedAt'] as number) ?? '');
      const subtitle = String(resolveRef(nuxtData, itemData['subtitle'] as number) ?? '');
      const coverRaw = resolveRef(nuxtData, itemData['cover'] as number);
      const sourceNameRaw = resolveRef(nuxtData, itemData['sourceName'] as number);

      if (!title || title.length < 5) continue;

      // AI 关键词过滤：标题必须含 AI 关键词
      if (!AI_KEYWORDS.test(title)) {
        // 标题没有 AI 关键词，看看摘要
        if (!subtitle || !AI_KEYWORDS.test(subtitle)) {
          // 标题和摘要都没有，跳过
          continue;
        }
      }

      const publishedAt = parseRelativeTime(publishedAtRaw) ?? null;
      const coverUrl = coverRaw && typeof coverRaw === 'string' && coverRaw.length > 0 ? coverRaw : undefined;
      const sourceLabel = sourceNameRaw && typeof sourceNameRaw === 'string' && sourceNameRaw.length > 0
        ? `猫目·${sourceNameRaw}`
        : SOURCE_NAME;

      // 清理摘要中的 HTML
      const summary = subtitle ? cleanText(subtitle).slice(0, 500) : undefined;

      items.push({
        title: cleanText(title),
        url: sourceLink || `https://maomu.com/news`,
        summary,
        publishedAt,
        publishPrecision: publishedAt ? 'day' : null,
        crawledAt: new Date(),
        sourceName: sourceLabel,
        coverUrl,
      });
    }

    return { items };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}
