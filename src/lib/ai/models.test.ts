/**
 * getModelAvatar 单元测试
 *
 * 覆盖：
 * 1) 所有内置 provider 都能映射到合法字母 + HSL
 * 2) 未知 model 优雅 fallback（不抛错，letter='?'）
 * 3) 字母全部稳定（同样的 input → 同样的 output，纯函数性质）
 * 4) HSL 字符串能被浏览器 CSS hsl() 直接消费
 *
 * 运行：npx tsx src/lib/ai/models.test.ts
 */

import { getModelAvatar, SUPPORTED_MODELS } from './models';

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

// 1) 内置 provider 全部有合法映射
const providers = new Set(SUPPORTED_MODELS.map((m) => m.provider));
console.log(`[test] 验证 ${providers.size} 个 provider 的头像映射...`);
for (const provider of providers) {
  const sample = SUPPORTED_MODELS.find((m) => m.provider === provider)!;
  const avatar = getModelAvatar(sample.name);
  assert(avatar.letter.length === 1, `${provider} → letter 是单字符（${avatar.letter}）`);
  assert(/^[A-Z?]$/.test(avatar.letter), `${provider} → letter 是大写字母或 ?`);
  // HSL 格式："H S% L%" 三元组
  assert(/^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/.test(avatar.bgHsl), `${provider} → bgHsl 是合法 HSL 三元组（${avatar.bgHsl}）`);
}

// 2) 未知 model → letter='?' + 兜底色
console.log('\n[test] 未知 model 的 fallback...');
const unknown = getModelAvatar('this-model-does-not-exist-xyz');
assertEqual(unknown.letter, '?', '未知 model 的 letter 兜底为 ?');
assert(typeof unknown.bgHsl === 'string' && unknown.bgHsl.length > 0, '未知 model 仍有兜底 bgHsl');

// 3) 纯函数性质（相同 input 永远相同 output）
console.log('\n[test] 纯函数性质...');
const a = getModelAvatar('deepseek-chat');
const b = getModelAvatar('deepseek-chat');
assertEqual(a.letter, b.letter, '相同 input → 相同 letter');
assertEqual(a.bgHsl, b.bgHsl, '相同 input → 相同 bgHsl');

// 4) 字母不应该是真实 emoji 或人脸字符
console.log('\n[test] 字母合规性（无 emoji / 真实人脸）...');
for (const model of SUPPORTED_MODELS) {
  const avatar = getModelAvatar(model.name);
  // 排除 emoji（用码点范围检测）
  const isEmoji = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u.test(avatar.letter);
  assert(!isEmoji, `${model.name} → letter 不是 emoji（${avatar.letter}）`);
}

// 5) 每个 provider 字母唯一（视觉辨识度）
console.log('\n[test] 各 provider 字母唯一性...');
const letterByProvider = new Map<string, string>();
let duplicates = 0;
for (const m of SUPPORTED_MODELS) {
  const letter = getModelAvatar(m.name).letter;
  const prev = letterByProvider.get(m.provider);
  if (prev && prev !== letter) {
    console.error(`  WARN: provider ${m.provider} 有多个字母: ${prev} vs ${letter}`);
    duplicates++;
  }
  letterByProvider.set(m.provider, letter);
}
assert(duplicates === 0, `所有 provider 内字母一致（违规数: ${duplicates}）`);

console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
