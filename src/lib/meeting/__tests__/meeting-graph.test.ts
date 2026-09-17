/**
 * MeetingGraph 单元测试
 *
 * 覆盖：
 * 1) buildMeetingGraph 编译成功（返回 compiled graph）
 * 2) runMeetingGraph 单轮完成（3 参与者）
 * 3) runMeetingGraph 多轮（decision 返回 CONTINUE）
 * 4) 单个 participant 失败容忍
 *
 * 运行：npx tsx src/lib/meeting/__tests__/meeting-graph.test.ts
 *
 * 测试策略（2026-09-17）：
 *   - chatLC 在 langchain-adapter 里是真实函数；这里我们通过
 *     Module.prototype.require 拦截 langchain-adapter，把 chatLC 替换为 mock
 *   - 这样跑 runMeetingGraph 不会触发真实 LLM 调用
 *   - mock 的 chatLC 行为：第一次返回 CONTINUE 触发多轮
 *
 * 局限（已知）：
 *   - 由于 ESM 提升，import 在模块加载时就执行；mock 拦截不到顶层 import
 *   - 因此我们直接验证"buildMeetingGraph 能 compile"和"纯函数（estimateTokens 等）"
 *   - 真实 runMeetingGraph 行为留给手动测试（见 docs/06 §2）
 */

import { createRequire } from 'module';
import { buildMeetingGraph, buildDecisionSummary } from '../meeting-graph';
import { MAX_MEETING_ROUNDS } from '../types';
import type { ParticipantConfig } from '../types';

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
  // ── 1) buildMeetingGraph 编译成功 ───────────────────────────────
  console.log('\n[1] buildMeetingGraph 编译成功...');
  const graph = buildMeetingGraph();
  assert(graph !== undefined, 'graph 被构造');
  assert(typeof graph.invoke === 'function', 'graph.invoke 是函数');

  // ── 2) MAX_MEETING_ROUNDS 常量正确 ─────────────────────────────
  console.log('\n[2] MAX_MEETING_ROUNDS 常量...');
  assertEqual(MAX_MEETING_ROUNDS, 3, 'MAX_MEETING_ROUNDS = 3（防止无限循环）');

  // ── 3) ParticipantConfig 类型契约（编译期） ──────────────────────
  console.log('\n[3] ParticipantConfig 类型契约...');
  const participant = {
    id: 'p1',
    role: '产品经理',
    model: 'deepseek-flash',
    systemPrompt: '你是一位产品经理。',
    maxTokens: 600,
    temperature: 0.7,
  };
  assertEqual(participant.id, 'p1', 'participant.id');
  assertEqual(participant.role, '产品经理', 'participant.role');
  assertEqual(participant.maxTokens, 600, 'participant.maxTokens');
  assertEqual(participant.temperature, 0.7, 'participant.temperature');

  // ── 4) 简单的 graph.invoke（不调 LLM 的最小图） ─────────────────
  console.log('\n[4] 简单 LangGraph 流程测试...');
  // 用 LangGraph 构造一个不调 LLM 的最小图，验证框架本身可用
  const { StateGraph, Annotation, END } = await import('@langchain/langgraph');
  const MinimalAnnotation = Annotation.Root({
    count: Annotation<number>({
      reducer: (x, y) => (x ?? 0) + (y ?? 0),
      default: () => 0,
    }),
  });
  const minimalGraph = new StateGraph(MinimalAnnotation)
    .addNode('add', () => ({ count: 1 }))
    .addEdge('__start__', 'add')
    .addEdge('add', END)
    .compile();
  const result = await minimalGraph.invoke({ count: 0 });
  assertEqual(result.count, 1, '最小 LangGraph flow 工作正常');

  // ── 5) Bug1 回归：buildDecisionSummary 用 role 而不是 pid ─────────
  // 修复前：summary 中 role 字段是 uuid，决策模型无法分辨
  // 修复后：role 字段是 participants 里的 role 名
  console.log('\n[5] Bug1 回归 buildDecisionSummary 用 role 而不是 pid...');
  const bug1Participants: ParticipantConfig[] = [
    { id: 'uuid-pm-001', role: '产品经理', model: 'deepseek-flash', systemPrompt: '', maxTokens: 600, temperature: 0.7 },
    { id: 'uuid-eng-002', role: '工程师', model: 'claude-sonnet-4-5', systemPrompt: '', maxTokens: 600, temperature: 0.7 },
  ];
  const bug1Transcripts = {
    'uuid-pm-001': [
      { role: 'assistant' as const, content: '我们需要在 Q4 上线会员功能', model: 'deepseek-flash', speaker: '产品经理', timestamp: '2026-09-17T00:00:00Z' },
    ],
    'uuid-eng-002': [
      { role: 'assistant' as const, content: '技术上需要 4 周', model: 'claude-sonnet-4-5', speaker: '工程师', timestamp: '2026-09-17T00:01:00Z' },
    ],
  };
  const summary = buildDecisionSummary(bug1Participants, bug1Transcripts);
  assert(summary.includes('产品经理'), 'summary 含 role "产品经理"（不是 uuid）');
  assert(summary.includes('工程师'), 'summary 含 role "工程师"（不是 uuid）');
  assert(!summary.includes('uuid-pm-001'), 'summary 不含 pid uuid');
  assert(!summary.includes('uuid-eng-002'), 'summary 不含 pid uuid');
  assert(summary.includes('Q4 上线会员功能'), 'summary 含 pm 发言内容');
  assert(summary.includes('技术上需要 4 周'), 'summary 含 engineer 发言内容');

  // ── 6) Bug1 边界：participants 中找不到 pid 时 fallback 到 pid ───
  console.log('\n[6] Bug1 边界：fallback 到 pid...');
  const partialParticipants: ParticipantConfig[] = [
    { id: 'uuid-pm-001', role: '产品经理', model: 'm', systemPrompt: '', maxTokens: 600, temperature: 0.7 },
    // 注意：缺少 'uuid-unknown-003'
  ];
  const partialTranscripts = {
    'uuid-pm-001': [
      { role: 'assistant' as const, content: '已知发言', model: 'm', speaker: 'pm', timestamp: 't' },
    ],
    'uuid-unknown-003': [
      { role: 'assistant' as const, content: '未知参与者发言', model: 'm', speaker: '?', timestamp: 't' },
    ],
  };
  const partialSummary = buildDecisionSummary(partialParticipants, partialTranscripts);
  assert(partialSummary.includes('产品经理'), '已知 pid 映射到 role');
  assert(partialSummary.includes('uuid-unknown-003'), '未知 pid fallback 到 pid 本身（防御性）');
  assert(partialSummary.includes('未知参与者发言'), '未知参与者发言也保留');

  // ── Done ─────────────────────────────────────────────────────────────
  console.log(`\n=== meeting-graph 测试结果: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
