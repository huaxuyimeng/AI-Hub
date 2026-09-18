/**
 * 多模态事件融合（D-1 §5.2）
 *
 * 给定一个事件关键词（"Hy4 preview"、"Claude Sonnet 4.5" 等），找出所有相关：
 *   1. 新闻条目（NewsItem.title / summary）
 *   2. B 站视频（NewsItem.media.bvid + 缓存中的视频）
 *   3. 模型（Model 表，匹配 externalId / name / provider）
 *
 * 返回结构：{ news, videos, models, totalMatches }
 *
 * 用例：
 *   - "腾讯混元 Hy4 preview" → 新闻报道 + B 站 UP 主视频 + Model 表（若存在）
 *   - 用于新闻详情页右侧"相关视频"模块
 *
 * 参考：docs/06-B站与多模态-增量设计.md §5.2
 */

import { prismaBase as prisma } from '@/lib/db';

export interface FusedEvent {
  keyword: string;
  news: Array<{
    id: string;
    title: string;
    url: string;
    summary: string;
    publishedAt: Date | null;
    source: { name: string };
    /** 是否来自 B 站（media.kind === 'video'）*/
    isVideo: boolean;
    /** 若来自 B 站，附加视频元数据 */
    videoMeta?: {
      bvid: string;
      author: string;
      thumbnailUrl: string;
      durationSec: number;
    };
  }>;
  models: Array<{
    id: string;
    externalId: string;
    name: string;
    provider: string;
    description: string | null;
  }>;
  totalMatches: number;
}

/**
 * 融合事件：给定关键词，跨 NewsItem + Model 联合查询
 */
export async function fuseEvent(keyword: string): Promise<FusedEvent> {
  const trimmed = keyword.trim();
  if (trimmed.length < 2) {
    return { keyword: trimmed, news: [], models: [], totalMatches: 0 };
  }

  // 1. 新闻查询（标题/摘要/标签/相关模型）
  const newsRaw = await prisma.newsItem.findMany({
    where: {
      deletedAt: null,
      OR: [
        { title: { contains: trimmed } },
        { summary: { contains: trimmed } },
        { relatedModels: { contains: trimmed } },
        { companyTags: { contains: trimmed } },
      ],
    },
    include: { source: true },
    orderBy: { publishedAt: 'desc' },
    take: 30,
  });

  const news = newsRaw.map((n) => {
    const media = n.media as Array<{
      kind?: string;
      bvid?: string;
      author?: string;
      thumbnailUrl?: string;
      durationSec?: number;
    }> | null;
    const videoEntry = media?.find((m) => m.kind === 'video');
    return {
      id: n.id,
      title: n.title,
      url: n.url,
      summary: n.summary ?? '',
      publishedAt: n.publishedAt,
      source: { name: n.source.name },
      isVideo: !!videoEntry,
      videoMeta: videoEntry
        ? {
            bvid: videoEntry.bvid ?? '',
            author: videoEntry.author ?? '',
            thumbnailUrl: videoEntry.thumbnailUrl ?? '',
            durationSec: videoEntry.durationSec ?? 0,
          }
        : undefined,
    };
  });

  // 2. 模型查询（externalId / name / provider）
  const lower = trimmed.toLowerCase();
  const modelsRaw = await prisma.model.findMany({
    where: {
      deletedAt: null,
      OR: [
        { externalId: { contains: lower } },
        { name: { contains: trimmed } },
        { provider: { contains: trimmed } },
        { description: { contains: trimmed } },
      ],
    },
    take: 10,
  });

  const models = modelsRaw.map((m) => ({
    id: m.id,
    externalId: m.externalId,
    name: m.name,
    provider: m.provider,
    description: m.description,
  }));

  return {
    keyword: trimmed,
    news,
    models,
    totalMatches: news.length + models.length,
  };
}
