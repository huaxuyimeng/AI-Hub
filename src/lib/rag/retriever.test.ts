// RAG 检索层单元测试（RAG-P1 配套）
import { buildContextBlock, retrieve } from './retriever';
import type { Reference } from './retriever';

// 简易断言工具
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

// ============ buildContextBlock ============
assert(buildContextBlock([]) === '', '空引用应返回空字符串');

const sample: Reference[] = [
  {
    kind: 'news',
    id: '1',
    title: 'Anthropic 发布 Claude 4',
    snippet: '能力提升 30%，支持 1M 上下文',
    timestamp: '2026-09-16T10:00:00.000Z',
    url: 'https://example.com/claude-4',
    confidence: 'A',
    category: 'AI Coding',
  },
  {
    kind: 'briefing',
    id: '2026-09-15',
    title: '2026-09-15 · AI Coding 周报',
    snippet: '本周 AI Coding 圈主要 3 件事',
    timestamp: '2026-09-15T08:00:00.000Z',
    url: null,
  },
];

const block = buildContextBlock(sample);
assert(block.includes('共检索到 2 条'), '应显示检索数量');
assert(block.includes('Claude 4'), '应包含新闻标题');
assert(block.includes('置信度 A'), '应包含置信度');
assert(block.includes('分类 AI Coding'), '应包含分类');
assert(block.includes('请基于以上项目资料回答'), '应包含指令语');

// ============ retrieve (端到端，真实跑库) ============
async function main() {
  const result = await retrieve({
    query: 'Claude',
    sources: ['news'],
    windowDays: 365,
    maxPerSource: 3,
  });

  assert(result.durationMs >= 0, '应返回耗时');
  assert(Array.isArray(result.references), 'references 必须是数组');
  assert(typeof result.contextBlock === 'string', 'contextBlock 必须是字符串');

  // 如果 DB 里确实有 "Claude" 相关新闻，验证至少有一条
  if (result.references.length > 0) {
    const ref = result.references[0];
    assert(ref.kind === 'news', '单源 = news 时返回 kind 必须是 news');
    assert(ref.title.length > 0, 'title 必须非空');
    assert(ref.timestamp.length > 0, 'timestamp 必须非空');
    console.log(`   检索到 ${result.references.length} 条参考资料，耗时 ${result.durationMs}ms`);
  } else {
    console.log('   ⚠️  DB 中暂无 "Claude" 相关资料（不影响测试通过）');
  }

  console.log('\n✅ RAG 检索层测试通过');
}

main().catch((e) => {
  console.error('测试崩溃:', e);
  process.exit(1);
});
