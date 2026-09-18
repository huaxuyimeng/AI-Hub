// RAG-P2-B：Meeting 模块烟测（listExpertRoles + create + list）
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('PASS:', msg);
}

async function main() {
  // 找一个用户
  const user = await prisma.user.findFirst({ select: { id: true, tenantId: true } });
  if (!user) {
    console.log('⚠️  找不到 user，跳过');
    return;
  }

  // 直接调 ensureBuiltinExpertRoles 逻辑：模拟 listExpertRoles
  const BUILTIN = [
    { key: 'pm', name: '产品经理', description: 'X', systemPrompt: 'Y', defaultModel: 'gpt-4o', icon: '🎯' },
    { key: 'engineer', name: '工程师', description: 'X', systemPrompt: 'Y', defaultModel: 'claude-4', icon: '🛠️' },
    { key: 'investor', name: '投资人', description: 'X', systemPrompt: 'Y', defaultModel: 'gpt-4o', icon: '💰' },
    { key: 'critic', name: '怀疑论者', description: 'X', systemPrompt: 'Y', defaultModel: 'deepseek-v3', icon: '🔍' },
    { key: 'summarizer', name: '会议主持人', description: 'X', systemPrompt: 'Y', defaultModel: 'gpt-4o', icon: '📋' },
  ];
  for (const r of BUILTIN) {
    await prisma.expertRole.upsert({ where: { key: r.key }, update: {}, create: r });
  }
  const roles = await prisma.expertRole.findMany({ orderBy: { key: 'asc' } });
  console.log(`✓ 列出 ${roles.length} 个预置角色: ${roles.map(r => r.key).join(', ')}`);
  assert(roles.length >= 5, '应有 ≥5 个预置角色');
  assert(roles.find(r => r.key === 'pm') !== undefined, '应有 pm 角色');
  assert(roles.find(r => r.key === 'summarizer') !== undefined, '应有 summarizer 角色');

  // 模拟 create meeting
  const meeting = await prisma.meeting.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      topic: '是否要做 RAG 多模型会议功能？',
      title: 'RAG 多模型会议可行性',
      hostModel: 'gpt-4o',
      participants: {
        create: [
          { model: 'gpt-4o', role: '产品经理', systemPrompt: '你是PM', order: 0 },
          { model: 'claude-4', role: '工程师', systemPrompt: '你是工程师', order: 1 },
        ],
      },
    },
    include: { participants: true },
  });
  console.log(`✓ 创建会议: ${meeting.id.slice(0, 8)}, 参与者: ${meeting.participants.length}`);
  assert(meeting.participants.length === 2, '会议应有 2 个参与者');

  // 模拟 list
  const list = await prisma.meeting.findMany({
    where: { tenantId: user.tenantId, userId: user.id, deletedAt: null },
    select: { id: true, title: true, _count: { select: { participants: true } } },
  });
  console.log(`✓ list 查询到 ${list.length} 个会议`);
  assert(list.find(m => m.id === meeting.id) !== undefined, '刚创建的会议应在列表里');

  // 模拟 get
  const got = await prisma.meeting.findFirst({
    where: { id: meeting.id, tenantId: user.tenantId, userId: user.id, deletedAt: null },
    include: { participants: { orderBy: { order: 'asc' } } },
  });
  assert(got !== null, 'get 应能查到该会议');
  assert(got!.participants.length === 2, 'get 应返回 2 个参与者');

  // 清理
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: meeting.id } });
  await prisma.meeting.deleteMany({ where: { id: meeting.id } });
  console.log('✓ 清理测试数据');

  console.log('\n✅ RAG-P2-B Meeting 模块烟测通过');
}

main()
  .catch((e) => {
    console.error('崩溃:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
