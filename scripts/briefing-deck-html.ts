/**
 * 早报 deck → 静态 HTML 导出
 * 路径：scripts/briefing-deck-html.ts
 *
 * 用途：把 PlacedSlide[] 渲染成一份纯静态 HTML（每页一张 960×540 画布），
 * 便于用无头 Chrome 截图做**像素级视觉验证** —— PPTX 本身没法直接看图，
 * 而它和 web 渲染器共用同一份 PlacedSlide 几何，所以看到的就是布局真相。
 *
 * 注意：这份 HTML 的输出样式是**手写的**，刻意与 SlideCanvas.tsx 保持一致。
 * 若二者偏离，截图就不再代表 PPT 真实观感 —— 改 SlideCanvas 时记得同步这里。
 *
 * ⚠️ 零内边距是硬约束：
 *   本导出器（与 SlideCanvas）对文本框**不加任何 padding**，即假设「盒子多大，文字就能占多大」。
 *   PPTX 侧必须与之对齐 —— renderer.ts 已显式传 `margin: 0`，
 *   否则 pptxgenjs 不写 lIns/rIns/tIns/bIns，PowerPoint 会套用默认内边距
 *   （左右各 7.2pt、上下各 3.6pt），产物与这里的截图就会差 14.4pt / 7.2pt。
 *   改动这两处任意一侧，都要同时改另一侧。
 *
 *   更重要的教训：截图只能证明"几何模型渲染出来是对的"，
 *   证明不了"PPTX 写对了吗"。渲染层的假设必须回到产物本身核对
 *   —— 用 scripts/audit-pptx.cjs 解包读 XML。
 *
 * 用法：
 *   npx tsx scripts/briefing-deck-html.ts --in=out/lint-input-0913.json --out=out/preview-0913.html
 *   npx tsx scripts/briefing-deck-html.ts --date=2026-09-13
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

import { registerBriefingPageTypes } from '../src/lib/slide-engine/templates/briefing/slides';
import { paperTheme } from '../src/lib/slide-engine/templates/briefing/theme';
import {
  planBriefingDeck,
  planBriefingToPlacedSlides,
} from '../src/lib/slide-engine/templates/briefing/plan';
import { lintDeck } from '../src/lib/slide-engine/qa/lint';
import { DailyReportContentSchema } from '../src/features/daily-briefing/lib/types';
import type { DailyReportContent } from '../src/features/daily-briefing/lib/types';
import type { PlacedSlide, PlacedBox } from '../src/lib/slide-engine/contracts/geometry';
import type { ThemeTokens } from '../src/lib/slide-engine/contracts/theme';

// ============================================================================
// 参数
// ============================================================================

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    const idx = raw.indexOf('=');
    if (idx > 0) out[raw.slice(0, idx)] = raw.slice(idx + 1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// ============================================================================
// 内容装载
// ============================================================================

async function loadFromDb(date: string): Promise<DailyReportContent | null> {
  const dbPath = join(process.cwd(), 'prisma', 'dev.db');
  if (!existsSync(dbPath)) return null;
  try {
    // node:sqlite 是 Node 22 的实验特性，@types/node 尚未提供声明
    // @ts-expect-error 模块无类型声明
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT content FROM DailyReport WHERE date = ?').get(date) as
      | { content: string | null }
      | undefined;
    db.close();
    if (!row?.content) return null;
    const parsed = DailyReportContentSchema.safeParse(JSON.parse(row.content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function loadFromJson(path: string): DailyReportContent | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = DailyReportContentSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ============================================================================
// 样式（与 SlideCanvas.tsx 对齐）
// ============================================================================

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 断言：HTML 里的每个双引号只能充当属性分隔符。
 *
 * 为什么不加这个断言不行：style="..." 内部一旦混入裸双引号（例如字体名写成
 * "Microsoft YaHei"），属性会提前闭合，其后的所有声明被静默丢弃。
 * 页面仍能打开、布局坐标也对，只有字号/字重/颜色全错 ——
 * 靠肉眼在缩略图上几乎发现不了，必须让它在生成阶段就炸出来。
 *
 * 合法形态：`="值"` 中左侧引号前是 `=`，右侧引号后是 空格 / `>` / 换行 / `/`。
 */
function assertNoQuoteLeak(html: string, where: string): void {
  // <style> 块内的 CSS 允许用双引号（如 font-family: "X"），先剔除再校验属性区
  const attrOnly = html.replace(/<style[\s\S]*?<\/style>/gi, '<style></style>');

  for (let i = 0; i < attrOnly.length; i++) {
    if (attrOnly[i] !== '"') continue;
    const prev = i > 0 ? attrOnly[i - 1] : '';
    const next = i + 1 < attrOnly.length ? attrOnly[i + 1] : '';
    const okAsOpen = prev === '=';
    const okAsClose =
      next === '' || next === '>' || next === ' ' || next === '\n' || next === '\t' || next === '/';
    if (!okAsOpen && !okAsClose) {
      const ctx = attrOnly.slice(Math.max(0, i - 70), i + 70).replace(/\n/g, '\\n');
      throw new Error(
        `[${where}] 检测到裸双引号（位置 ${i}）—— style 属性会被提前闭合，后续声明将全部失效。\n` +
          `  上下文：...${ctx}...`,
      );
    }
  }
}

/** #RRGGBB 或 rgb() 原样返回；theme token 已由 plan 解析成最终色值 */
function color(v: string | undefined, fallback: string): string {
  return v && v.trim() ? v : fallback;
}

/**
 * 字体栈。
 *
 * 关键：内部一律用**单引号**。style 属性本身由双引号包裹，
 * 若字体名写成 "Microsoft YaHei" 会提前闭合 style="..."，
 * 导致 font-family 之后的 font-size / font-weight / color / line-height 全部被丢弃
 * —— 表现是"布局对了但字号全错"（标题变成正文字号），且不报任何错。
 */
function fontStack(which: 'cn' | 'num', t: ThemeTokens): string {
  if (which === 'num') {
    return `'${t.fonts.num}','Inter','Helvetica Neue',Arial,sans-serif`;
  }
  const names = [t.fonts.cn, 'Microsoft YaHei', 'PingFang SC'].filter(
    (v, i, a) => v && a.indexOf(v) === i,
  );
  return [...names.map((n) => `'${n}'`), 'sans-serif'].join(',');
}

function boxStyle(b: PlacedBox): string {
  // position:absolute 必须有 —— 缺了它 left/top 全部失效，
  // 所有盒子会退回普通流依次堆叠，整页内容被推出 540px 画布外（表现为"白屏"）。
  // 这个坑踩过一次：PNG 只有 2.7KB 才暴露出来，肉眼在缩略图上根本看不出来。
  const parts = [
    'position:absolute',
    `left:${b.box.x}px`,
    `top:${b.box.y}px`,
    `width:${b.box.w}px`,
    `height:${b.box.h}px`,
    `z-index:${b.z}`,
  ];
  return parts.join(';');
}

function renderBox(b: PlacedBox, t: ThemeTokens): string {
  const base = boxStyle(b);

  switch (b.kind) {
    case 'card':
    case 'badge': {
      const bg = color(b.fill, t.colors.surface);
      const radius = b.radius ? `${b.radius}px` : '8px';
      const border = b.borderColor ? `border:0.5px solid ${b.borderColor};` : '';
      const shell =
        `background:${bg};border-radius:${radius};${border}box-shadow:0 1px 3px rgba(0,0,0,0.08)`;

      // 与 renderer.ts / SlideCanvas.tsx 保持一致：card/badge 上的文字必须渲染出来
      const txt = b.text;
      if (txt?.value) {
        const justify =
          txt.align === 'center' ? 'center' : txt.align === 'right' ? 'flex-end' : 'flex-start';
        const font = fontStack(txt.font === 'num' ? 'num' : 'cn', t);
        return (
          `<div style="${base};display:flex;align-items:center;justify-content:${justify};` +
          `${shell};font-family:${font};font-size:${txt.size}px;font-weight:${txt.weight};` +
          `line-height:${txt.lineHeight};color:${color(txt.color, t.colors.ink)};` +
          `overflow:hidden;white-space:nowrap;padding:0 4px">${esc(txt.value)}</div>`
        );
      }

      return `<div style="${base};${shell}"></div>`;
    }

    case 'divider':
      return `<div style="${base};background:${color(b.fill, t.colors.border)}"></div>`;

    case 'bar':
      return `<div style="${base};background:${color(b.fill, t.colors.primary)};border-radius:${Math.min(b.box.h / 2, 4)}px"></div>`;

    case 'image':
      return `<div style="${base};background:${t.colors.border};border-radius:4px"></div>`;

    case 'text': {
      const txt = b.text;
      if (!txt || !txt.value) return `<div style="${base}"></div>`;
      const font = fontStack(txt.font === 'num' ? 'num' : 'cn', t);
      const align = txt.align ?? 'left';
      const c = color(txt.color, t.colors.ink);
      // flex-start + overflow hidden 与 SlideCanvas 一致
      return (
        `<div style="${base};display:flex;align-items:flex-start;` +
        `font-family:${font};font-size:${txt.size}px;font-weight:${txt.weight};` +
        `line-height:${txt.lineHeight};color:${c};text-align:${align};overflow:hidden">` +
        `${esc(txt.value)}</div>`
      );
    }

    case 'table': {
      const cells = b.cells;
      if (!cells || cells.length === 0) {
        return `<div style="${base};background:${t.colors.surface};border:0.5px solid ${t.colors.border}"></div>`;
      }
      const rows = cells
        .map((row, ri) => {
          const tds = row
            .map((cell) => {
              const font = fontStack(cell.font === 'num' ? 'num' : 'cn', t);
              const bg = ri % 2 === 1 ? t.colors.surface : 'white';
              return (
                `<td style="padding:4px 8px;font-size:${cell.size}px;font-family:${font};` +
                `font-weight:${cell.weight};line-height:${cell.lineHeight};` +
                `color:${color(cell.color, t.colors.ink)};text-align:${cell.align ?? 'left'};` +
                `border-bottom:0.5px solid ${t.colors.border};border-right:0.5px solid ${t.colors.border};` +
                `background:${bg}">${esc(cell.value)}</td>`
              );
            })
            .join('');
          return `<tr>${tds}</tr>`;
        })
        .join('');
      return (
        `<div style="${base}"><table style="border-collapse:collapse;width:100%;height:100%;` +
        `border:0.5px solid ${t.colors.border}"><tbody>${rows}</tbody></table></div>`
      );
    }

    default:
      return `<div style="${base};background:rgba(255,0,0,0.1)"></div>`;
  }
}

function renderSlide(s: PlacedSlide, t: ThemeTokens, boxed: boolean): string {
  const body = s.boxes.map((b) => renderBox(b, t)).join('');
  const outline = boxed
    ? `outline:1px solid #ff00ff;outline-offset:0;`
    : '';
  return (
    `<div class="slide" data-page="${s.pageNo}" data-type="${esc(s.pageType)}" style="${outline}">` +
    body +
    `</div>`
  );
}

/** 单页 HTML：画布尺寸精确等于 960×540，供无头浏览器逐页截图 */
function buildFrame(s: PlacedSlide, t: ThemeTokens, date: string): string {
  const body = s.boxes.map((b) => renderBox(b, t)).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>P${s.pageNo} · ${esc(s.pageType)}</title>
<style>
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;width:960px;height:540px;overflow:hidden;}
  .slide{position:relative;overflow:hidden;width:960px;height:540px;background:${t.colors.surface};}
</style></head><body>
<div class="slide" data-page="${s.pageNo}" data-type="${esc(s.pageType)}" data-date="${esc(date)}">${body}</div>
</body></html>`;
}

/** 联系表：全部页面按 0.5 缩放排成两列，一张图看完整本 deck */
function buildSheet(slides: PlacedSlide[], t: ThemeTokens, date: string): string {
  const SCALE = 0.5;
  const W = 960 * SCALE;
  const H = 540 * SCALE;
  const cells = slides
    .map((s) => {
      const body = s.boxes.map((b) => renderBox(b, t)).join('');
      return `<div class="cell">
  <div class="cap">P${String(s.pageNo).padStart(2, '0')} · ${esc(s.pageType)}</div>
  <div class="vp"><div class="slide">${body}</div></div>
</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>AI 早报 ${esc(date)} · 全 deck 联系表</title>
<style>
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#18181b;}
  body{display:grid;grid-template-columns:repeat(2, ${W + 24}px);gap:18px;padding:18px;width:${(W + 24) * 2 + 54}px;}
  .cap{font:11px/1.6 Consolas,monospace;color:#a1a1aa;margin-bottom:5px;}
  .vp{width:${W}px;height:${H}px;overflow:hidden;background:${t.colors.surface};
      box-shadow:0 2px 8px rgba(0,0,0,.5);}
  /* 缩放 0.5：transform 不影响布局尺寸，故外层 .vp 用固定像素裁切 */
  .slide{position:relative;overflow:hidden;width:960px;height:540px;background:${t.colors.surface};
         transform:scale(${SCALE});transform-origin:0 0;}
</style></head><body>
${cells}
</body></html>`;
}

function buildHtml(slides: PlacedSlide[], t: ThemeTokens, meta: { date: string; errors: number; warns: number }): string {
  const pages = slides.map((s) => renderSlide(s, t, args['--outline'] === '1')).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>AI 早报 ${esc(meta.date)} · 布局预览</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#f4f4f5; }
  body { font-family: "Microsoft YaHei","PingFang SC",sans-serif; padding:24px; }
  .hdr { margin:0 0 20px; padding:14px 18px; background:#fff; border-radius:10px;
         box-shadow:0 1px 3px rgba(0,0,0,.08); font-size:13px; color:#3f3f46; }
  .hdr b { font-size:15px; color:#18181b; }
  .hdr code { background:#f4f4f5; padding:1px 6px; border-radius:4px; font-size:12px; }
  .ok { color:#16a34a; font-weight:600; }
  .bad { color:#dc2626; font-weight:600; }
  .wrap { display:flex; flex-direction:column; gap:28px; align-items:flex-start; }
  /* 960×540 是 PPT 的逻辑画布尺寸（pt），此处 1pt = 1px */
  .slide { position:relative; overflow:hidden; width:960px; height:540px;
           background:${t.colors.surface}; flex:0 0 auto;
           box-shadow:0 2px 10px rgba(0,0,0,.12); }
  .lbl { font-size:12px; color:#71717a; margin:0 0 6px; }
</style>
</head>
<body>
<div class="hdr">
  <div><b>AI 早报 ${esc(meta.date)}</b> · 布局预览（新引擎 slide-engine）</div>
  <div style="margin-top:6px">
    共 <code>${slides.length}</code> 页 ·
    lint <span class="${meta.errors === 0 ? 'ok' : 'bad'}">${meta.errors} error</span> /
    <span class="${meta.warns === 0 ? 'ok' : ''}">${meta.warns} warn</span> ·
    主题 <code>${esc(t.id)}</code>
  </div>
  <div style="margin-top:6px;color:#a1a1aa">画布 960×540（PPT 逻辑尺寸），一屏一页，可直接截图逐页核对</div>
</div>
<div class="wrap">
${pages}
</div>
</body>
</html>`;
}

// ============================================================================
// 入口
// ============================================================================

async function main(): Promise<void> {
  const themeId = args['--theme'] ?? 'paper';
  const t = paperTheme;

  console.log('═'.repeat(60));
  console.log('早报 deck → 静态 HTML 预览');
  console.log('═'.repeat(60));

  let content: DailyReportContent | null = null;
  if (args['--in']) content = loadFromJson(resolve(args['--in']));
  else if (args['--date']) content = await loadFromDb(args['--date']);

  if (!content) {
    console.error('❌ 无法装载内容。请用 --in=<json> 或 --date=<YYYY-MM-DD>');
    process.exit(2);
  }
  console.log(`📄 日期=${content.date} 条目=${content.items.length} 方向=${content.directions.length}`);

  registerBriefingPageTypes();
  const entries = planBriefingDeck(content);
  const slides = planBriefingToPlacedSlides(entries, t);
  const report = lintDeck(slides, t);
  const errors = report.issues.filter((i) => i.level === 'error').length;
  const warns = report.issues.filter((i) => i.level === 'warn').length;

  console.log(`📐 页数=${slides.length} 形状=${slides.reduce((n, s) => n + s.boxes.length, 0)}`);
  console.log(`🔍 lint: ${errors} error / ${warns} warn ${report.passed ? '✅' : '❌'}`);

  // 逐页摘要，便于对着截图核对页型
  console.log('\n逐页：');
  for (const s of slides) {
    const texts = s.boxes.filter((b) => b.kind === 'text' && b.text?.value).length;
    console.log(`  P${String(s.pageNo).padStart(2, '0')}  ${s.pageType.padEnd(18)} boxes=${String(s.boxes.length).padStart(3)} text=${String(texts).padStart(3)}`);
  }

  const html = buildHtml(slides, t, { date: content.date, errors, warns });
  assertNoQuoteLeak(html, 'preview');
  const outPath = args['--out']
    ? resolve(args['--out'])
    : join(process.cwd(), 'out', `preview-${content.date}.html`);

  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, html, 'utf-8');

  console.log(`\n✅ 已写出：${outPath}`);
  console.log(`   大小：${(Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1)} KB`);

  // ---- 逐页 frame + 联系表（供无头浏览器截图做视觉验证）----
  if (args['--frames']) {
    const frameDir = resolve(args['--frames']);
    if (!existsSync(frameDir)) mkdirSync(frameDir, { recursive: true });

    for (const s of slides) {
      const p = String(s.pageNo).padStart(2, '0');
      const frame = buildFrame(s, t, content.date);
      assertNoQuoteLeak(frame, `frame-P${p}`);
      writeFileSync(join(frameDir, `frame-P${p}.html`), frame, 'utf-8');
    }

    const sheetPath = join(frameDir, 'sheet.html');
    const sheet = buildSheet(slides, t, content.date);
    assertNoQuoteLeak(sheet, 'sheet');
    writeFileSync(sheetPath, sheet, 'utf-8');

    console.log(`🖼️  逐页 frame：${slides.length} 个 → ${frameDir}`);
    console.log(`   联系表：${sheetPath}`);
  }
}

main().catch((err) => {
  console.error('❌ 失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
