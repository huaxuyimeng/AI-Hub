/**
 * PPTX 文本内边距回归测试
 * 路径：src/lib/slide-engine/pptx-inset.test.ts
 *
 * 守护的缺陷（2026-09-15 发现）：
 *   pptxgenjs 在 addText 未显式传 margin 时，写出的 <a:bodyPr> 不含
 *   lIns / rIns / tIns / bIns。此时 PowerPoint 及各类在线预览器会套用默认内边距：
 *       lIns = rIns = 91440 EMU = 7.2pt
 *       tIns = bIns = 45720 EMU = 3.6pt
 *   即「可用文本宽度 = 盒宽 − 14.4pt」「可用文本高度 = 盒高 − 7.2pt」。
 *
 *   而引擎的 lint 与几何模型都是按盒子的**完整宽高、零内边距**测量与布点的，
 *   两边差 14.4 / 7.2pt。实测后果：142 个文本盒里 99 个受影响；
 *   其中 A/B/C/D 图例字母的盒子只有 22pt 宽，扣掉 14.4pt 只剩 7.6pt，
 *   单个字符被折成两行 —— 而 lint 报 0 error，HTML 预览也看不出问题，
 *   只有真正打开 PPTX 才暴露。
 *
 * 本测试直接渲染一份 PlacedSlide 并解包检查 XML，
 * 断言每个文本框的 bodyPr 内边距全为 0、每个表格单元格 margin 全为 0。
 *
 * 运行：npx tsx src/lib/slide-engine/pptx-inset.test.ts
 */

import { inflateRawSync } from 'node:zlib';
import { paperTheme } from './templates/briefing/theme';
import { renderDeckToBuffer } from './render/pptx';
import type { PlacedSlide, PlacedBox } from './contracts/geometry';

// ============================================================================
// 极简断言
// ============================================================================

let passed = 0;
let failed = 0;

function pass(msg: string): void {
  console.log(`PASS: ${msg}`);
  passed++;
}
function fail(msg: string): void {
  console.error(`FAIL: ${msg}`);
  failed++;
}
function assert(cond: boolean, msg: string): void {
  if (cond) pass(msg);
  else fail(msg);
}

// ============================================================================
// 极简 ZIP 读取（jszip 不是本项目的直接依赖，pnpm 下解析不到，故自带实现）
// EOCD → 中央目录 → 本地头 → inflateRaw
// ============================================================================

function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;

  // 从尾部向前找 EOCD（可能带最长 65535 字节的注释）
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('未找到 EOCD，不是合法 ZIP/PPTX');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== CD_SIG) throw new Error(`中央目录条目 ${i} 签名错误`);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    if (buf.readUInt32LE(localOff) !== LFH_SIG) throw new Error(`本地头签名错误: ${name}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 读出 bodyPr 的四个内边距，缺省返回 null（= 会用 PowerPoint 默认值） */
function readInsets(bodyPr: string): {
  l: number | null; t: number | null; r: number | null; b: number | null;
} {
  const g = (k: string): number | null => {
    const m = bodyPr.match(new RegExp(`${k}="(-?\\d+)"`));
    return m ? Number(m[1]) : null;
  };
  return { l: g('lIns'), t: g('tIns'), r: g('rIns'), b: g('bIns') };
}

// ============================================================================
// 测试用幻灯片：刻意覆盖三类易踩雷的盒
//   - 极窄文本盒（22pt 宽，模拟 A/B/C/D 图例字母）
//   - 带文字的 badge（形状 + 文字两层）
//   - 表格（单元格内边距与文本框不同，走 tcPr marL/marR）
// ============================================================================

function textBox(
  id: string, x: number, y: number, w: number, h: number,
  value: string, size: number, maxLines = 1,
): PlacedBox {
  return {
    id, slot: id, kind: 'text', z: 2,
    box: { x, y, w, h },
    text: {
      value, font: 'cn', size, weight: 400,
      lineHeight: 1.4, align: 'left', color: '#1E293B', maxLines,
    },
  };
}

const SLIDES: PlacedSlide[] = [
  {
    pageNo: 1,
    totalPages: 2,
    pageType: 'test-inset',
    boxes: [
      // 22pt 宽的窄盒：默认内边距下 7.6pt 可用宽，"A" 会折行
      textBox('legend-1', 100, 100, 22, 22, 'A', 11),
      textBox('legend-2', 130, 100, 22, 22, 'B', 11),
      // 带文字的 badge：渲染器须同时画形状与文字
      {
        id: 'chip', slot: 'chip', kind: 'badge', z: 2,
        box: { x: 200, y: 100, w: 204, h: 30 },
        fill: '#EFF6FF', radius: 15,
        text: {
          value: '4 类信源 · 8 条精选', font: 'cn', size: 11, weight: 600,
          lineHeight: 1.2, align: 'center', color: '#3B82F6', maxLines: 1,
        },
      },
      textBox('title', 100, 20, 600, 32, '本期概览与置信度评级方法', 26),
    ],
  },
  {
    pageNo: 2,
    totalPages: 2,
    pageType: 'test-table',
    boxes: [
      {
        id: 'tbl', slot: 'tbl', kind: 'table', z: 2,
        box: { x: 36, y: 90, w: 888, h: 160 },
        cells: [
          ['#', '议题', '方向', '独立信源', '一手链接', '置信度'].map((v) => ({
            value: v, font: 'cn' as const, size: 10, weight: 600,
            lineHeight: 1.3, align: 'left' as const, color: '#1E293B', maxLines: 1,
          })),
          ['1', '形式化验证回路', 'Coding', '2', '✅ MIT', 'B'].map((v) => ({
            value: v, font: 'cn' as const, size: 10, weight: 400,
            lineHeight: 1.3, align: 'left' as const, color: '#334155', maxLines: 1,
          })),
        ],
      },
      textBox('page-no', 860, 518, 64, 16, '02 / 02', 10),
    ],
  },
];

// ============================================================================
// 用例
// ============================================================================

async function main(): Promise<void> {
  console.log('▶ 渲染测试 deck ...\n');

  const buffer = await renderDeckToBuffer(SLIDES, paperTheme, { title: 'inset test' });

  assert(buffer.length > 1000, `PPTX 产出非空（${buffer.length} bytes）`);
  assert(buffer[0] === 0x50 && buffer[1] === 0x4b, 'PPTX 是合法 ZIP（PK 头）');

  const entries = readZipEntries(buffer);
  const slideNames = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort();
  assert(slideNames.length === SLIDES.length, `解出 ${slideNames.length} 页（期望 ${SLIDES.length}）`);

  // ---- 断言 1：每个 <p:sp> 的 bodyPr 内边距必须全为 0 ----
  let spTotal = 0;
  const badInsets: string[] = [];
  const missingInsets: string[] = [];

  for (const name of slideNames) {
    const xml = entries.get(name)!.toString('utf8');
    const spBlocks = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);

    for (const sp of spBlocks) {
      const bodyPrM = sp.match(/<a:bodyPr[^>]*>/);
      if (!bodyPrM) continue; // 纯形状（如分隔条）没有 txBody，不涉及文本内边距
      spTotal++;

      const bodyPr = bodyPrM[0];
      const ins = readInsets(bodyPr);

      if (ins.l === null || ins.t === null || ins.r === null || ins.b === null) {
        missingInsets.push(`${name}: ${bodyPr.slice(0, 80)}`);
      } else if (ins.l !== 0 || ins.t !== 0 || ins.r !== 0 || ins.b !== 0) {
        badInsets.push(`${name}: l=${ins.l} t=${ins.t} r=${ins.r} b=${ins.b}`);
      }
    }
  }

  assert(spTotal > 0, `检查了 ${spTotal} 个文本框`);
  assert(
    missingInsets.length === 0,
    missingInsets.length === 0
      ? '所有文本框都显式声明了 lIns/rIns/tIns/bIns'
      : `${missingInsets.length} 个文本框缺内边距声明（会套用 PPT 默认 7.2pt/3.6pt）：\n    ` +
        missingInsets.slice(0, 5).join('\n    '),
  );
  assert(
    badInsets.length === 0,
    badInsets.length === 0
      ? '所有文本框内边距均为 0'
      : `${badInsets.length} 个文本框内边距非 0：\n    ` + badInsets.slice(0, 5).join('\n    '),
  );

  // ---- 断言 2：表格单元格 margin 必须全为 0 ----
  const tableXml = entries.get('ppt/slides/slide2.xml')!.toString('utf8');
  const tcPrs = [...tableXml.matchAll(/<a:tcPr[^>]*>/g)].map((m) => m[0]);
  assert(tcPrs.length > 0, `检查了 ${tcPrs.length} 个表格单元格`);

  const badCells = tcPrs.filter((t) => {
    const g = (k: string) => {
      const m = t.match(new RegExp(`${k}="(-?\\d+)"`));
      return m ? Number(m[1]) : null;
    };
    return g('marL') !== 0 || g('marR') !== 0 || g('marT') !== 0 || g('marB') !== 0;
  });
  assert(
    badCells.length === 0,
    badCells.length === 0
      ? '所有表格单元格 margin 均为 0'
      : `${badCells.length} 个单元格 margin 非 0，如：${badCells[0]}`,
  );

  // ---- 断言 3：badge 上的文字必须真的被渲染（防「空色块」回归）----
  const slide1 = entries.get('ppt/slides/slide1.xml')!.toString('utf8');
  assert(
    slide1.includes('4 类信源 · 8 条精选'),
    'badge 上的文字已渲染（不是空色块）',
  );
  assert(slide1.includes('A') && slide1.includes('B'), '窄盒里的字母已渲染');

  // ---- 断言 4：数字必须真的写进 XML（防文本丢失）----
  assert(slide1.includes('本期概览与置信度评级方法'), '标题文字已渲染');

  console.log(`\n=== ${passed} 通过 / ${failed} 失败 ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
