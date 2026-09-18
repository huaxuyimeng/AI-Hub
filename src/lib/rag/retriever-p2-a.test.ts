// RAG-P2-A：对话历史隔离/共享测试
import { retrieve } from './retriever';
import { prismaBase } from '@/lib/db';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

async function main() {
  // 准备：找一个用户 + 创建 3 个对话 + 1 个组
  // 为避免污染生产数据，先查找现有 user
  const user = await prismaBase.user.findFirst({
    select: { id: true, tenantId: true },
  });
  if (!user) {
    console.log('⚠️  找不到 user，跳过测试（DB 未初始化）');
    return;
  }

  console.log(`🔍 使用用户: ${user.id} (tenant: ${user.tenantId})\n`);

  // 准备 1：创建测试组
  const testGroup = await prismaBase.conversationGroup.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      name: `RAG测试组_${Date.now()}`,
    },
  });
  console.log(`✓ 创建测试组: ${testGroup.id}`);

  // 准备 2：创建 2 个对话，A 不分组，B 归到测试组
  const convA = await prismaBase.conversation.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      title: '对话A（隔离）',
    },
  });
  const convB = await prismaBase.conversation.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      title: '对话B（同组）',
      groupId: testGroup.id,
    },
  });
  const convC = await prismaBase.conversation.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      title: '对话C（同组但内容不同）',
      groupId: testGroup.id,
    },
  });
  console.log(`✓ 创建对话: A=${convA.id.slice(0, 8)} (无组), B=${convB.id.slice(0, 8)}, C=${convC.id.slice(0, 8)} (同组)\n`);

  // 准备 3：在 A、B、C 里各塞一条带独特关键词的消息
  const keyword = `测试关键词_${Date.now()}`;
  await prismaBase.message.create({
    data: { conversationId: convA.id, role: 'user', content: `对话A内容包含${keyword}这是隔离测试` },
  });
  await prismaBase.message.create({
    data: { conversationId: convB.id, role: 'user', content: `对话B内容包含${keyword}这是同组共享测试` },
  });
  await prismaBase.message.create({
    data: { conversationId: convC.id, role: 'assistant', content: `对话C内容包含${keyword}另一条同组记录` },
  });
  console.log(`✓ 插入 3 条带关键词 [${keyword}] 的消息\n`);

  // ============== 测试 1：A 不分组 → 只能检索 A 自己 ==============
  console.log('--- 测试 1：A 隔离模式（无 groupId）---');
  const r1 = await retrieve({
    query: keyword,
    sources: ['conversation'],
    userId: user.id,
    conversationId: convA.id,
  });
  const r1Titles = r1.references.map((r) => r.title);
  console.log(`  检索到 ${r1.references.length} 条`);
  assert(r1.references.length === 1, 'A 隔离模式：应只检索到 1 条（仅 A 自己）');
  assert(r1Titles[0]?.includes('当前'), 'A 检索到的应是"当前"对话的消息');

  // ============== 测试 2：B 有 groupId → 检索整个组（A 不可见） ==============
  console.log('\n--- 测试 2：B 同组共享模式 ---');
  const r2 = await retrieve({
    query: keyword,
    sources: ['conversation'],
    userId: user.id,
    conversationId: convB.id,
  });
  console.log(`  检索到 ${r2.references.length} 条`);
  assert(r2.references.length === 2, 'B 同组共享：应检索到 2 条（B + C）');
  // 验证 A 的消息不在结果里
  const r2HasA = r2.references.some((r) => r.title.includes('对话A'));
  assert(!r2HasA, 'B 同组检索不应包含 A（隔离生效）');

  // ============== 测试 3：跨用户隔离 ==============
  console.log('\n--- 测试 3：越权防护（userId 不匹配）---');
  const r3 = await retrieve({
    query: keyword,
    sources: ['conversation'],
    userId: 'fake-user-id-12345', // 不存在的用户 ID
    conversationId: convB.id,
  });
  assert(r3.references.length === 0, '错误 userId 应返回 0 条（防越权）');

  // ============== 测试 4：无 conversationId 时 conversation 源跳过 ==============
  console.log('\n--- 测试 4：无 conversationId ---');
  const r4 = await retrieve({
    query: keyword,
    sources: ['conversation'],
    userId: user.id,
    // conversationId 故意省略
  });
  assert(r4.references.length === 0, '无 conversationId 应跳过 conversation 源');

  // 清理
  console.log('\n--- 清理测试数据 ---');
  await prismaBase.message.deleteMany({ where: { conversationId: { in: [convA.id, convB.id, convC.id] } } });
  await prismaBase.conversation.deleteMany({ where: { id: { in: [convA.id, convB.id, convC.id] } } });
  await prismaRawDelete(testGroup.id); // 需要引入 conversationGroup 模型

  console.log('\n✅ RAG-P2-A 所有测试通过');
}

async function prismaRawDelete(groupId: string) {
  // prismaBase.conversationGroup 在 client 里已可用
  await prismaBase.conversationGroup.deleteMany({ where: { id: groupId } });
}

main().catch((e) => {
  console.error('测试崩溃:', e);
  process.exit(1);
});
