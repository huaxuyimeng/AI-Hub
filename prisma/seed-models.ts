/**
 * AI 模型种子数据 v3（2026-09-07 重写）
 *
 * 来源：
 *   - 实时排行榜：https://yyh-001.github.io/llm-value-rankings/data/models.json
 *     （OpenRouter 价格 + Artificial Analysis 能力分，每日更新）
 *   - 本地副本：scripts/llm-value-rankings-2026-09-07.json
 *
 * 数据：取 ranked_models 中前 24 个（rank 1-24）
 *
 * 字段映射：
 *   - id (provider/model-name)        → externalId (去除 provider/ 前缀)
 *   - name (e.g. "Anthropic: Claude Fable 5.1") → name (去掉 provider 前缀)
 *   - provider_display                → provider
 *   - pricing.prompt                  → priceInput
 *   - pricing.completion              → priceOutput
 *   - pricing.cache_read              → cacheReadPrice
 *   - intelligence_score              → intelligence
 *   - speed                           → speed
 *   - context_length                  → contextLength
 *
 * 用途：初始化数据库 → 立即调用 ModelRankingsScraper → 写入价格和能力分
 *
 * 运行：npx tsx prisma/seed-models.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SourceModel {
  id: string;
  name: string;
  provider: string;
  provider_display: string;
  context_length: number;
  pricing: {
    prompt: number;
    completion: number;
    cache_read: number | null;
    blended: number;
  };
  intelligence_score: number;
  speed: number;
  ttft: number;
  rank: number;
}

interface SourceData {
  updated_at: string;
  total_models: number;
  ranked_models: number;
  avg_intelligence: number;
  models: SourceModel[];
}

function loadSource(): SourceData {
  // 1) 优先读项目内副本（已随 commit 落盘）
  const localPath = path.join(__dirname, '..', 'scripts', 'llm-value-rankings-2026-09-07.json');
  if (fs.existsSync(localPath)) {
    console.log(`📦 读取本地数据：${localPath}`);
    return JSON.parse(fs.readFileSync(localPath, 'utf8')) as SourceData;
  }
  // 2) fallback 到远程（仅供临时调试；建议始终用本地副本以便审计）
  throw new Error(
    `未找到本地数据 ${localPath}。\n` +
    `运行：curl -o scripts/llm-value-rankings-2026-09-07.json ` +
    `https://yyh-001.github.io/llm-value-rankings/data/models.json`
  );
}

function extractName(fullName: string): string {
  // "Anthropic: Claude Fable 5.1" → "Claude Fable 5.1"
  // "Z.ai: GLM 5.3 Flash" → "GLM 5.3 Flash"
  // "OpenAI: GPT-5.6 Luna" → "GPT-5.6 Luna"
  // "SpaceXAI: Grok 4.6" → "Grok 4.6"  （provider_display 与 name 前缀不一致）
  const idx = fullName.indexOf(': ');
  return idx >= 0 ? fullName.slice(idx + 2) : fullName;
}

function extractFamily(name: string): string {
  // 从 name 中提取"家族"：取第一个空格或连字符之前的部分
  // "Claude Fable 5.1" → "Claude"
  // "GPT-5.6 Luna" → "GPT"
  // "GLM 5.3 Flash" → "GLM"
  // "Gemini 3.8 Flash" → "Gemini"
  // "DeepSeek V4 Flash 0731" → "DeepSeek"
  const m = name.match(/^([\w-]+)/);
  return m ? m[1] : name;
}

function buildOfficialUrl(provider: string, externalId: string): string {
  // OpenRouter 是排行榜数据源，价格页即 OpenRouter
  // e.g. "z-ai/glm-5.3-flash" → "https://openrouter.ai/z-ai/glm-5.3-flash"
  return `https://openrouter.ai/${externalId}`;
}

async function seedModels() {
  const data = loadSource();
  const ranked = data.models.filter((m) => m.rank != null && m.rank >= 1 && m.rank <= 24);

  console.log(`📊 数据源：${data.updated_at} | 总模型 ${data.total_models} | ranked ${data.ranked_models}`);
  console.log(`🌱 开始初始化 ${ranked.length} 个 ranked 模型...\n`);

  let success = 0;
  let failed = 0;
  let snapshotSkipped = 0;

  // 数据源日期（用于快照去重：同一天跑 seed 只写一条 snapshot）
  const dataDate = data.updated_at.slice(0, 10); // "2026-09-07"
  const dayStart = new Date(dataDate + 'T00:00:00Z');
  const dayEnd = new Date(dataDate + 'T23:59:59Z');

  for (const m of ranked) {
    const shortName = extractName(m.name);
    const family = extractFamily(shortName);
    const externalId = m.id; // 保留 "provider/model" 完整 ID 以便外部 URL
    const provider = m.provider_display;
    const officialUrl = buildOfficialUrl(provider, externalId);

    try {
      const model = await prisma.model.upsert({
        where: { externalId },
        update: {
          name: shortName,
          provider,
          family,
          officialUrl,
          priceInput: m.pricing.prompt,
          priceOutput: m.pricing.completion,
          intelligence: m.intelligence_score,
          speed: m.speed,
          isActive: true,
          // 注意：不重置 isPending —— 若价格/能力分缺失才标 true
          isPending: m.pricing.prompt === 0 || m.intelligence_score === 0,
        },
        create: {
          externalId,
          name: shortName,
          provider,
          family,
          officialUrl,
          priceInput: m.pricing.prompt,
          priceOutput: m.pricing.completion,
          intelligence: m.intelligence_score,
          speed: m.speed,
          isActive: true,
          isPending: false, // 数据已有，跳过 scraper
        },
      });

      // 同步写第 0 条快照（与 scraper.refreshOne 行为一致，
      // 让价格走势图立刻有数据点）
      // 去重：若当天已有 snapshot，跳过避免重复
      const existing = await prisma.modelSnapshot.findFirst({
        where: {
          modelId: model.id,
          snapshotAt: { gte: dayStart, lte: dayEnd },
          source: 'AA',
        },
      });
      if (existing) {
        snapshotSkipped++;
      } else {
        await prisma.modelSnapshot.create({
          data: {
            modelId: model.id,
            priceInput: m.pricing.prompt,
            priceOutput: m.pricing.completion,
            intelligence: m.intelligence_score,
            speed: m.speed,
            source: 'AA', // Artificial Analysis 数据
            note: `seed from llm-value-rankings ${data.updated_at}`,
          },
        });
      }

      success++;
      console.log(`  ✓ rank #${String(m.rank).padStart(2)} | ${provider.padEnd(12)} | ${shortName.padEnd(28)} | $${m.pricing.prompt}/${m.pricing.completion} | IQ ${m.intelligence_score}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${externalId}: ${(err as Error).message}`);
    }
  }

  console.log(`\n✅ 种子写入完成：${success} 成功 / ${failed} 失败（总计 ${ranked.length}）`);
  console.log(`📸 快照：${success - snapshotSkipped} 新建 / ${snapshotSkipped} 跳过（当日已存在）`);
}

async function main() {
  await seedModels();
}

main()
  .catch((err) => {
    console.error('\n❌ seed-models 失败:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
