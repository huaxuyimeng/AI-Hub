// scripts/migrate-crawledat-to-iso.cjs
// 用途：把 NewsItem.crawledAt 统一为 ISO 8601 字符串
// 现状（实测 2026-09-16）：
//   - 121 行：'YYYY-MM-DD HH:MM:SS'（标准 SQLite 时间）
//   - ~900 行：unix timestamp 秒（10 位数字）
//   - ~900 行：unix timestamp 毫秒（13 位数字）
// 目标：'YYYY-MM-DD HH:MM:SS'（与 SQLite 原生格式对齐，可被 Prisma 正确解析）
//
// 用法：
//   1. 先 dry-run：node scripts/migrate-crawledat-to-iso.cjs --dry-run
//   2. 再正式跑：  node scripts/migrate-crawledat-to-iso.cjs
//
// 注意：必须先停掉 dev server / cron，避免写入竞态

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
const db = new DatabaseSync(dbPath);

const DRY_RUN = process.argv.includes('--dry-run');

console.log(DRY_RUN ? '🔍 DRY-RUN 模式（不会写入）\n' : '⚠️  写入模式\n');

// 1. 拉所有 crawledAt
const rows = db.prepare('SELECT id, crawledAt FROM NewsItem').all();
console.log(`📊 总记录数：${rows.length}`);

// 2. 分桶统计
const buckets = { iso: [], sec: [], ms: [], unknown: [] };
for (const r of rows) {
  const v = r.crawledAt;
  if (typeof v === 'string') {
    // 匹配 'YYYY-MM-DD HH:MM:SS'
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) {
      buckets.iso.push(r);
    } else {
      buckets.unknown.push(r);
    }
  } else if (typeof v === 'number' || typeof v === 'bigint') {
    const n = Number(v);
    if (n > 1e12) buckets.ms.push(r);          // 13 位毫秒
    else if (n > 1e9) buckets.sec.push(r);     // 10 位秒
    else buckets.unknown.push(r);
  } else {
    buckets.unknown.push(r);
  }
}

console.log(`   ✅ ISO 字符串：${buckets.iso.length}`);
console.log(`   🔧 Unix 秒：   ${buckets.sec.length}（待归一化）`);
console.log(`   🔧 Unix 毫秒： ${buckets.ms.length}（待归一化）`);
console.log(`   ⚠️  未知格式：  ${buckets.unknown.length}`);

if (buckets.unknown.length > 0) {
  console.log('\n⚠️  存在未知格式，前 3 个：');
  console.log(buckets.unknown.slice(0, 3));
}

const toMigrate = [...buckets.sec, ...buckets.ms];
if (toMigrate.length === 0) {
  console.log('\n✅ 无需迁移');
  process.exit(0);
}

// 3. 转换 + 写入
let updated = 0;
let errors = 0;
const stmt = db.prepare('UPDATE NewsItem SET crawledAt = ? WHERE id = ?');

db.exec('BEGIN');
for (const r of toMigrate) {
  const n = Number(r.crawledAt);
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) {
    console.log(`   ❌ id=${r.id} crawledAt=${r.crawledAt} 无法解析`);
    errors++;
    continue;
  }
  // 转成 'YYYY-MM-DD HH:MM:SS'（UTC，与 SQLite 默认一致）
  const iso = d.toISOString().replace('T', ' ').slice(0, 19);
  if (!DRY_RUN) {
    stmt.run(iso, r.id);
  }
  updated++;
}
if (DRY_RUN) {
  db.exec('ROLLBACK');
} else {
  db.exec('COMMIT');
}

console.log(`\n${DRY_RUN ? '🔍' : '✅'} ${DRY_RUN ? '将' : '已'}更新 ${updated} 条${errors ? `，跳过 ${errors} 条无效` : ''}`);

// 4. 抽样验证
const sample = db.prepare(
  "SELECT crawledAt FROM NewsItem WHERE crawledAt LIKE '178%' OR crawledAt GLOB '*[^0-9 :-]*' LIMIT 5"
).all();
console.log('\n📌 残留数字格式（应为 0）：', sample.length);
if (sample.length > 0) console.log(sample);

db.close();
