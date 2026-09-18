/**
 * 早报 deck 一键视觉验证
 * 路径：scripts/briefing-verify.cjs
 *
 * 一条命令跑完：plan → lint → 逐页 HTML → 无头截图 → 输出联系表与逐页 PNG。
 * 目的是把「PPT 长什么样」变成一张能直接看的图 —— .pptx 本身没法在 IDE 里预览，
 * 而 web 渲染器与 pptx 渲染器共用同一份 PlacedSlide 几何，所以截图就是布局真相。
 *
 * 用法：
 *   node scripts/briefing-verify.cjs --date=2026-09-13
 *   node scripts/briefing-verify.cjs --in=out/input.json
 *   node scripts/briefing-verify.cjs --in=out/input.json --theme=ink
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = 'D:/1Money/aihub';
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const NODE = process.execPath;

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    const i = raw.indexOf('=');
    if (i > 0) out[raw.slice(0, i)] = raw.slice(i + 1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const date = args['--date'];
const input = args['--in'];
const theme = args['--theme'] || 'paper';

if (!date && !input) {
  console.error('usage: node scripts/briefing-verify.cjs (--date=YYYY-MM-DD | --in=path.json) [--theme=paper]');
  process.exit(2);
}

// 用统一的 tag 命名产物，便于多份并存对比
const tag = date || path.basename(input, '.json').replace(/^lint-input-/, '');
const outDir = path.join(ROOT, 'out', `verify-${tag}`);
const frameDir = path.join(outDir, 'frames');
const shotDir = path.join(outDir, 'shots');

for (const d of [outDir, frameDir, shotDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function run(label, file, argv) {
  process.stdout.write(`\n### ${label}\n`);
  const res = spawnSync(NODE, [file, ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res.status;
}

// 1) 生成逐页 HTML + 联系表
const htmlArgs = [path.join(ROOT, 'scripts', 'briefing-deck-html.ts')];
if (input) htmlArgs.push(`--in=${path.resolve(input)}`);
else htmlArgs.push(`--date=${date}`);
htmlArgs.push(`--theme=${theme}`);
htmlArgs.push(`--out=${path.join(outDir, 'preview.html')}`);
htmlArgs.push(`--frames=${frameDir}`);

const c1 = run('生成逐页 HTML', TSX, htmlArgs);
if (c1 !== 0) {
  console.error(`\n生成 HTML 失败（exit=${c1}）`);
  process.exit(1);
}

// 2) 逐页截图 960x540
const c2 = run('逐页截图', path.join(ROOT, 'scripts', 'shoot.cjs'), [
  `dir=${frameDir}`,
  `out=${shotDir}`,
  'w=960',
  'h=540',
  'pattern=frame-P*.html',
]);

// 3) 联系表整体截图（缩略图墙，一屏看完整本 deck）
const sheetDir = path.join(outDir, 'sheet');
if (!fs.existsSync(sheetDir)) fs.mkdirSync(sheetDir, { recursive: true });
// 联系表宽度 = 2 列 × (480+24) + 54 ≈ 1062；高度按行数动态给足
const sheetFiles = fs.readdirSync(frameDir).filter((f) => f === 'sheet.html');
let c3 = 0;
if (sheetFiles.length) {
  // 联系表是 2 列，页数决定行数
  const html = fs.readFileSync(path.join(frameDir, 'sheet.html'), 'utf8');
  const pages = (html.match(/class="cell"/g) || []).length;
  const rows = Math.ceil(pages / 2);
  const h = rows * (270 + 24) + 40;
  c3 = run('联系表截图', path.join(ROOT, 'scripts', 'shoot.cjs'), [
    `dir=${frameDir}`,
    `out=${sheetDir}`,
    'w=1080',
    `h=${h}`,
    'pattern=sheet.html',
  ]);
}

console.log('');
console.log('─'.repeat(70));
console.log(`产物目录：${outDir}`);
console.log(`  逐页 PNG ：${shotDir}`);
if (c3 === 0) console.log(`  联系表   ：${path.join(sheetDir, 'sheet.png')}`);
console.log('─'.repeat(70));

process.exit(c2 === 0 ? 0 : 1);
