/**
 * 解析器统一派发
 *
 * 来源：archived/04-新闻聚合爬虫-深度诊断.md §P0-2 末尾"架构"
 * 目标：每个解析器独立可测；一个站改版只影响它自己
 *
 * 用法：service.ts 通过 fetchFromSource / 类型自动匹配调用对应 parser
 */

export { parseRssXml } from './rss';
export { fetchHtml } from './html';
export { fetchHackerNews } from './hacker-news';
export { fetchAitntPage, AITNT_SOURCES } from './aitnt';
export { fetchTmtpostNews } from './tmtpost';
export { fetchAibotDailyNews } from './ai-bot-daily';
export { fetchMaomuNews } from './maomu';
export { fetchAibaseNews } from './aibase';
export { fetchUniteAiNews } from './unite-ai';
export { fetchWechatArticle, isWechatArticleUrl } from './wechat-mp';
export type { FetchedItem, SourceFetchOutcome } from './types';
export { extractTag, cleanText, parseError } from './types';