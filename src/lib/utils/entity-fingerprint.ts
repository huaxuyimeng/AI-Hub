/**
 * 实体指纹多源去重（P0-4 修复）
 * 
 * 来源：ai-news-daily aggregate.mjs §4.5
 * 功能：
 *   1. 跨源标题措辞差异也能识别同事件
 *   2. 停用词表抑制英文通用词误判
 *   3. 中文 2-4 字窗口提取
 */

/** 停用词表（英文通用词 + 常见中文虚词） */
const STOP = new Set([
  // 英文通用词
  'the','a','an','of','and','or','to','in','for','with','on','is','at','by','as',
  'ai','new','news','www','com','http','https','app','its','it','this','that',
  'more','from','will','can','now','has','have','not','but','are','was','were','been','their','there',
  'what','how','why','who','when','which','than','then','them','they','you','your','our','out','get',
  'just','like','make','made','take','over','into','about','after','before','first','last','year','years',
  'day','days','time','way','old','use','used','using','one','two','also','may','could','would',
  'says','said','want','wants','lets','let','data','model','models','openai','google',
  // 中文虚词
  '的','了','在','是','和','与','或','也','都','很','就','要','会','能','不','没','有',
  '我','你','他','她','它','我们','你们','他们','这','那','这个','那个',
])

/** Token 提取正则 */
const TOKEN_RE = /[A-Za-z][A-Za-z0-9.\-]{1,}|\d+(?:\.\d+)+|[\u4e00-\u9fa5]{2,4}/g

/**
 * 提取 Token 集合
 * 
 * - 英文：按词边界提取，>=3字符
 * - 数字：保留版本号格式如 1.0、2.5.3
 * - 中文：2-4字窗口（如"混元"、"Hy4"、"preview"）
 * 
 * @param title 标题
 * @param summary 摘要（可选）
 */
export function tokenize(title: string, summary: string = ''): Set<string> {
  const text = `${title} ${summary}`
  const tokens = new Set<string>()
  
  for (const m of text.matchAll(TOKEN_RE)) {
    const t = m[0].toLowerCase()
    // 英文 >= 3 字符，中文 2-4 字
    if (t.length >= 3 && !STOP.has(t)) {
      tokens.add(t)
    }
  }
  
  return tokens
}

/** 跨源最小共享 Token 数（经验值：3 最合理） */
export const MULTI_SOURCE_MIN_SHARED = 3

export interface MultiSourceRelation {
  sources: string[]
  itemId: string
}

export interface TokenizableItem {
  id: string
  source: string
  title: string
  summary?: string | null
}

/**
 * 发现多源关联
 * 
 * 对每条新闻，计算它与其他新闻的共享 Token 数。
 * 若共享 Token >= MULTI_SOURCE_MIN_SHARED，则认为它们是同一事件的多源报道。
 * 
 * @param items 新闻列表
 */
export function findMultiSourceRelations<T extends TokenizableItem>(
  items: T[]
): MultiSourceRelation[] {
  const toks = items.map(it => tokenize(it.title, it.summary ?? ''))
  const relations: MultiSourceRelation[] = []
  
  for (let i = 0; i < items.length; i++) {
    const rel = new Set<string>([items[i].source])
    
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue
      
      // 计算共享 Token 数
      let shared = 0
      for (const t of toks[i]) {
        if (toks[j].has(t)) shared++
      }
      
      if (shared >= MULTI_SOURCE_MIN_SHARED) {
        rel.add(items[j].source)
      }
    }
    
    // 只有多源才记录
    if (rel.size > 1) {
      relations.push({ sources: [...rel], itemId: items[i].id })
    }
  }
  
  return relations
}

/**
 * 简化版 Jaccard 相似度（用于精确匹配阶段）
 */
export function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  
  return union === 0 ? 0 : intersection / union;
}
