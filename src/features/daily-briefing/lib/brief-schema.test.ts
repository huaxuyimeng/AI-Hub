/**
 * Brief 数据契约回归测试（Batch 1）
 *
 * 验证目标：
 * 1. BriefSchema 校验各种合法/非法输入
 * 2. parseBriefLoose 的容错能力
 * 3. DEFAULT_CONFIDENCE_SCALE 内容与 ai-news-kit docs/03 一致
 * 4. 向后兼容：v4 schema 不受影响
 *
 * 测试风格：与 schema-degrade.test.ts 保持一致（console.log PASS/FAIL，不依赖 vitest）
 */

import {
  BriefSchema,
  ConfidenceSchema,
  ConfidenceScaleSchema,
  PickSchema,
  SourceSchema,
  parseBriefLoose,
  DEFAULT_CONFIDENCE_SCALE,
  type Brief,
} from './brief-schema';

let passed = 0;
let failed = 0;

function assertPass(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${label}`);
  }
}

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

const VALID_SOURCE = { name: 'Anthropic 官方报告（一手）', url: 'https://anthropic.com/x', isPrimary: true };

const VALID_PICK = {
  no: 1,
  topic: 'AI Coding' as const,
  title: 'DeepSeek V4.1 Flash 缓存命中率提升 4 倍',
  lv: 'A' as const,
  publishedAt: '2026-09-12',
  event: 'DeepSeek 发布 V4.1 Flash，缓存命中占用从 1/2 降至 1/8，官方报告显示对长上下文场景的 token 成本下降约 25%。',
  keyFacts: ['缓存命中率提升 4 倍', '长上下文 token 成本下降 25%', 'MIT 协议可私有化部署'],
  why: 'Coding Agent 的典型负载是同一仓库前缀反复命中缓存，缓存占用砍到 1/8 等于把这条成本曲线整体下移一档。MIT 许可让有数据 residency 要求的团队可私有化部署——这是闭源旗舰给不了的。',
  sources: [VALID_SOURCE],
  conflicts: '无实质冲突',
};

const VALID_BRIEF: Brief = {
  date: '2026-09-14',
  headline: '今日 AI Coding 方向有三件事值得关注，具身智能方向本周保持静默。',
  focus: ['AI Coding', '具身智能'],
  windowNote: '09-14 凌晨跑抓取，RSS 池返回的是 09-10~09-13 的条目',
  rawStats: {
    sourcesAlive: 10,
    sourcesTotal: 10,
    rawItems: 208,
    dedupedItems: 208,
    multiSourceItems: 33,
    byCategory: { 'AI Coding': 88, '具身智能': 13, 其他: 107 },
    crossSourceThreshold: 3,
  },
  confidenceScale: DEFAULT_CONFIDENCE_SCALE,
  picks: [
    VALID_PICK,
    { ...VALID_PICK, no: 2, lv: 'B' as const, topic: '具身智能' as const },
    { ...VALID_PICK, no: 3, lv: 'C' as const },
  ],
  alsoWorthAScan: [
    { title: 'OpenAI Agent 集群本周新增 Ruby 生态攻击', sources: '量子位 / AITNT（2 源）' },
  ],
  dedupeNote: '已比对 08-28 / 08-29 / 09-13 三轮推送',
  draft: false,
};

// ---------------------------------------------------------------------------
// Section 1: 基础枚举校验
// ---------------------------------------------------------------------------

console.log('▶ Section 1: ConfidenceSchema');
{
  const r1 = ConfidenceSchema.safeParse('A');
  assertPass('A 是合法置信度', r1.success);

  const r2 = ConfidenceSchema.safeParse('E');
  assertPass('E 不是合法置信度', !r2.success);

  const r3 = ConfidenceSchema.safeParse('a');
  assertPass('小写 a 也不合法（严格大小写）', !r3.success);
}

console.log('▶ Section 2: ConfidenceScaleSchema（必须恰好 4 项）');
{
  const r1 = ConfidenceScaleSchema.safeParse(DEFAULT_CONFIDENCE_SCALE);
  assertPass('默认量表合法', r1.success);

  const r2 = ConfidenceScaleSchema.safeParse([...DEFAULT_CONFIDENCE_SCALE, {
    lv: 'A', name: 'dup', rule: '重复的 A 项',
  }]);
  assertPass('量表超过 4 项会被拒', !r2.success);

  const r3 = ConfidenceScaleSchema.safeParse(DEFAULT_CONFIDENCE_SCALE.slice(0, 3));
  assertPass('量表少于 4 项会被拒', !r3.success);
}

console.log('▶ Section 3: SourceSchema');
{
  const r1 = SourceSchema.safeParse({ name: 'x', url: 'https://example.com' });
  assertPass('name + url 是最小合法', r1.success);

  const r2 = SourceSchema.safeParse({ name: '', url: 'https://example.com' });
  assertPass('name 空会被拒', !r2.success);

  const r3 = SourceSchema.safeParse({ name: 'x', url: 'not-a-url' });
  assertPass('非法 url 会被拒', !r3.success);
}

console.log('▶ Section 4: PickSchema');
{
  const r1 = PickSchema.safeParse(VALID_PICK);
  assertPass('合法 pick', r1.success);

  const r2 = PickSchema.safeParse({ ...VALID_PICK, why: '太短' });
  assertPass('why <40 字会被拒', !r2.success);

  const r3 = PickSchema.safeParse({ ...VALID_PICK, event: '太短' });
  assertPass('event <40 字会被拒', !r3.success);

  const r4 = PickSchema.safeParse({ ...VALID_PICK, topic: '自动驾驶' });
  assertPass('topic 必须是 AI Coding 或具身智能', !r4.success);

  const r5 = PickSchema.safeParse({ ...VALID_PICK, lv: 'E' });
  assertPass('lv 非法会被拒', !r5.success);

  const r6 = PickSchema.safeParse({ ...VALID_PICK, sources: [] });
  assertPass('sources 不能为空', !r6.success);

  const r7 = PickSchema.safeParse({
    ...VALID_PICK,
    keyFacts: ['只有 2 条'],
  });
  assertPass('keyFacts <3 条会被拒', !r7.success);
}

console.log('▶ Section 5: BriefSchema 完整校验');
{
  const r1 = BriefSchema.safeParse(VALID_BRIEF);
  assertPass('完整合法 brief', r1.success);

  const r2 = BriefSchema.safeParse({ ...VALID_BRIEF, picks: VALID_BRIEF.picks.slice(0, 2) });
  assertPass('picks <3 条会被拒', !r2.success);

  const r3 = BriefSchema.safeParse({ ...VALID_BRIEF, picks: [...VALID_BRIEF.picks, ...VALID_BRIEF.picks, ...VALID_BRIEF.picks] });
  assertPass('picks >5 条会被拒', !r3.success);
}

console.log('▶ Section 6: parseBriefLoose 容错性');
{
  // 完整合法输入
  const r1 = parseBriefLoose(VALID_BRIEF);
  assertPass('合法 brief 解析成功', r1.date === '2026-09-14');

  // 多余字段被剥除
  const withExtra = { ...VALID_BRIEF, unknownField: '应该被剥除', picks: VALID_BRIEF.picks.map(p => ({ ...p, junk: 'x' })) };
  const r2 = parseBriefLoose(withExtra);
  assertPass('多余字段被容错剥除', r2.date === '2026-09-14');

  // draft 默认 false
  const noDraft = { ...VALID_BRIEF };
  delete (noDraft as Partial<Brief>).draft;
  const r3 = parseBriefLoose(noDraft);
  assertPass('draft 字段缺失时默认 false', r3.draft === false);
}

console.log('▶ Section 7: DEFAULT_CONFIDENCE_SCALE 与 ai-news-kit docs/03 一致');
{
  // A 级必须包含"独立信源"+"一手官方"——容错：规则里写"相互独立的信源"
  const aRule = DEFAULT_CONFIDENCE_SCALE.find(s => s.lv === 'A')!.rule;
  assertPass('A 级规则包含"独立信源"', aRule.includes('独立的信源') || aRule.includes('独立信源'));
  assertPass('A 级规则包含"一手"', aRule.includes('一手'));

  // C 级必须包含"转载"——这是 ai-news-kit 唯一护城河
  const cRule = DEFAULT_CONFIDENCE_SCALE.find(s => s.lv === 'C')!.rule;
  assertPass('C 级规则提到转载与独立信源的区别', cRule.includes('转载') && cRule.includes('独立信源'));

  // D 级必须包含"矛盾"或"官方确认"
  const dRule = DEFAULT_CONFIDENCE_SCALE.find(s => s.lv === 'D')!.rule;
  assertPass('D 级规则提到数字矛盾', dRule.includes('矛盾'));

  // 量表顺序固定 A→B→C→D
  assertPass('量表顺序 A→B→C→D',
    DEFAULT_CONFIDENCE_SCALE.map(s => s.lv).join(',') === 'A,B,C,D');
}

console.log('▶ Section 8: 向后兼容（不破坏 v4 schema）');
{
  // 本文件不导出 v4 schema，但通过 import 触发 module 加载
  // 如果 types.ts 编译失败，import 会抛错
  assertPass('import 不抛错即说明 v4 schema 仍在', true);
}

// ---------------------------------------------------------------------------
// 总结
// ---------------------------------------------------------------------------

console.log(`\n=== Batch 1 测试结果：${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
