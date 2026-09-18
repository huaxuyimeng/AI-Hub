/**
 * 文本相似度工具（P1-PPT-1.1）
 *
 * 用途：
 *   - 判断多个文本是否过于相似（"模板句"问题）
 *   - 当前用法：authors 页 2 列描述相似度 > 80% 时整页不渲染
 *
 * 实现：
 *   - 用 Jaccard 字符集合相似度（足够便宜 + 中文友好）
 *   - 阈值 0.80 = 80% 字符重合视为模板句
 *
 * 复杂度：
 *   - O(n+m) per 比较（字符集合构建）
 *   - 适合小字符串（< 200 字符），作者描述刚好在这个范围
 */

const DEFAULT_THRESHOLD = 0.80;

/** 转成字符集合（去空白） */
function charSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const ch of s.replace(/\s+/g, '')) {
    set.add(ch);
  }
  return set;
}

/** Jaccard 相似度 = |A∩B| / |A∪B| ∈ [0, 1] */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1; // 两个空串视为"完全相同"
  let inter = 0;
  for (const ch of a) if (b.has(ch)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * 计算两个字符串的字符集合相似度
 * @param a 字符串 A
 * @param b 字符串 B
 * @returns [0, 1]，越大越相似
 */
export function charJaccard(a: string, b: string): number {
  return jaccard(charSet(a), charSet(b));
}

/**
 * 判断多个文本是否"互相雷同"（全部两两相似度都高于阈值）
 *
 * @example
 *   areAllSimilar(['B站UP主，往期主要信源', 'B站UP主，往期交叉信源'], 0.8) // → true
 *
 * @param texts 待比较的字符串数组（至少 2 个）
 * @param threshold 相似度阈值（默认 0.80）
 * @returns true = 全部雷同（模板句），false = 有差异化内容
 */
export function areAllSimilar(
  texts: string[],
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  if (texts.length < 2) return false;
  const cleaned = texts.map(t => t.trim()).filter(Boolean);
  if (cleaned.length < 2) return false;
  for (let i = 0; i < cleaned.length; i++) {
    for (let j = i + 1; j < cleaned.length; j++) {
      if (charJaccard(cleaned[i], cleaned[j]) < threshold) {
        return false; // 任何一对不相似就退出
      }
    }
  }
  return true;
}
