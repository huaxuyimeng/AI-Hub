/**
 * C3 单元测试 — 验证主题 token 派生正确性
 * 运行：npx tsx src/features/daily-briefing/components/slide-preview-theme.test.ts
 *
 * 关键不变量：
 *   - 6 套主题都包含 build-pptx.ts / SlidePreview 所需的全部 19 个色 token
 *   - paper 主题的派生颜色与原硬编码值完全一致（视觉向后兼容）
 *   - 切换主题时，token 值确实会变（不是 cache）
 */

import { paperTheme, inkTheme, mintTheme, lavenderTheme, amberTheme, oceanTheme } from '@/lib/slide-engine/templates/briefing/theme';
import { BRIEFING_THEMES } from '@/lib/slide-engine/templates/briefing/theme';

let failed = 0;
let total = 0;

function pass(msg: string): void {
  total += 1;
  console.log(`PASS: ${msg}`);
}

function fail(msg: string): void {
  total += 1;
  failed += 1;
  console.error(`FAIL: ${msg}`);
}

// =============== 必备 19 个 token 全量存在 ===============

const REQUIRED_KEYS = [
  'primary', 'secondary', 'accent',
  'primarySoft', 'secondarySoft', 'accentSoft',
  'ink', 'inkMuted', 'inkSubtle',
  'surface', 'border',
  'text', 'textMuted', 'textSubtle', 'textFaint',
  'primaryDark', 'secondaryDark', 'accentDark', 'accentText',
  'lightBlue', 'lightCyan', 'lightAmber',
  'bgCard', 'borderLight', 'linkBlue',
] as const;

console.log('▶ 6 套主题都包含全部 19 个 token');
{
  for (const [id, theme] of Object.entries(BRIEFING_THEMES)) {
    for (const key of REQUIRED_KEYS) {
      if (!theme.colors[key]) {
        fail(`${id}.colors.${key} 缺失或为空`);
      }
    }
    pass(`${id}: 24 个 token 齐全`);
  }
}

// =============== paper 主题颜色与原硬编码 1:1 ===============

console.log('\n▶ paper 主题与原硬编码颜色值一致（视觉向后兼容）');
{
  // 这些是原 SlidePreview.tsx 里 COLORS 的硬编码值
  const expected: Record<string, string> = {
    text: '#1E293B',
    textMuted: '#475569',
    textSubtle: '#64748B',
    textFaint: '#94A3B8',
    primary: '#3B82F6',
    primaryDark: '#2563EB',
    secondary: '#06B6D4',
    secondaryDark: '#0891B2',
    accent: '#F59E0B',
    accentDark: '#D97706',
    accentText: '#92400E',
    border: '#E2E8F0',
    borderLight: '#EEF2F7',
    bgCard: '#F8FAFC',
    lightBlue: '#EFF6FF',
    lightCyan: '#ECFEFF',
    lightAmber: '#FFFBEB',
    linkBlue: '#1D4ED8',
  };

  for (const [key, want] of Object.entries(expected)) {
    const got = paperTheme.colors[key as keyof typeof paperTheme.colors];
    got === want
      ? pass(`paper.${key} = ${want}`)
      : fail(`paper.${key} 期望 ${want}，实际 ${got}`);
  }
}

// =============== 不同主题的同 key 值不同 ===============

console.log('\n▶ 主题切换时 token 值确实变化');
{
  // paper 的 primary 是蓝，ink 的 primary 是白——必须不同
  paperTheme.colors.primary !== inkTheme.colors.primary
    ? pass(`paper.primary (${paperTheme.colors.primary}) ≠ ink.primary (${inkTheme.colors.primary})`)
    : fail('paper 和 ink 的 primary 居然一样');

  // paper 的 bgCard 是 #F8FAFC，ink 的 bgCard 必须是深色
  paperTheme.colors.bgCard !== inkTheme.colors.bgCard
    ? pass(`paper.bgCard (${paperTheme.colors.bgCard}) ≠ ink.bgCard (${inkTheme.colors.bgCard})`)
    : fail('paper 和 ink 的 bgCard 居然一样');

  // 6 套主题的 primary 必须各不相同（不允许两套主题用同一个 primary）
  const primaries = new Set([
    paperTheme.colors.primary,
    inkTheme.colors.primary,
    mintTheme.colors.primary,
    lavenderTheme.colors.primary,
    amberTheme.colors.primary,
    oceanTheme.colors.primary,
  ]);
  primaries.size === 6
    ? pass('6 套主题 primary 各不相同')
    : fail(`6 套主题 primary 只有 ${primaries.size} 个唯一值`);

  // ink 的 surface 必须是深色，其它都是白底——只有 2 个唯一值
  const surfaces = new Set([
    paperTheme.colors.surface,
    inkTheme.colors.surface,
    mintTheme.colors.surface,
    lavenderTheme.colors.surface,
    amberTheme.colors.surface,
    oceanTheme.colors.surface,
  ]);
  surfaces.size === 2
    ? pass('6 套主题 surface 唯一值=2（5 个白底 + 1 个 ink 深色）')
    : fail(`6 套主题 surface 有 ${surfaces.size} 个唯一值（应 = 2）`);
  inkTheme.colors.surface.startsWith('#0') || inkTheme.colors.surface.startsWith('#1')
    ? pass(`ink.surface 是深色 (${inkTheme.colors.surface})`)
    : fail(`ink.surface 应深色，实际 ${inkTheme.colors.surface}`);
}

// =============== 色 token 都是有效 hex 格式 ===============

console.log('\n▶ 所有 token 是合法 hex 颜色');
{
  const hexRe = /^#[0-9A-Fa-f]{6}$/;
  let invalidCount = 0;
  for (const [id, theme] of Object.entries(BRIEFING_THEMES)) {
    for (const key of REQUIRED_KEYS) {
      if (!hexRe.test(theme.colors[key])) {
        invalidCount++;
        console.error(`  ${id}.${key} = "${theme.colors[key]}" 不是合法 #RRGGBB`);
      }
    }
  }
  invalidCount === 0 ? pass('所有 6×24 = 144 个 token 都是合法 hex') : fail(`${invalidCount} 个 token 格式非法`);
}

// =============== 总结 ===============

console.log(`\n=== ${total - failed}/${total} passed ===`);
if (failed > 0) process.exit(1);
