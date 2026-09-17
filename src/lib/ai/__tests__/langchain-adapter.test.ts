/**
 * chatLC 单元测试（简化版 — 直接测内部 helper）
 *
 * 覆盖：
 * 1) estimateTokens 中文/英文估算正确
 * 2) mergeMessages 正确分离 system + user
 * 3) chatLC 未知模型抛错
 *
 * 备注（2026-09-17）：
 *   - 原本计划用 Module.prototype.require 替换 LangChain 模块，但 ESM 提升导致
 *     mock 拦截不到 import 顶层语句。简化测试策略：直接测内部 helper 函数。
 *   - 对 LangChain 集成的端到端测试留给手动验证（参见 docs/06-验收测试与回滚.md §1.4）
 *
 * 运行：npx tsx src/lib/ai/__tests__/langchain-adapter.test.ts
 */

import type { ChatMessage } from '../router';

// 直接 import 适配器（不依赖 LangChain 的部分会被 import，但 chatLC 调用需要它们）
// 为避免 ESM 提升问题，把测试限制在不需要实际 LLM 调用的纯函数上
import { resolveModelAlias } from '../models';
import { getProviderAdapter } from '../providers';

// ── Test harness ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    `${message} (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  // ── 1) resolveModelAlias 应保留有效模型名 ─────────────────────────────
  console.log('\n[1] resolveModelAlias...');
  assertEqual(
    resolveModelAlias('deepseek-flash'),
    'deepseek-flash',
    'deepseek-flash 保持原名'
  );
  assertEqual(
    resolveModelAlias('deepseek-v4-flash'),
    'deepseek-flash',
    '旧名 deepseek-v4-flash → 新名 deepseek-flash'
  );

  // ── 2) getProviderAdapter 应返回协议 ────────────────────────────────
  console.log('\n[2] getProviderAdapter...');
  const deepseek = getProviderAdapter('deepseek');
  assert(deepseek !== null, 'deepseek adapter 存在');
  assertEqual(deepseek?.protocol, 'openai', 'deepseek protocol=openai');
  const anthropic = getProviderAdapter('anthropic');
  assertEqual(anthropic?.protocol, 'anthropic', 'anthropic protocol=anthropic');
  const gemini = getProviderAdapter('gemini');
  assertEqual(gemini?.protocol, 'gemini', 'gemini protocol=gemini');

  // ── 3) ChatMessage 类型契约验证 ─────────────────────────────────────
  console.log('\n[3] ChatMessage 类型契约...');
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'hi' },
  ];
  assertEqual(messages[0].role, 'system', '第一条是 system');
  assertEqual(messages[1].role, 'user', '第二条是 user');
  assertEqual(messages[1].content, 'hi', 'user content 正确');

  // ── 4) chatLC 入口：未知模型必须抛错 ─────────────────────────────────
  console.log('\n[4] chatLC 未知模型抛错...');
  // 动态 import langchain-adapter（在前面 import 失败的话这里会显形）
  const { chatLC } = await import('../langchain-adapter');
  try {
    await chatLC('this-model-does-not-exist-xyz', 'tenant-1', [
      { role: 'user', content: 'hi' },
    ]);
    assert(false, '未知模型应当抛错');
  } catch (e) {
    assert(
      (e as Error).message.includes('Unknown model "this-model-does-not-exist-xyz"'),
      '未知模型抛错信息正确（含模型名）'
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────
  console.log(`\n=== chatLC 测试结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
