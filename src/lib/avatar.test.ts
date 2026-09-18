/**
 * getUserAvatar 单元测试
 *
 * 覆盖：
 * 1) 相同 userId 永远相同色（纯函数）
 * 2) 不同 userId 大概率不同色（24 色槽分布）
 * 3) 字母优先取 name 首字母
 * 4) name 为空时 fallback 到 id 首字母
 * 5) emoji / 中文首字母 fallback 到 'U'
 * 6) HSL 是合法 CSS hsl() 三元组
 *
 * 运行：npx tsx src/lib/avatar.test.ts
 */

import { getUserAvatar } from './avatar';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`);
}

// 1) 纯函数性质
const a = getUserAvatar('user-1', 'Alice');
const b = getUserAvatar('user-1', 'Alice');
assertEqual(a.letter, b.letter, '纯函数：相同 input → 相同 letter');
assertEqual(a.bgHsl, b.bgHsl, '纯函数：相同 input → 相同 bgHsl');

// 2) 字母取 name 首字母
assertEqual(getUserAvatar('user-1', 'Alice').letter, 'A', 'name="Alice" → A');
assertEqual(getUserAvatar('user-1', 'bob').letter, 'B', 'name="bob" → B（自动大写）');

// 3) 空 name fallback 到 id 首字母
assertEqual(getUserAvatar('user-xyz-123', '').letter, 'U', '空 name → id 首位是 u → U');
assertEqual(getUserAvatar('user-123', null).letter, 'U', 'null name → id 首位是 u → U');

// 4) emoji / 中文 fallback 到 'U'（这些不是 [A-Z]）
assertEqual(getUserAvatar('user-1', '🎉').letter, 'U', 'emoji 首字母 → U');
assertEqual(getUserAvatar('user-1', '张三').letter, 'U', '中文首字母 → U');

// 5) HSL 是合法三元组
const sample = getUserAvatar('user-1', 'Alice');
assert(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/.test(sample.bgHsl), `bgHsl 是合法 HSL（${sample.bgHsl}）`);

// 6) 不同 userId 大概率不同色（24 色槽，100 个 id 至少应有 >15 种不同色）
const colors = new Set<string>();
for (let i = 0; i < 100; i++) {
  colors.add(getUserAvatar(`user-${i}`, `User${i}`).bgHsl);
}
assert(colors.size >= 15, `100 个不同 id 至少产生 15 种不同色（实际: ${colors.size}）`);

// 7) 同一 userId 即使 name 变化，色不变（hash 用 id）
const c1 = getUserAvatar('stable-id', 'OldName');
const c2 = getUserAvatar('stable-id', 'NewName');
assertEqual(c1.bgHsl, c2.bgHsl, '色由 id 决定，name 变化不影响色');

// 8) 极端边界
const empty = getUserAvatar('', '');
assertEqual(empty.letter, 'U', '完全空输入 → U');
assert(typeof empty.bgHsl === 'string' && empty.bgHsl.length > 0, '完全空输入仍有合法 HSL');

// 9) 跨进程一致性（再次 hash）
const djb2 = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const expectedHue = (djb2('user-42') % 24) * (360 / 24);
const expectedHsl = `${Math.round(expectedHue)} 65% 50%`;
assertEqual(getUserAvatar('user-42', 'X').bgHsl, expectedHsl, 'HSL 与 djb2 hash 一致');

console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
