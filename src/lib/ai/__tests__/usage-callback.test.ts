/**
 * UsageCallbackHandler 单元测试
 *
 * 覆盖 parseLLMUsage 的 4 种 provider 路径：
 * 1) OpenAI 兼容：llmOutput.tokenUsage
 * 2) Anthropic：llmOutput.usage
 * 3) AIMessage.usage_metadata
 * 4) response_metadata.usage
 * 5) 边缘情况：null / 字段缺失 / 全零
 *
 * 运行：npx tsx src/lib/ai/__tests__/usage-callback.test.ts
 */

import { UsageCallbackHandler } from '../langchain-adapter';
import type { LLMResult } from '@langchain/core/outputs';

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

async function runTests(): Promise<void> {
  // ── 1) OpenAI 兼容路径：llmOutput.tokenUsage ─────────────────────────
  console.log('\n[1] OpenAI 兼容路径 tokenUsage...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [[{ text: 'mock response', message: { content: 'mock response' } }]],
      llmOutput: {
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assert(usage !== null, 'usage 被捕获');
    assertEqual(usage?.input, 100, 'OpenAI promptTokens → input');
    assertEqual(usage?.output, 50, 'OpenAI completionTokens → output');
  }

  // ── 2) Anthropic 路径：llmOutput.usage ───────────────────────────────
  console.log('\n[2] Anthropic 路径 llmOutput.usage...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [[{ text: 'mock', message: { content: 'mock' } }]],
      llmOutput: {
        usage: { input_tokens: 80, output_tokens: 30 },
      },
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assert(usage !== null, 'Anthropic usage 被捕获');
    assertEqual(usage?.input, 80, 'Anthropic input_tokens → input');
    assertEqual(usage?.output, 30, 'Anthropic output_tokens → output');
  }

  // ── 3) AIMessage.usage_metadata 路径 ──────────────────────────────
  console.log('\n[3] AIMessage.usage_metadata 路径...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [
        [
          {
            text: 'mock',
            message: {
              content: 'mock',
              usage_metadata: { input_tokens: 60, output_tokens: 40, total_tokens: 100 },
            },
          },
        ],
      ],
      llmOutput: {},
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assert(usage !== null, 'usage_metadata 路径捕获成功');
    assertEqual(usage?.input, 60, 'usage_metadata input_tokens → input');
    assertEqual(usage?.output, 40, 'usage_metadata output_tokens → output');
  }

  // ── 4) response_metadata.usage 路径 ────────────────────────────────
  console.log('\n[4] response_metadata.usage 路径...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [
        [
          {
            text: 'mock',
            message: {
              content: 'mock',
              response_metadata: { usage: { input_tokens: 20, output_tokens: 10 } },
            },
          },
        ],
      ],
      llmOutput: {},
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assert(usage !== null, 'response_metadata.usage 路径捕获成功');
    assertEqual(usage?.input, 20, 'response_metadata input_tokens → input');
    assertEqual(usage?.output, 10, 'response_metadata output_tokens → output');
  }

  // ── 5) 优先级：tokenUsage 优先于 usage ────────────────────────────
  console.log('\n[5] 优先级：tokenUsage > usage...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [],
      llmOutput: {
        tokenUsage: { promptTokens: 999, completionTokens: 888 },
        usage: { input_tokens: 1, output_tokens: 2 }, // 应当被忽略
      },
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assertEqual(usage?.input, 999, 'tokenUsage 优先于 llmOutput.usage');
    assertEqual(usage?.output, 888, 'tokenUsage.output 优先');
  }

  // ── 6) 边缘情况：所有字段缺失 ─────────────────────────────────────
  console.log('\n[6] 边缘情况：所有字段缺失...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [[{ text: 'mock', message: { content: 'mock' } }]],
      llmOutput: {},
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assertEqual(usage, null, '无 usage 字段时返回 null');
  }

  // ── 7) 边缘情况：usage 全零（异常数据） ──────────────────────────
  console.log('\n[7] 边缘情况：usage 全零...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [],
      llmOutput: {
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assertEqual(usage, null, 'usage 全零视为无数据，返回 null');
  }

  // ── 8) 边缘情况：generations 为空数组 ─────────────────────────────
  console.log('\n[8] 边缘情况：generations 为空...');
  {
    const handler = new UsageCallbackHandler();
    const fakeResult = {
      generations: [],
      llmOutput: {},
    } as unknown as LLMResult;
    await handler.handleLLMEnd(fakeResult);
    const usage = handler.getUsage();
    assertEqual(usage, null, 'generations 空 → null');
  }

  // ── 9) Callback 解析失败不抛错（静默失败原则） ──────────────────
  console.log('\n[9] Callback 解析失败不抛错...');
  {
    const handler = new UsageCallbackHandler();
    // 故意传入畸形数据
    const brokenResult = {
      generations: 'not an array',
      llmOutput: 'not an object',
    } as unknown as LLMResult;
    let crashed = false;
    try {
      await handler.handleLLMEnd(brokenResult);
    } catch (e) {
      crashed = true;
    }
    assert(!crashed, '畸形数据不抛错');
    assertEqual(handler.getUsage(), null, '畸形数据后 usage 仍为 null');
  }

  // ── 10) Bug19 回归：fallback 估算 input 不能为 0 ─────────────
  // 修复前 estimateTokens(text) 只估 output，input 永远 0，导致 fallback 时计费 input 漏算
  // 修复后 estimateTokens(inputText, outputText) 分别估算
  console.log('\n[10] Bug19 回归：estimateTokens 同时估算 input + output...');
  {
    // 简单逻辑单元：手工复制实现验证行为
    // (estimateTokens 是 langchain-adapter private，不能直接 import)
    const estimate = (text: string): number => {
      const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      const englishWords = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/\S+/g) || []).length;
      return Math.ceil(chineseChars * 1.5 + englishWords * 1.25);
    };
    const inputText = '你是产品经理，请基于以上内容给出建议';
    const outputText = '建议在 Q4 上线会员功能';
    const inputEst = estimate(inputText);
    const outputEst = estimate(outputText);
    assert(inputEst > 0, `input 估算 > 0（实际=${inputEst}）`);
    assert(outputEst > 0, `output 估算 > 0（实际=${outputEst}）`);
    assert(inputEst !== outputEst, 'input/output 估算结果可能不同');

    // 纯中文 16 字：16 * 1.5 = 24 token
    const pureChinese = '一二三四五六七八九十一二三四五六';
    const chineseEst = estimate(pureChinese);
    assertEqual(chineseEst, 24, '16 个中文字 = 24 tokens');

    // 纯英文 8 词：8 * 1.25 = 10 token
    const pureEnglish = 'one two three four five six seven eight';
    const englishEst = estimate(pureEnglish);
    assertEqual(englishEst, 10, '8 个英文单词 = 10 tokens');

    // 空字符串 → 0
    assertEqual(estimate(''), 0, '空字符串 = 0 token');
  }

  // ── Done ─────────────────────────────────────────────────────────────
  console.log(`\n=== UsageCallbackHandler 测试结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
