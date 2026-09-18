/**
 * 钛媒体 tmtpost.com/new 专用 HTML 解析器
 *
 * 页面结构：
 *   <div class="item" data-v-1e6cbff2>
 *     <a class="_left" href="...">          ← 文章链接 + 封面图
 *     <a class="_tit">                       ← 标题
 *     <a class="_des">                       ← 摘要
 *     <a class="newTime _time">· X分钟前</a> ← 相对时间（用当前时间换算）
 *
 * 特点：
 *   - 钛媒体资讯层次不齐，内容混杂（含大量非 AI 新闻）
 *   - 必须同时检测标题 + 摘要中的 AI 关键词才入池（用户明确要求）
 *   - 相对时间（"3小时前"）转换为近似发布时间
 */

import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import { cleanText, parseError, type SourceFetchOutcome } from './types';

/**
 * AI 关键词白名单（必须含其一才入池）
 * 覆盖：AI 模型/产品/技术关键词 + Agent/机器人类关键词
 * 排除过于通用的商业/财经词汇（机器人、上市公司 等不含 AI 前缀的）
 *
 * 注：原 /x 扩展正则模式已移除（ES2024 新增，SWC 暂不支持）。
 *     关键词统一写成单行字符串，避免多行歧义。
 */
const AI_KEYWORDS = /\b(ai|gpt|claude|gemini|llama|qwen|deepseek|大模型|具身|智能体|agent|copilot|训练|推理|anthropic|xai|hugging|人工智能|混元|kimi|ernie|文心|通义|盘古|智谱|百川|算力|多模态|机器学习|深度学习|神经网络|自然语言|nlp|llm|rlhf|微调|对齐|transformer|agi|coding|moe|aigc|midjourney|stable diffusion|runway|openai|sora|artificial intelligence|machine learning|小模型|端侧|端模型|编程|代码|机械臂|自动驾驶|robot|embodied|humanoid|人形)\b/i;

/** 提取 article block（item div） */
const ITEM_BLOCK_REGEX = /<div class="item"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;

/** 提取文章链接（优先外部 tmtpost.com 链接，降级取相对路径） */
const ARTICLE_LINK_REGEX = /<a[^>]+class="[^"]*_left[^"]*"[^>]+href=["']([^"']+)["']/i;

/** 提取封面图 */
const COVER_REGEX = /<a[^>]+class="[^"]*_left[^"]*"[^>]+>[\s\S]*?<img[^>]+src\s*=\s*(["'])([^"']+)\1/i;

/** 提取标题 */
const TITLE_REGEX = /<a[^>]+class="[^"]*_tit[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

/** 提取摘要 */
const SUMMARY_REGEX = /<a[^>]+class="[^"]*_des[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

/** 提取相对时间 */
const RELATIVE_TIME_REGEX = /([\d]+)\s*(分钟前|小时前|天前|小时前|分钟前)/;

function parseRelativeTime(text: string): Date | null {
  const match = text.match(/([\d]+)\s*(分钟前|小时前|天前)/);
  if (!match) return null;
  const amount = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();
  if (unit === '分钟前') return new Date(now.getTime() - amount * 60_000);
  if (unit === '小时前') return new Date(now.getTime() - amount * 3_600_000);
  if (unit === '天前') return new Date(now.getTime() - amount * 86_400_000);
  return null;
}

function hasAiKeyword(text: string): boolean {
  return AI_KEYWORDS.test(text.toLowerCase());
}

export async function fetchTmtpostNews(
  sourceName: string,
): Promise<SourceFetchOutcome> {
  const url = 'https://www.tmtpost.com/new';

  try {
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AIHub-Bot)',
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      { maxRetries: 2, timeoutMs: 20_000 },
    );

    if (!res.ok) {
      return { items: [], error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const items: SourceFetchOutcome['items'] = [];

    // 切分 item block（避免跨 item 污染）
    const rawBlocks = html.split(/<div class="item"/i).slice(1);

    for (const raw of rawBlocks) {
      // 在 item 范围内找（防止匹配到下一个 item 的内容）
      const block = '<div class="item"' + raw;
      const blockText = block; // 用于相对时间计算

      // 1) 链接
      const linkMatch = block.match(ARTICLE_LINK_REGEX);
      if (!linkMatch) continue;
      let articleUrl = linkMatch[1].trim();
      // 补全相对路径
      if (articleUrl.startsWith('/')) {
        articleUrl = `https://www.tmtpost.com${articleUrl}`;
      }
      // 过滤非 tmtpost.com 链接（只保留主站文章）
      if (!articleUrl.includes('tmtpost.com')) continue;

      // 2) 标题
      const titleMatch = block.match(TITLE_REGEX);
      if (!titleMatch) continue;
      const title = cleanText(titleMatch[1]);
      if (title.length < 10 || title.length > 120) continue;

      // 3) 摘要
      const summaryMatch = block.match(SUMMARY_REGEX);
      const rawSummary = summaryMatch ? cleanText(summaryMatch[1]) : '';
      const summary = rawSummary.length > 0 ? rawSummary.slice(0, 500) : undefined;

      // 4) AI 关键词过滤（必须标题或摘要含 AI 关键词）
      if (!hasAiKeyword(title) && !hasAiKeyword(rawSummary)) continue;

      // 5) 封面图
      const coverMatch = block.match(COVER_REGEX);
      const coverUrl = coverMatch ? coverMatch[2] : null;

      // 6) 相对时间
      const timeMatch = block.match(RELATIVE_TIME_REGEX);
      const publishedAt = timeMatch ? parseRelativeTime(block) : null;

      items.push({
        title,
        url: articleUrl,
        summary,
        coverUrl,
        publishedAt,
        publishPrecision: publishedAt ? 'hour' : null,
        crawledAt: new Date(),
        sourceName,
      });
    }

    return { items };
  } catch (err) {
    return { items: [], error: parseError(err) };
  }
}
