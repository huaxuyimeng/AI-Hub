/**
 * slide-engine 单元测试（Phase 0 地基）
 * 运行：npx tsx src/lib/slide-engine/slide-engine.test.ts
 */

import { z } from 'zod';
import type { ThemeTokens } from './contracts/theme';
import type { Box, PlacedBox, PlacedSlide, TextMeta } from './contracts/geometry';
import type { PageTypeDefinition } from './contracts/page-type';
import {
  measureWidth,
  measureLines,
  nextSmallerSize,
  dropTail,
  passCapacity,
  checkCapacity,
  registerPageType,
  getPageType,
  hasPageType,
  listPageTypes,
  clearPageTypes,
  lintSlide,
  lintDeck,
} from './index';
import {
  registerBriefingPageTypes,
  resetBriefingPageTypes,
} from './templates/briefing/slides';

let failed = 0;
let total = 0;

function assert(condition: boolean, message: string): void {
  total += 1;
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`PASS: ${message}`);
  }
}

function closeEnough(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

// ========== 测试基建 ==========

const theme: ThemeTokens = {
  id: 'test',
  colors: {
    primary: '#2563EB', secondary: '#0891B2', accent: '#F59E0B',
    primarySoft: '#EFF6FF', secondarySoft: '#ECFEFF', accentSoft: '#FFFBEB',
    ink: '#16233A', inkMuted: '#5B6B84', inkSubtle: '#94A3B8',
    surface: '#FFFFFF', border: '#E4EAF3',
    text: '#16233A', textMuted: '#5B6B84', textSubtle: '#94A3B8', textFaint: '#CBD5E1',
    primaryDark: '#1D4ED8', secondaryDark: '#0E7490', accentDark: '#D97706',
    accentText: '#92400E',
    lightBlue: '#EFF6FF', lightCyan: '#ECFEFF', lightAmber: '#FFFBEB',
    bgCard: '#F8FAFC', borderLight: '#EEF2F7', linkBlue: '#1D4ED8',
  },
  fonts: { cn: 'Microsoft YaHei', num: 'Inter' },
  type: {
    mega: { size: 120, weight: 700, lineHeight: 1.0 },
    display: { size: 40, weight: 700, lineHeight: 1.2 },
    h1: { size: 28, weight: 700, lineHeight: 1.3 },
    h2: { size: 20, weight: 600, lineHeight: 1.4 },
    h3: { size: 16, weight: 700, lineHeight: 1.3 },
    body: { size: 14, weight: 400, lineHeight: 1.6 },
    caption: { size: 11, weight: 400, lineHeight: 1.5 },
    micro: { size: 9, weight: 400, lineHeight: 1.5 },
    number: { size: 32, weight: 700, lineHeight: 1.1 },
  },
  page: { width: 960, height: 540 },
  margin: { x: 36, y: 24 },
};

function mkText(value: string, over: Partial<TextMeta> = {}): TextMeta {
  return {
    value, font: 'cn', size: 16, weight: 400, lineHeight: 1.6,
    align: 'left', color: '#16233A', maxLines: 10, ...over,
  };
}

function mkBox(id: string, slot: string, box: Box, over: Partial<PlacedBox> = {}): PlacedBox {
  return { id, slot, kind: 'text', box, z: 0, ...over };
}

function mkSlide(pageNo: number, totalPages: number, boxes: PlacedBox[], over: Partial<PlacedSlide> = {}): PlacedSlide {
  return { pageNo, totalPages, pageType: `page-${pageNo}`, boxes, ...over };
}

function countIssues(issues: { rule: string }[], rule: string): number {
  return issues.filter((x) => x.rule === rule).length;
}

// ========== 文本测量 ==========

console.log('--- measureWidth ---');
assert(closeEnough(measureWidth('中中', 16), 32), '两个全角字符 @16pt = 32pt');
assert(closeEnough(measureWidth('AB', 16), 23.04), '两个大写字母 @16pt = 23.04pt');
assert(closeEnough(measureWidth('12', 16), 18.56), '两个数字 @16pt = 18.56pt');
assert(closeEnough(measureWidth('a b', 16), 22.4), '小写加空格 @16pt = 22.4pt');
assert(closeEnough(measureWidth('中', 16, { weight: 700 }), 16.8), '粗体全角加宽 5%');
assert(measureWidth('', 16) === 0, '空串宽度为 0');

console.log('--- measureLines ---');
assert(measureLines('', 16, 100) === 0, '空文本 0 行');
assert(measureLines('中中中中', 16, 64) === 1, '四个全角恰好占满 64pt 为 1 行');
assert(measureLines('中中中中中', 16, 64) === 2, '五个全角在 64pt 宽折为 2 行');
assert(measureLines('aaaa bbbb', 16, 100) === 1, '两个短词在 100pt 内 1 行');
assert(measureLines('aaaa bbbb', 16, 40) === 2, '两个短词在 40pt 宽折为 2 行');
assert(measureLines('aaaaaaaa', 16, 40) === 2, '超长词 71.68pt 在 40pt 宽占 2 行');
assert(measureLines('aaaaaaaaaaaa', 16, 40) === 3, '超长词 107.52pt 在 40pt 宽占 3 行');
assert(measureLines('x', 16, 0) === Number.POSITIVE_INFINITY, '宽度非法返回 Infinity');

// ========== 降级工具 ==========

console.log('--- degrade ---');
assert(nextSmallerSize(theme, 14) === 11, 'body 14pt 的下一小档是 caption 11pt');
assert(nextSmallerSize(theme, 11) === 9, 'caption 11pt 的下一小档是 micro 9pt');
assert(nextSmallerSize(theme, 9) === null, '最小档无更小档返回 null');
assert(dropTail([1, 2, 3, 4], 2).dropped === 2, '4 条裁到 2 条丢 2 条');
assert(dropTail([1], 2).dropped === 0, '不超限不裁');

// ========== 容量检查 ==========

console.log('--- capacity ---');
assert(passCapacity().ok === true, '空预算直接通过');
const capChars = checkCapacity(
  [{ slot: 'summary', chars: 250 }],
  [{ slot: 'summary', maxChars: 220 }],
);
assert(capChars.ok === false, '字数超限不通过');
assert(capChars.overflows[0].action === 'compress', '字数超限动作是压缩');
const capItems = checkCapacity(
  [{ slot: 'bullets', items: 7 }],
  [{ slot: 'bullets', maxItems: 6 }],
);
assert(capItems.overflows[0].action === 'truncate', '条目超限动作是截断');
assert(checkCapacity([{ slot: 'summary', chars: 100 }], [{ slot: 'summary', maxChars: 220 }]).ok === true, '未超限通过');

// ========== 页型注册表 ==========

console.log('--- registry ---');
clearPageTypes();
const dummy: PageTypeDefinition = {
  key: 'dummy',
  title: '测试页',
  contentSchema: z.object({}),
  slots: ['header'],
  capacity: () => passCapacity(),
  plan: () => ({ pageNo: 1, totalPages: 1, pageType: 'dummy', boxes: [] }),
};
registerPageType(dummy);
assert(getPageType('dummy').key === 'dummy', '注册后可按 key 取回');
assert(hasPageType('dummy') === true, 'hasPageType 正确');
let dupThrown = false;
try {
  registerPageType(dummy);
} catch {
  dupThrown = true;
}
assert(dupThrown, '重复注册抛错');
let missThrown = false;
try {
  getPageType('nope');
} catch {
  missThrown = true;
}
assert(missThrown, '未注册 key 抛错');
clearPageTypes();

// 早报页型注册必须幂等：低层 registerPageType 重复注册会抛，
// 但早报这一层被 route / render-pptx / qa-gate / 预览组件反复调用，
// 一旦抛错，常驻进程里第二次渲染就会「第一次正常、之后静默失败」。
{
  resetBriefingPageTypes();
  const n1 = listPageTypes().length;
  let secondThrown = false;
  try {
    registerBriefingPageTypes();
    registerBriefingPageTypes();
  } catch {
    secondThrown = true;
  }
  assert(!secondThrown, 'registerBriefingPageTypes 可重复调用不抛错');
  assert(listPageTypes().length === n1, `重复注册不改变页型数量（${n1} → ${listPageTypes().length}）`);
  assert(hasPageType('direction-detail') && hasPageType('disclaimer'), '早报页型齐全');
}

// ========== L1 越界 ==========

console.log('--- lint L1 ---');
const l1Canvas = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'header', { x: 950, y: 100, w: 20, h: 40 })]),
  theme,
);
assert(countIssues(l1Canvas, 'L1') === 1, '越出画布报 L1');

const l1Safe = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'header', { x: 10, y: 100, w: 50, h: 40 })]),
  theme,
);
assert(countIssues(l1Safe, 'L1') === 1, '越出安全区报 L1');

const l1UnsafeAllowed = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'page-no', { x: 10, y: 500, w: 50, h: 20 }, { allowUnsafe: true })]),
  theme,
);
assert(countIssues(l1UnsafeAllowed, 'L1') === 0, 'allowUnsafe 的页码盒不报 L1');

const l1Decor = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'deco', { x: 0, y: 0, w: 960, h: 8 }, { kind: 'bar', decorative: true, fill: '#2563EB' })]),
  theme,
);
assert(countIssues(l1Decor, 'L1') === 0, '装饰条不报 L1');

const l1Zero = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'header', { x: 100, y: 100, w: 0, h: 40 })]),
  theme,
);
assert(countIssues(l1Zero, 'L1') === 1, '零宽盒报 L1');

// ========== L2 文本溢出 ==========

console.log('--- lint L2 ---');
const l2Height = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'summary', { x: 40, y: 40, w: 64, h: 26 }, { text: mkText('中中中中中') })]),
  theme,
);
assert(countIssues(l2Height, 'L2') === 1, '两行文本高 51.2pt 超 26pt 盒高报 L2');

const l2MaxLines = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'summary', { x: 40, y: 40, w: 64, h: 100 }, { text: mkText('中中中中中', { maxLines: 1 }) })]),
  theme,
);
assert(countIssues(l2MaxLines, 'L2') === 1, '超 maxLines 报 L2');

const l2Fit = lintSlide(
  mkSlide(1, 1, [mkBox('b1', 'summary', { x: 40, y: 40, w: 64, h: 30 }, { text: mkText('中中中中') })]),
  theme,
);
assert(countIssues(l2Fit, 'L2') === 0, '恰好放下的文本不报 L2');

// ========== L3 重叠 ==========

console.log('--- lint L3 ---');
const l3Partial = lintSlide(
  mkSlide(1, 1, [
    mkBox('a', 'left', { x: 100, y: 100, w: 200, h: 50 }),
    mkBox('b', 'right', { x: 250, y: 120, w: 100, h: 50 }),
  ]),
  theme,
);
assert(countIssues(l3Partial, 'L3') === 1, '部分重叠报 L3');

const l3Contain = lintSlide(
  mkSlide(1, 1, [
    mkBox('card', 'panel', { x: 100, y: 100, w: 200, h: 100 }, { kind: 'card', fill: '#EFF6FF' }),
    mkBox('t', 'panel-title', { x: 110, y: 110, w: 180, h: 30 }, { text: mkText('标题') }),
  ]),
  theme,
);
assert(countIssues(l3Contain, 'L3') === 0, '卡片包含文本是容器关系不报 L3');

const l3Touch = lintSlide(
  mkSlide(1, 1, [
    mkBox('a', 'left', { x: 100, y: 100, w: 100, h: 50 }),
    mkBox('b', 'right', { x: 200, y: 100, w: 100, h: 50 }),
  ]),
  theme,
);
assert(countIssues(l3Touch, 'L3') === 0, '相邻贴合不算重叠');

const l3Decor = lintSlide(
  mkSlide(1, 1, [
    mkBox('bar', 'deco', { x: 100, y: 100, w: 400, h: 8 }, { kind: 'bar', decorative: true }),
    mkBox('t', 'title', { x: 100, y: 100, w: 300, h: 30 }, { text: mkText('标题压在装饰条上') }),
  ]),
  theme,
);
assert(countIssues(l3Decor, 'L3') === 0, '装饰元素可被重叠');

const l3Exact = lintSlide(
  mkSlide(1, 1, [
    mkBox('a', 'left', { x: 100, y: 100, w: 200, h: 50 }),
    mkBox('b', 'right', { x: 100, y: 100, w: 200, h: 50 }),
  ]),
  theme,
);
assert(countIssues(l3Exact, 'L3') === 1, '完全重合报 L3');
assert(
  l3Exact.some((x) => x.rule === 'L3' && x.detail.includes('完全重合')),
  '完全重合的 detail 标注明确',
);

// ========== L4 容量 ==========

console.log('--- lint L4 ---');
const l4Slide = mkSlide(1, 1, [], {
  capacity: { ok: false, overflows: [{ slot: 'summary', kind: 'chars', actual: 250, budget: 220, action: 'compress' }] },
});
const l4Issues = lintSlide(l4Slide, theme);
assert(countIssues(l4Issues, 'L4') === 1, '附带的容量失败报 L4');
assert(l4Issues[0].level === 'error', '压缩类超限是 error');

// ========== lintDeck：L5 与 L6 ==========

console.log('--- lintDeck L5 / L6 ---');
const deckBad = [
  mkSlide(1, 1, [mkBox('p', 'page-no', { x: 900, y: 500, w: 40, h: 20 }, { allowUnsafe: true, text: mkText('2 / 2', { size: 11, lineHeight: 1.5, font: 'num' }) })]),
  mkSlide(2, 1, [mkBox('p', 'page-no', { x: 900, y: 500, w: 40, h: 20 }, { allowUnsafe: true, text: mkText('2 / 2', { size: 11, lineHeight: 1.5, font: 'num' }) })]),
];
const deckBadReport = lintDeck(deckBad, theme);
assert(countIssues(deckBadReport.issues, 'L5') >= 2, 'totalPages 与实际页数不符报 L5');
assert(deckBadReport.passed === false, '有 error 时报告不通过');

const deckPageNoWrong = [
  mkSlide(2, 2, [mkBox('p', 'page-no', { x: 900, y: 500, w: 40, h: 20 }, { allowUnsafe: true, text: mkText('1 / 2', { size: 11, lineHeight: 1.5, font: 'num' }) })]),
  mkSlide(2, 2, [mkBox('p', 'page-no', { x: 900, y: 500, w: 40, h: 20 }, { allowUnsafe: true, text: mkText('2 / 2', { size: 11, lineHeight: 1.5, font: 'num' }) })]),
];
const deckPageNoReport = lintDeck(deckPageNoWrong, theme);
assert(
  deckPageNoReport.issues.some((x) => x.rule === 'L5' && x.detail.includes('pageNo')),
  'pageNo 序号错乱报 L5',
);

const sevenBullets = Array.from({ length: 7 }, (_, i) =>
  mkBox(`bl-${i}`, `bullet-${i + 1}`, { x: 40, y: 40 + i * 32, w: 400, h: 30 }, { text: mkText(`条目${i + 1}`) }),
);
const deckDensity = lintDeck([mkSlide(1, 1, sevenBullets)], theme);
assert(countIssues(deckDensity.issues, 'L6') === 1, '7 条 bullet 报 L6 密度警告');
assert(deckDensity.issues[0].level === 'warn', '密度问题是 warn 级');

// 连续同页型：5 张以内是刻意的序列化展开（如逐条详情页），不报
const deckRepeatOk = lintDeck(
  Array.from({ length: 5 }, (_, i) => mkSlide(i + 1, 5, [], { pageType: 'detail' })),
  theme,
);
assert(
  !deckRepeatOk.issues.some((x) => x.rule === 'L6'),
  '连续 5 张同页型（序列化展开）不报 L6',
);

// 连续同页型：超 5 张提示编排异常
const deckRepeat = lintDeck(
  Array.from({ length: 7 }, (_, i) => mkSlide(i + 1, 7, [], { pageType: 'detail' })),
  theme,
);
assert(
  deckRepeat.issues.some((x) => x.rule === 'L6' && x.detail.includes('连续')),
  '连续 7 张同页型报 L6',
);

// ========== lint L7：字号栅格 ==========
const l7Off = lintDeck([mkSlide(1, 1, [
  mkBox('t', 'title', { x: 40, y: 40, w: 400, h: 40 }, { text: mkText('标题', { size: 17 }) }),
])], theme);
assert(countIssues(l7Off.issues, 'L7') === 1, '17pt 不在栅格内报 L7');
assert(l7Off.issues[0].level === 'warn', 'L7 是 warn 级');

const l7On = lintDeck([mkSlide(1, 1, [
  mkBox('t', 'title', { x: 40, y: 40, w: 400, h: 40 }, { text: mkText('标题', { size: 16 }) }),
])], theme);
assert(countIssues(l7On.issues, 'L7') === 0, '栅格内字号不报 L7');

// ========== 干净整副通过 ==========

console.log('--- lintDeck 干净样例 ---');
const cleanDeck = [
  mkSlide(1, 2, [
    mkBox('t', 'title', { x: 40, y: 40, w: 400, h: 40 }, { text: mkText('AI 早报') }),
    mkBox('p', 'page-no', { x: 880, y: 500, w: 50, h: 20 }, { allowUnsafe: true, text: mkText('1 / 2', { size: 11, lineHeight: 1.5, font: 'num' }) }),
  ]),
  mkSlide(2, 2, [
    mkBox('card', 'panel', { x: 40, y: 40, w: 880, h: 200 }, { kind: 'card', fill: '#EFF6FF' }),
    mkBox('t', 'panel-title', { x: 60, y: 60, w: 500, h: 36 }, { text: mkText('今日概览') }),
    mkBox('p', 'page-no', { x: 880, y: 500, w: 50, h: 20 }, { allowUnsafe: true, text: mkText('2 / 2', { size: 11, lineHeight: 1.5, font: 'num' }) }),
  ], { pageType: 'overview' }),
];
const cleanReport = lintDeck(cleanDeck, theme);
assert(cleanReport.issues.length === 0, `干净样例零问题（实际 ${cleanReport.issues.length} 条）`);
assert(cleanReport.passed === true, '干净样例通过');

// ========== 汇总 ==========

console.log(`\n===== ${total - failed}/${total} 通过 =====`);
if (failed > 0) {
  process.exit(1);
}
