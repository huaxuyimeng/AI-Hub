/**
 * B 站新闻条目并入 NewsItem
 *
 * 流程：
 *   1. 找到/创建 "Bilibili UP 主" NewsSource
 *   2. 逐 UP 主 × 视频 × 新闻条目 upsert
 *   3. URL 格式：videoUrl#encodeURIComponent(newsTitle) → 用于天然去重
 *   4. media 字段填入视频元数据（用于 UI 标记"视频关联"）
 *
 * 注意：
 *   - B 站条目不关联 relatedModels（噪声大，会污染模型关联表）
 *   - confidence 默认 C（来源置信度低，AI 浓度不如专业媒体）
 *   - publishedAt = 视频上传时间，精确到秒
 *
 * 参考：docs/06-B站与多模态-增量设计.md §3.5
 */

import type { PrismaClient } from '@prisma/client';
import type { BiliData, BiliUP, BiliVideoWithNews } from './scraper';

export interface MergeResult {
  /** 新增条数 */
  inserted: number;
  /** 更新条数 */
  updated: number;
  /** 总尝试条数 */
  attempted: number;
}

/**
 * 把 B 站视频中的 news 条目并入 NewsItem
 */
export async function mergeBiliNewsIntoNewsItem(
  prisma: PrismaClient,
  data: BiliData,
): Promise<MergeResult> {
  // 1. 找或建 NewsSource
  const source = await prisma.newsSource.upsert({
    where: { name: 'Bilibili UP 主' },
    update: { lastFetchAt: new Date() },
    create: {
      name: 'Bilibili UP 主',
      url: 'https://space.bilibili.com',
      type: 'html',
      priority: 7,
      enabled: true,
      fragile: true, // B站风控频繁
      notes: 'B站 UP 主视频 → 文字版提取（迁移自 ai-news-daily）',
    },
  });

  let inserted = 0;
  let updated = 0;
  let attempted = 0;

  for (const up of data.ups) {
    for (const v of up.videos) {
      for (const n of v.news) {
        attempted++;
        const result = await upsertOne(prisma, source.id, up, v, n);
        if (result === 'created') inserted++;
        else if (result === 'updated') updated++;
      }
    }
  }

  return { inserted, updated, attempted };
}

async function upsertOne(
  prisma: PrismaClient,
  sourceId: string,
  up: BiliUP,
  v: BiliVideoWithNews,
  n: { title: string; summary: string; category: string },
): Promise<'created' | 'updated' | 'skipped'> {
  // URL 唯一标识 = 视频 URL + 标题 hash
  const itemUrl = `${v.url}#${encodeURIComponent(n.title.slice(0, 60))}`;

  // B-08 修复：findUnique 也带 deletedAt: null，防止已软删的同 URL 记录被重新插入（产生重复）。
  //          注意：newsItem schema 上没有 unique on url 字段，所以 findUnique 实际走 where: { url: itemUrl }。
  //          这里把判断改成 findFirst + deletedAt: null 更可靠。
  const existing = await prisma.newsItem.findFirst({
    where: { url: itemUrl, deletedAt: null },
    select: { id: true },
  });

  // 摘要前缀 [UP主名]
  const summary = n.summary ? `[${up.name}] ${n.summary}`.slice(0, 500) : `[${up.name}]`;

  const media = [
    {
      kind: 'video' as const,
      bvid: v.bvid,
      url: v.url,
      author: up.name,
      method: v.method,
      articleUrl: v.articleUrl,
      thumbnailUrl: v.thumbnailUrl,
      durationSec: v.duration,
    },
  ];

  const publishedAt = new Date(v.publishedAt * 1000);

  if (existing) {
    await prisma.newsItem.update({
      where: { id: existing.id },
      data: {
        summary,
        category: n.category,
        media: media as unknown as object,
      },
    });
    return 'updated';
  }

  await prisma.newsItem.create({
    data: {
      title: n.title,
      url: itemUrl,
      sourceId,
      summary,
      publishedAt,
      publishPrecision: 'exact',
      category: n.category,
      tags: `视频,${up.name}`,
      coverUrl: v.thumbnailUrl,
      media: media as unknown as object,
      confidence: 'C',
    },
  });
  return 'created';
}
