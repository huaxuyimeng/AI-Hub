/**
 * 早报内容落库脚本（Phase 1 路径 B：人工值守采编）
 *
 * 用途：把 out/briefing-YYYY-MM-DD.json 校验后写入 DailyReport 表。
 *  - 用 DailyReportContentSchema 严格校验（不合格直接失败，不落库）
 *  - enforceLimits 与生产链路保持一致
 *  - degraded=true 并写入 error，因为这期不是 LLM 管线产出
 *
 * 用法：
 *   npx tsx scripts/seed-briefing-content.ts --in=out/briefing-2026-09-16.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  DailyReportContentSchema,
  enforceLimits,
  type DailyReportContent,
} from '../src/features/daily-briefing/lib/types';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of argv) {
    const idx = raw.indexOf('=');
    if (idx > 0) out[raw.slice(0, idx)] = raw.slice(idx + 1);
  }
  return out;
}

/** 本地时区（GMT+8）时间字符串，不使用 toISOString */
function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inPath = resolve(args['--in'] ?? 'out/briefing-2026-09-16.json');
  if (!existsSync(inPath)) {
    console.error(`❌ 文件不存在：${inPath}`);
    process.exit(2);
  }

  const raw = JSON.parse(readFileSync(inPath, 'utf-8'));
  const parsed = DailyReportContentSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('❌ schema 校验未通过：');
    for (const i of parsed.error.issues.slice(0, 20)) {
      console.error(`   - ${i.path.join('.')}: ${i.message}`);
    }
    process.exit(1);
  }

  const now = new Date();
  const safe: DailyReportContent = enforceLimits({
    ...parsed.data,
    generatedAt: localStamp(now),
  });

  const prisma = new PrismaClient();
  try {
    await prisma.dailyReport.upsert({
      where: { date: safe.date },
      update: {
        status: 'ready',
        content: JSON.stringify(safe),
        degraded: true,
        phase: null,
        error: 'LLM 管线不可用（采集停止于 2026-08-30）；本期由值守 Agent 人工采编，逐条核实独立信源与一手链接',
      },
      create: {
        date: safe.date,
        status: 'ready',
        content: JSON.stringify(safe),
        degraded: true,
        phase: null,
        error: 'LLM 管线不可用（采集停止于 2026-08-30）；本期由值守 Agent 人工采编，逐条核实独立信源与一手链接',
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  const dist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of safe.items) dist[it.confidenceLevel]++;

  const lines = [
    `✅ 已落库：date=${safe.date}`,
    `   条目=${safe.items.length}  方向=${safe.directions.length}  验证表行=${safe.verificationTable.rows.length}`,
    `   置信度分布：A${dist.A} B${dist.B} C${dist.C} D${dist.D}`,
    `   generatedAt=${safe.generatedAt}（本地时区）`,
    `   标题清单：`,
    ...safe.items.map((i, n) => `     ${n + 1}. [${i.confidenceLevel}] ${i.title}（独立信源 ${i.independentSources}）`),
  ];
  const text = lines.join('\n');
  console.log(text);
  writeFileSync('out/_seed-result.txt', text);
}

main().catch((err) => {
  console.error('❌ 失败：', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split('\n').slice(1, 5).join('\n'));
  }
  process.exit(1);
});
