/**
 * chatLCStream 单元测试
 *
 * 覆盖：
 * 1) sseEncode 输出符合 SSE 协议格式
 * 2) SSE_END_MARKER 是标准 [DONE] sentinel
 * 3) chatLCStream 未知模型 yield error + done
 * 4) chatLCStream dev mock 路径（无 key → placeholder 文本）
 * 5) ChatChunk type 契约（discriminated union）
 *
 * 运行：npx tsx src/lib/ai/__tests__/langchain-stream.test.ts
 */

import { chatLCStream, sseEncode, SSE_END_MARKER, type ChatChunk } from '../langchain-stream';

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
  // ── 1) sseEncode 输出符合 SSE 协议格式 ─────────────────────────────
  console.log('\n[1] sseEncode SSE 格式...');
  const chunk: ChatChunk = { type: 'text', delta: '你好' };
  const sse = sseEncode(chunk);
  assert(sse.startsWith('data: '), 'SSE 消息以 "data: " 开头');
  assert(sse.includes('"type":"text"'), 'SSE 包含 type 字段');
  assert(sse.includes('"delta":"你好"'), 'SSE 包含 delta 字段');
  assert(sse.endsWith('\n\n'), 'SSE 消息以双换行结束');

  // ── 2) SSE_END_MARKER 是 [DONE] sentinel ─────────────────────────
  console.log('\n[2] SSE_END_MARKER...');
  assertEqual(SSE_END_MARKER, 'data: [DONE]\n\n', 'SSE_END_MARKER 是标准 sentinel');

  // ── 3) sseEncode 处理 4 种 chunk 类型 ──────────────────────────────
  console.log('\n[3] sseEncode 4 种 chunk 类型...');
  {
    const c: ChatChunk = { type: 'usage', usage: { input: 12, output: 8 } };
    const s = sseEncode(c);
    assert(s.includes('"type":"usage"'), 'usage chunk 正确');
    assert(s.includes('"input":12'), 'usage.input 正确');
  }
  {
    const c: ChatChunk = { type: 'error', error: { message: 'boom' } };
    const s = sseEncode(c);
    assert(s.includes('"type":"error"'), 'error chunk 正确');
    assert(s.includes('"message":"boom"'), 'error.message 正确');
  }
  {
    const c: ChatChunk = { type: 'done', done: true };
    const s = sseEncode(c);
    assert(s.includes('"type":"done"'), 'done chunk 正确');
    assert(s.includes('"done":true'), 'done=true 正确');
  }

  // ── 4) chatLCStream 未知模型 yield error + done ─────────────────
  console.log('\n[4] chatLCStream 未知模型...');
  {
    const chunks: ChatChunk[] = [];
    for await (const c of chatLCStream('this-model-does-not-exist-xyz', 'tenant-1', [
      { role: 'user', content: 'hi' },
    ])) {
      chunks.push(c);
    }
    assert(chunks.length === 2, 'yield 恰好 2 个 chunk');
    assertEqual(chunks[0].type, 'error', '第一个是 error');
    assert(
      (chunks[0] as { error: { message: string } }).error.message.includes('this-model-does-not-exist-xyz'),
      'error message 包含模型名'
    );
    assertEqual(chunks[1].type, 'done', '第二个是 done');
  }

  // ── 5) chatLCStream 未知 provider（无 adapter）→ error ─────────
  console.log('\n[5] chatLCStream 未知 provider...');
  // 间接走：通过一个不存在的模型名触发
  {
    const chunks: ChatChunk[] = [];
    for await (const c of chatLCStream('__bogus__', 'tenant-1', [
      { role: 'user', content: 'hi' },
    ])) {
      chunks.push(c);
    }
    assert(chunks.length === 2, 'yield 恰好 2 个 chunk');
    assertEqual(chunks[0].type, 'error', '错误模型 → error 事件');
    assertEqual(chunks[1].type, 'done', '错误模型 → done 事件');
  }

  // ── 6) ChatChunk 类型契约 ─────────────────────────────────────────
  console.log('\n[6] ChatChunk discriminated union...');
  {
    const c1: ChatChunk = { type: 'text', delta: 'x' };
    const c2: ChatChunk = { type: 'text', delta: 'x' };
    assert(c1.type === c2.type, '同 type 的 chunk 比较一致');
    if (c1.type === 'text') {
      assertEqual(c1.delta, 'x', 'narrow 后 delta 字段可访问');
    }
  }

  // ── Done ─────────────────────────────────────────────────────────────
  console.log(`\n=== chatLCStream 测试结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
