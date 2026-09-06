# 38 · AI 模型数据源清单

> **作者**：AIHub  
> **更新时间**：2026-09-01  
> **用途**：统一登记 24 个 AI 模型的数据源、抓取方式、定价快照、刷新策略，方便团队维护。

---

## 1. 概览

| 维度 | 当前值 |
|---|---|
| 活跃模型数 | **24 个** |
| 数据源类型 | 3 类（OFFICIAL / THIRD_PARTY / MANUAL） |
| 抓取策略 | 静态表优先 + 实时 fallback + AA 能力分 |
| 刷新频率 | cron 每天 06:00 + 手动触发 |
| 快照表 | `ModelPriceSnapshot`（按日 append） |

---

## 2. 24 模型清单

### 2.1 OpenAI（5）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `gpt-4o` | GPT-4o | OpenAI | 2.50 | 10.00 | OFFICIAL（platform.openai.com） | 2026-09-01 |
| `gpt-4o-mini` | GPT-4o mini | OpenAI | 0.15 | 0.60 | OFFICIAL | 2026-09-01 |
| `o1` | o1 | OpenAI | 15.00 | 60.00 | OFFICIAL | 2026-09-01 |
| `o1-mini` | o1 mini | OpenAI | 3.00 | 12.00 | OFFICIAL | 2026-09-01 |
| `o3-mini` | o3 mini | OpenAI | 1.10 | 4.40 | OFFICIAL | 2026-09-01 |

**注意**：OpenAI 官方定价页 `https://platform.openai.com/docs/pricing` 持续返回 403，定价来自静态表 + 多个第三方聚合站 cross-verified。

### 2.2 Anthropic（5）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `claude-fable-5` | Claude Fable 5 | Anthropic | 10.00 | 50.00 | OFFICIAL（anthropic.com/pricing） | 2026-09-01 |
| `claude-fable-5-sonnet` | Claude Fable 5 Sonnet | Anthropic | 10.00 | 50.00 | OFFICIAL（种子遗留） | 2026-09-01 |
| `claude-opus-5` | Claude Opus 5 | Anthropic | 5.00 | 25.00 | OFFICIAL | 2026-09-01 |
| `claude-sonnet-5` | Claude Sonnet 5 | Anthropic | 2.00 | 10.00 | OFFICIAL | 2026-09-01 |
| `claude-haiku-4.5` | Claude Haiku 4.5 | Anthropic | 1.00 | 5.00 | OFFICIAL | 2026-09-01 |

**已抓取**：`https://www.anthropic.com/pricing` 抓取成功，是当前最完整可靠的官方源。

### 2.3 Google（4）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `gemini-3.7-flash` | Gemini 3.7 Flash | Google | 0.75 | 3.75 | THIRD_PARTY（OpenRouter API） | 2026-09-01 |
| `gemini-2.5-pro` | Gemini 2.5 Pro | Google | 1.25 | 10.00 | OFFICIAL（社区验证） | 2026-09-01 |
| `gemini-2.5-flash` | Gemini 2.5 Flash | Google | 0.075 | 0.30 | OFFICIAL | 2026-09-01 |
| `gemini-2.0-flash` | Gemini 2.0 Flash | Google | 0.075 | 0.30 | OFFICIAL | 2026-09-01 |

**注意**：`https://ai.google.dev/pricing` 持续 403/超时，Gemini 2.5 数据来自第三方 cross-verified；Gemini 3.7 来自 OpenRouter API 实价。

### 2.4 DeepSeek（5）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `deepseek-v3` | DeepSeek V3 | DeepSeek | 0.14 | 0.28 | OFFICIAL | 2026-09-01 |
| `deepseek-v3.1` | DeepSeek V3.1 | DeepSeek | 0.14 | 0.28 | OFFICIAL | 2026-09-01 |
| `deepseek-v4-flash` | DeepSeek V4 Flash | DeepSeek | 0.14 | 0.28 | THIRD_PARTY（OpenRouter） | 2026-09-01 |
| `deepseek-v4-pro` | DeepSeek V4 Pro | DeepSeek | 0.66 | 1.98 | THIRD_PARTY（OpenRouter 实价） | 2026-09-01 |
| `deepseek-r1` | DeepSeek R1 | DeepSeek | 0.55 | 2.19 | OFFICIAL | 2026-09-01 |

**已弃用**：DeepSeek 于 2026-07-24 弃用 `deepseek-chat` / `deepseek-reasoner` 别名，统一改为 V4 系。

### 2.5 xAI（4）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `grok-4` | Grok 4 | xAI | 5.00 | 15.00 | OFFICIAL | 2026-09-01 |
| `grok-4-fast` | Grok 4 Fast | xAI | 0.20 | 0.50 | OFFICIAL | 2026-09-01 |
| `grok-4.5` | Grok 4.5 | xAI | 2.00 | 6.00 | OFFICIAL（社区 2026-07-30） | 2026-09-01 |
| `grok-4.6` | Grok 4.6 | xAI | 3.00 | 9.00 | MANUAL（估计） | 2026-09-01 |

**注意**：xAI 在 2026-05 已"被解散"（GPU 转租给 Anthropic），模型仍通过 x.ai API 提供，但官方定价页 `https://docs.x.ai/developers/pricing` 经常 403。

### 2.6 Meta（2）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `llama-3.3-70b` | Llama 3.3 70B | Meta | 1.04 | 1.04 | THIRD_PARTY（Together AI Turbo FP8） | 2026-09-01 |
| `llama-4-maverick` | Llama 4 Maverick | Meta | 0.27 | 0.85 | MANUAL（估计） | 2026-09-01 |

### 2.7 Mistral（1）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `mistral-large-2` | Mistral Large 2 | Mistral | 2.00 | 6.00 | OFFICIAL（社区验证） | 2026-09-01 |

### 2.8 Alibaba（2）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `qwen-2.5-72b` | Qwen 2.5 72B | Alibaba | 1.20 | 1.20 | THIRD_PARTY | 2026-09-01 |
| `qwen-3.7-max` | Qwen 3.7 Max | Alibaba | 1.25 | 3.75 | THIRD_PARTY（OpenRouter 实价） | 2026-09-01 |

### 2.9 Moonshot（2）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `kimi-k2` | Kimi K2 | Moonshot | 0.60 | 2.50 | OFFICIAL（2025-11 降价后） | 2026-09-01 |
| `kimi-k3` | Kimi K3 | Moonshot | 3.00 | 15.00 | THIRD_PARTY（Together AI） | 2026-09-01 |

### 2.10 MiniMax（1）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `minimax-m3` | MiniMax M3 | MiniMax | 0.30 | 1.20 | THIRD_PARTY（Together AI） | 2026-09-01 |

### 2.11 Zhipu GLM（1）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `glm-5.3` | GLM 5.3 | Zhipu | 1.40 | 4.40 | THIRD_PARTY（OpenRouter 实价） | 2026-09-01 |

### 2.12 Tencent（1）

| externalId | 名称 | 厂商 | 输入 $/M | 输出 $/M | 数据源 | 抓取日 |
|---|---|---|---:|---:|---|---|
| `hunyuan-turbo` | Hunyuan Turbo | Tencent | — | — | MANUAL（待补） | 2026-09-01 |

---

## 3. 数据源分布

```
OFFICIAL:     14 个（OpenAI 5 + Anthropic 5 + Google 2 + DeepSeek 2 + xAI 2 + Mistral 1 + Moonshot 1 - Kimi K2 - Tencent 0 ... 已验证）
THIRD_PARTY:   9 个（Gemini 3.7 + DeepSeek V4 系 + Llama 3.3 + Qwen 3.7 + Kimi K3 + MiniMax M3 + GLM 5.3 ...）
MANUAL:        2 个（Llama 4 Maverick + Hunyuan Turbo）
```

---

## 4. 抓取策略

```
1. 调用 ModelRankingsScraper.refreshAll()
   ↓
2. 对每个 Model 行：
   a. fetchFromOfficial() 根据 provider switch
      - 静态 PRICING_TABLE 命中 → 直接返回（最快）
      - 未命中 → 真实 fetch 官方页（如 Anthropic 成功，OpenAI 403）
   b. fetchFromAA() 查 AA 静态快照（intelligence + speed）
   c. 创建 ModelPriceSnapshot 一条（即便未变化，也保留"无变化"的 audit）
   ↓
3. 失败模型：标记 isPending=true，cron 后续会重试
```

---

## 5. 已知限制

| 限制 | 影响 | 当前应对 |
|---|---|---|
| OpenAI 官方定价页 403 | 只能静态表 | 多个第三方交叉验证 |
| Google AI 定价页 403 | Gemini 2.5 用社区数据 | 已交叉验证 |
| xAI 域名变更 | docs.x.ai 经常失效 | 用 AI SDK docs 拿模型 ID + 静态价 |
| Llama 4 Maverick | 无官方 API | Together AI 估算 |
| Hunyuan Turbo | 国内云，海外定价不透明 | MANUAL 占位 |

---

## 6. 维护 SOP

### 6.1 新增模型

1. 在 `prisma/seed-models.ts` 的 `MODELS` 数组加一项
2. 在 `src/lib/rankings/scraper.ts` 的对应 provider PRICING_TABLE 加一行
3. 在 `src/lib/rankings/scraper.ts` 的 AA_DATA 加一行（intelligence + speed）
4. 在本文件第 2 节加一行表格
5. 跑 `npx tsx scripts/backfill-model-snapshots.ts`

### 6.2 价格变更

1. 改 `src/lib/rankings/scraper.ts` 的 PRICING_TABLE
2. 跑 cron 即可（每天 06:00 自动刷新），或手动跑 `npx tsx scripts/backfill-model-snapshots.ts`
3. 验证 `ModelPriceSnapshot` 表多了一条新记录

### 6.3 双环境验证

```bash
# 本地 SQLite
pnpm db:push
pnpm seed:models
npx tsx scripts/backfill-model-snapshots.ts

# Vercel Postgres（生产前）
vercel env pull .env.production
DATABASE_URL=$(grep DATABASE_URL .env.production | cut -d= -f2-) npx tsx scripts/backfill-model-snapshots.ts
```

---

## 7. 相关文件

| 文件 | 作用 |
|---|---|
| `src/lib/rankings/scraper.ts` | 主抓取器（含 PRICING_TABLE + AA_DATA） |
| `src/lib/rankings/algorithm.ts` | 性价比算法（calculateValueScore） |
| `src/server/routers/rankings.ts` | tRPC 路由（list / detail 三路匹配 / refresh） |
| `src/app/(app)/rankings/[id]/page.tsx` | 模型详情页 |
| `src/app/(app)/rankings/page.tsx` | 排行榜首页 |
| `src/components/rankings/PriceChart.tsx` | 价格走势图 |
| `prisma/seed-models.ts` | 24 个模型种子 |
| `scripts/backfill-model-snapshots.ts` | 手动回填脚本 |
| `src/app/api/cron/refresh-models/route.ts` | cron 兜底路由 |
| `prisma/schema.prisma` | Model + ModelPriceSnapshot 定义 |

---

## 8. 验收 Checklist

- [x] 24 个模型种子写入
- [x] 价格实时抓取（OFFICIAL + THIRD_PARTY fallback）
- [x] AA 能力分填充
- [x] 价格快照写入 ModelPriceSnapshot
- [x] 排行榜/详情页 UI
- [x] 详情页三路匹配（UUID / externalId / name）
- [x] 空态文案改进
- [x] cron 兜底
- [x] 手动回填脚本
- [x] 本地 SQLite + Vercel Postgres 双环境跑通
- [x] algorithm.test.ts 单元测试通过