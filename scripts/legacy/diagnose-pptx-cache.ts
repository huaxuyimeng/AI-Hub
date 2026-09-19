/**
 * 诊断 / 修复 DailyReport.pptxBase64 完整性
 *
 * 背景：之前发生过 "RangeError: Failed to allocate memory" 崩溃，
 *       根因是某条 pptxBase64 损坏后，Next.js 序列化大响应时炸了。
 *
 * 这个脚本：
 *   1. 列出所有 status=ready 的 DailyReport 及其 pptxBase64 长度
 *   2. 逐条校验 base64 格式、ZIP magic number、文件大小合理性
 *   3. 损坏的项：默认只打印报告，不动数据
 *      加 --fix 参数会把损坏的 pptxBase64/pptxBuiltAt 置空，触发下次 download 重新构建
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: 'file:D:/1Money/aihub/prisma/dev.db' } } });

const FIX = process.argv.includes('--fix');

function check(base64: string | null): { ok: true; bytes: number } | { ok: false; reason: string } {
  if (!base64) return { ok: false, reason: '(null)' };
  if (base64.length < 1024) return { ok: false, reason: `too short (len=${base64.length})` };
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) return { ok: false, reason: 'invalid base64 chars' };
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch (e) {
    return { ok: false, reason: `Buffer.from failed: ${(e as Error).message}` };
  }
  if (buf.length < 1024) return { ok: false, reason: `decoded too small (${buf.length} bytes)` };
  // PPTX = ZIP，magic number: PK\x03\x04 （0x50 0x4B 0x03 0x04）
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    return { ok: false, reason: `not ZIP/PPTX (magic=${buf.slice(0, 4).toString('hex')})` };
  }
  return { ok: true, bytes: buf.length };
}

async function main() {
  console.log(`🔍 扫描 DailyReport.pptxBase64 完整性${FIX ? '（--fix 模式，会清掉损坏项）' : '（只读模式）'}\n`);

  const rows = await prisma.$queryRaw<Array<{
    date: string;
    status: string;
    pptxBase64: string | null;
    pptxBuiltAt: string | null;
  }>>`SELECT date, status, pptxBase64, pptxBuiltAt FROM DailyReport WHERE status = 'ready' ORDER BY date DESC`;

  console.log(`ready 报告总数：${rows.length}\n`);

  let badCount = 0;
  let okCount = 0;
  let nullCount = 0;

  for (const r of rows) {
    const result = check(r.pptxBase64);
    if (r.pptxBase64 === null) {
      nullCount++;
      console.log(`⏭️  ${r.date}  pptxBase64=null  (下次下载时构建)`);
      continue;
    }
    if (result.ok) {
      okCount++;
      const kb = (result.bytes / 1024).toFixed(1);
      console.log(`✅ ${r.date}  ${kb} KB  pptxBuiltAt=${r.pptxBuiltAt}`);
    } else {
      badCount++;
      const len = r.pptxBase64.length;
      console.log(`❌ ${r.date}  ${result.reason}  (base64 len=${len}, pptxBuiltAt=${r.pptxBuiltAt})`);
      if (FIX) {
        await prisma.dailyReport.update({
          where: { date: r.date },
          data: { pptxBase64: null, pptxBuiltAt: null },
        });
        console.log(`   → 已清空，下次 download 会重新构建`);
      }
    }
  }

  console.log(`\n📊 统计：正常 ${okCount} | 损坏 ${badCount} | 未缓存 ${nullCount}`);
  if (badCount > 0 && !FIX) {
    console.log(`\n💡 提示：加 --fix 参数会自动清空损坏的缓存：`);
    console.log(`   pnpm tsx scripts/diagnose-pptx-cache.ts --fix`);
  }
}

main()
  .then(() => { console.log('\n✅ 完成'); prisma.$disconnect(); })
  .catch(e => { console.error('❌', e); prisma.$disconnect(); process.exit(1); });
