/**
 * 用户头像生成器（基于 userId 的确定性 HSL）
 *
 * 与 getModelAvatar 设计保持一致：返回 { letter, bgHsl }
 * 但用 userId 做 hash 而不是 modelName，便于跨设备稳定显示。
 *
 * 设计要点：
 * 1) 纯函数：相同 userId 永远相同颜色（避免每次刷新换色）
 * 2) 字母优先取 name 首字符；空名字 fallback 到 id 首字符
 * 3) 色相均匀分布（不同用户能区分），但饱和度/亮度统一（视觉一致）
 */

const USER_HUE_STEPS = 24; // 24 个色相槽（每 15° 一个），保证大多数用户都能区分

function hashStringToInt(input: string): number {
  // djb2 hash —— 简单、稳定、无依赖
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface UserAvatar {
  letter: string;
  bgHsl: string;
}

export function getUserAvatar(userId: string, displayName?: string | null): UserAvatar {
  // 字母：优先 name 首字母，回退到 id 首字母
  const cleaned = (displayName ?? '').trim();
  const letter = (cleaned.charAt(0) || userId.charAt(0) || 'U').toUpperCase();
  // 过滤 emoji / 非字母
  const safeLetter = /^[A-Z]$/.test(letter) ? letter : 'U';

  // 色相：hash(userId) % 24 → 均匀分布
  const hue = (hashStringToInt(userId || 'anon') % USER_HUE_STEPS) * (360 / USER_HUE_STEPS);
  const bgHsl = `${Math.round(hue)} 65% 50%`;

  return { letter: safeLetter, bgHsl };
}
