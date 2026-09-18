/**
 * RAG 检索层（RAG-P1：项目知识库对话）
 *
 * 用途：让 chat 模块在调 LLM 前能检索项目私有数据（NewsItem / DailyReport / BilibiliCache），
 *       把检索结果拼到 system prompt，让 AI 回答时能引用具体新闻/数据。
 *
 * 适配 schema 现状（2026-09-16）：
 *   - NewsItem：无 tenantId 字段（通过 sourceId 软关联）
 *   - DailyReport：无 tenantId 字段（全局唯一 date，所有用户共享）
 *   - BilibiliCache：视频数据存在 ups JSON 字段里，不是扁平字段
 *
 * 设计：
 *   - 第一版：纯 SQL 全文搜索 + 元数据过滤（不引入向量数据库）
 *   - 多源可扩展：新增 SourceKind 即可加新源
 *   - 检索结果统一抽象为 Reference（来源、标题、摘要、时间、URL）
 */

import { prismaBase } from '@/lib/db';

// ============================================================================
// 类型定义
// ============================================================================

export type SourceKind = 'news' | 'briefing' | 'bilibili' | 'conversation';

export interface Reference {
  /** 来源类型 */
  kind: SourceKind;
  /** 主键 */
  id: string;
  /** 标题（用于 LLM 引用 + UI 展示） */
  title: string;
  /** 摘要（≤ 200 字，给 LLM 看） */
  snippet: string;
  /** 时间（ISO 字符串，用于排序 + 展示） */
  timestamp: string;
  /** 原始 URL（用于 UI 跳转） */
  url: string | null;
  /** 置信度（仅 news 有：A/B/C/D） */
  confidence?: string | null;
  /** 分类（仅 news 有：AI Coding / 具身智能 / AI政策） */
  category?: string | null;
}

export interface RetrieveQuery {
  /** 检索的关键词（用于对话历史的相关性匹配） */
  query: string;
  /** 要检索的源（默认全部） */
  sources?: SourceKind[];
  /** 时间窗口（天数，默认 30） */
  windowDays?: number;
  /** 单源最大返回数（默认 5，总数 = sources.length × 5） */
  maxPerSource?: number;
  /** 用户 ID（用于 conversation 源检索，必须与登录用户一致） */
  userId?: string;
  /** 当前对话 ID（用于 conversation 源检索，决定隔离/共享） */
  conversationId?: string;
}

export interface RetrieveResult {
  references: Reference[];
  /** 拼好的 LLM 上下文（system prompt 增量） */
  contextBlock: string;
  /** 检索耗时（ms） */
  durationMs: number;
}

// ============================================================================
// 单源检索实现
// ============================================================================

async function retrieveNews(q: RetrieveQuery): Promise<Reference[]> {
  const { query, windowDays = 30, maxPerSource = 5 } = q;
  const since = new Date(Date.now() - windowDays * 86400_000);

  // SQLite 用 LIKE + 时间窗口；上限 maxPerSource
  // 注意：NewsItem 没有 tenantId（CLAUDE.md 提到的多租户是 Project 等有 tenantId 的模型；
  //       NewsItem 是全局共享语料库）
  const rows = await prismaBase.newsItem.findMany({
    where: {
      deletedAt: null,
      crawledAt: { gte: since },
      OR: [
        { title: { contains: query } },
        { summary: { contains: query } },
        { content: { contains: query } },
        { tags: { contains: query } },
      ],
    },
    select: {
      id: true,
      title: true,
      summary: true,
      crawledAt: true,
      url: true,
      confidence: true,
      category: true,
      publishedAt: true,
    },
    orderBy: { crawledAt: 'desc' },
    take: maxPerSource,
  });

  return rows.map((r) => ({
    kind: 'news' as const,
    id: r.id,
    title: r.title,
    snippet: (r.summary ?? r.title ?? '').slice(0, 200),
    timestamp: (r.publishedAt ?? r.crawledAt).toISOString(),
    url: r.url,
    confidence: r.confidence,
    category: r.category,
  }));
}

async function retrieveBriefings(q: RetrieveQuery): Promise<Reference[]> {
  const { windowDays = 30, maxPerSource = 3 } = q;
  const sinceDate = new Date(Date.now() - windowDays * 86400_000);
  // date 字段是字符串 "YYYY-MM-DD"，比较用字符串
  const sinceStr = sinceDate.toISOString().slice(0, 10);

  // DailyReport 全局唯一，按 date 倒序取最近的
  const rows = await prismaBase.dailyReport.findMany({
    where: {
      status: 'ready',
      date: { gte: sinceStr },
    },
    select: { date: true, content: true, theme: true, createdAt: true, updatedAt: true },
    orderBy: { date: 'desc' },
    take: maxPerSource,
  });

  const refs: Reference[] = [];
  for (const r of rows) {
    if (!r.content) continue;
    try {
      const parsed = JSON.parse(r.content);
      const cover = parsed?.cover?.title ?? `早报 ${r.date}`;
      const emphasis = parsed?.cover?.emphasis ?? '';
      refs.push({
        kind: 'briefing',
        id: r.date,
        title: `${r.date} · ${cover}`,
        snippet: String(emphasis).slice(0, 200),
        timestamp: r.createdAt.toISOString(),
        url: null,
      });
    } catch {
      // content 不是 JSON 跳过
    }
  }
  return refs;
}

async function retrieveBilibili(q: RetrieveQuery): Promise<Reference[]> {
  const { query, windowDays = 30, maxPerSource = 5 } = q;
  const since = new Date(Date.now() - windowDays * 86400_000);

  // BilibiliCache 是单行 JSON：ups.ups[].videos[]
  // 策略：拉所有未删除的最新缓存 → 在 Node 端解析 ups JSON → 过滤匹配
  // （量不大，单租户通常只有几个 UP 主）
  const rows = await prismaBase.bilibiliCache.findMany({
    where: {
      deletedAt: null,
      fetchedAt: { gte: since },
    },
    select: { id: true, ups: true, fetchedAt: true },
    orderBy: { fetchedAt: 'desc' },
    take: 5, // 最新 5 个缓存行
  });

  const refs: Reference[] = [];
  const qLower = query.toLowerCase();

  for (const row of rows) {
    const ups = row.ups as unknown as {
      ups?: Array<{
        uid: string;
        name: string;
        videos?: Array<{
          bvid: string;
          title: string;
          description?: string;
          url?: string;
          uploadDate?: string;
        }>;
      }>;
    } | null;
    if (!ups?.ups) continue;

    for (const up of ups.ups) {
      if (!up.videos) continue;
      for (const v of up.videos) {
        const matchTitle = v.title?.toLowerCase().includes(qLower);
        const matchDesc = v.description?.toLowerCase().includes(qLower);
        if (!matchTitle && !matchDesc) continue;
        refs.push({
          kind: 'bilibili' as const,
          id: `${row.id}:${v.bvid}`,
          title: `[${up.name}] ${v.title}`,
          snippet: (v.description ?? '').slice(0, 200),
          timestamp: v.uploadDate ?? row.fetchedAt.toISOString(),
          url: v.url ?? null,
        });
        if (refs.length >= maxPerSource) break;
      }
      if (refs.length >= maxPerSource) break;
    }
    if (refs.length >= maxPerSource) break;
  }
  return refs;
}

/**
 * RAG-P2-A：检索对话历史
 *
 * 隔离规则：
 *   - 当前 conversation 有 groupId → 检索该 groupId 下所有对话的历史
 *   - 当前 conversation 无 groupId → 仅检索该 conversation 自己的历史
 *   - 必须传 userId（防越权：不能检索其他用户的对话）
 *
 * 必须传 conversationId（否则无法判定隔离/共享）
 */
async function retrieveConversation(q: RetrieveQuery): Promise<Reference[]> {
  const { query, maxPerSource = 5, userId, conversationId } = q;
  if (!userId || !conversationId) return [];

  // 1. 查当前对话的 groupId
  const currentConv = await prismaBase.conversation.findUnique({
    where: { id: conversationId },
    select: { groupId: true, userId: true, deletedAt: true },
  });
  if (!currentConv || currentConv.deletedAt) return [];
  // 越权防护：只能检索自己的对话
  if (currentConv.userId !== userId) return [];

  // 2. 决定检索范围
  let targetConversationIds: string[];
  if (currentConv.groupId) {
    const groupConvs = await prismaBase.conversation.findMany({
      where: { groupId: currentConv.groupId, deletedAt: null, userId },
      select: { id: true },
    });
    targetConversationIds = groupConvs.map((c) => c.id);
  } else {
    targetConversationIds = [conversationId];
  }
  if (targetConversationIds.length === 0) return [];

  // 3. 检索匹配 query 的消息（LIKE 在 content 上）
  const messages = await prismaBase.message.findMany({
    where: {
      conversationId: { in: targetConversationIds },
      deletedAt: null,
      content: { contains: query },
      role: { in: ['user', 'assistant'] },
    },
    select: {
      id: true,
      content: true,
      role: true,
      createdAt: true,
      conversationId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: maxPerSource * 2,
  });

  // 4. 拉对话标题
  const convTitles = new Map<string, string>();
  const convs = await prismaBase.conversation.findMany({
    where: { id: { in: targetConversationIds } },
    select: { id: true, title: true },
  });
  for (const c of convs) convTitles.set(c.id, c.title ?? '未命名对话');

  // 5. 截断 content
  const refs: Reference[] = [];
  for (const m of messages) {
    if (m.content.length < 10) continue;
    const convTitle = convTitles.get(m.conversationId) ?? '对话';
    const isCurrent = m.conversationId === conversationId;
    refs.push({
      kind: 'conversation' as const,
      id: m.id,
      title: `[${isCurrent ? '当前' : convTitle.slice(0, 20)}] ${m.role === 'user' ? '我' : 'AI'}：${m.content.slice(0, 60)}`,
      snippet: m.content.slice(0, 200),
      timestamp: m.createdAt.toISOString(),
      url: null,
    });
    if (refs.length >= maxPerSource) break;
  }
  return refs;
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 检索项目私有数据，返回引用列表 + 给 LLM 看的 context 块
 *
 * @example
 *   const { references, contextBlock } = await retrieve({
 *     query: 'AI Coding',
 *   });
 *   // → references 用于 UI 展示，contextBlock 拼到 system prompt
 */
export async function retrieve(q: RetrieveQuery): Promise<RetrieveResult> {
  const t0 = Date.now();
  const sources = q.sources ?? (['news', 'briefing', 'bilibili'] as SourceKind[]);

  const tasks: Array<Promise<Reference[]>> = [];
  if (sources.includes('news')) tasks.push(retrieveNews(q));
  if (sources.includes('briefing')) tasks.push(retrieveBriefings(q));
  if (sources.includes('bilibili')) tasks.push(retrieveBilibili(q));
  if (sources.includes('conversation')) tasks.push(retrieveConversation(q));

  const results = await Promise.allSettled(tasks);
  const references: Reference[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') references.push(...r.value);
  }

  // 按时间倒序
  references.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const contextBlock = buildContextBlock(references);
  return {
    references,
    contextBlock,
    durationMs: Date.now() - t0,
  };
}

/**
 * 把检索结果格式化成可塞进 system prompt 的中文文本块
 */
export function buildContextBlock(refs: Reference[]): string {
  if (refs.length === 0) return '';

  const lines: string[] = [];
  lines.push(`[项目知识库] 共检索到 ${refs.length} 条相关资料：`);
  for (const r of refs) {
    const date = r.timestamp.slice(0, 10);
    const conf = r.confidence ? `，置信度 ${r.confidence}` : '';
    const cat = r.category ? `，分类 ${r.category}` : '';
    lines.push(`- [${r.kind} ${date}] ${r.title}${cat}${conf}`);
    if (r.snippet && r.snippet !== r.title) {
      lines.push(`  ${r.snippet.slice(0, 120)}`);
    }
  }
  lines.push('');
  lines.push('请基于以上项目资料回答。引用具体新闻时注明标题/日期；没有相关资料时如实告知。');
  return lines.join('\n');
}
