// text-similarity 单元测试（P1-PPT-1.1 配套）
import { charJaccard, areAllSimilar } from './text-similarity';

// 简易断言工具（项目里其他测试也用同款）
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

// charJaccard
assert(charJaccard('abc', 'abc') === 1, '相同字符串相似度 = 1');
assert(charJaccard('abc', 'xyz') === 0, '完全不同字符串相似度 = 0');
assert(charJaccard('abc', 'abcd') > 0.7, '字符集合接近应高相似');

// 模板句场景（实测 2026-09-16 数据）
const a = 'B 站 AI 早报 UP 主，往期为主要视频信源。本期采集链路未接入，仅列出主页供人工核对。';
const b = 'B 站 AI 早报 UP 主，往期为交叉印证信源。本期采集链路未接入，仅列出主页供人工核对。';
assert(areAllSimilar([a, b], 0.80) === true, '两位作者模板句（相似度 ~80%）应被识别为雷同');

// 差异化场景（实测 09-13 数据）
const c1 = '本期覆盖 Codex Harness、Claude Code 等 4 条 AI 编程工具更新，OpenAI 推出 Codex CLI。';
const c2 = '四十年数学猜想取得重大突破，陶哲轩参与证明，引发跨学科讨论。';
assert(areAllSimilar([c1, c2], 0.80) === false, '差异化内容应判定为不相似');

// 空串保护
assert(areAllSimilar(['', '']) === false, '空字符串数组应不判定为相似');
assert(areAllSimilar([a, '']) === false, '包含空串应跳过');

// 单元素不应判定
assert(areAllSimilar([a]) === false, '单元素不应判定为相似');

// 中英文混排
const m1 = 'AI 早报：Anthropic 发布 Claude 4，能力提升 30%';
const m2 = 'AI 早报：OpenAI 发布 GPT-5，能力提升 40%';
assert(areAllSimilar([m1, m2], 0.80) === false, '中英文混排但内容不同应判定为不相似');

console.log('\n✅ 所有 text-similarity 测试通过');
