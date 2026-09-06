# 01 · 模块拆分方案详细说明

> 本文件是 `ARCHITECTURE.md` 的展开，重点回答：**每个模块如何从 `src/` 迁到 `packages/`**，需要解决哪些具体的循环依赖、跨模块引用、隐式 import 问题。

---

## 1. 总原则

1. **一个包只做一件事** —— `@aihub/news` 不包含 LLM 调用，`@aihub/ai-core` 不包含任何业务字段
2. **依赖单向、无环** —— `db → observability → ai-core → 业务模块 → apps`，禁止反向
3. **对外只有 `index.ts`** —— 用 `package.json#exports` 强制锁死入口
4. **每个包都有 `domain / infra / interface` 三层** —— `domain` 纯逻辑可单测；`infra` 接入外部资源；`interface` 提供 tRPC/CLI/UI

---

## 2. 逐包拆分设计

### 2.1 `@aihub/observability`（P0，最优先）

**当前**：3 个文件，~240 行，`src/lib/observability/{logger,alert,distributed-lock}.ts`

**目标结构**：
```
packages/observability/
├── src/
│   ├── domain/
│   │   └── log-level.ts          # enum + 类型
│   ├── infra/
│   │   ├── logger.ts             # 现有 logger.ts
│   │   ├── alert.ts              # 现有 alert.ts
│   │   └── distributed-lock.ts   # 现有 distributed-lock.ts（接 Redis 适配器）
│   ├── interface/
│   │   └── index.ts              # 重导出
│   └── index.ts                  # 公共入口
├── package.json
├── tsconfig.json
└── README.md
```

**exports**：
```ts
// @aihub/observability
export { logger, log } from './infra/logger'
export { alert, type Alert } from './infra/alert'
export { withLock, isLockSkipped, type LockResult } from './infra/distributed-lock'
```

**迁移要点**：
- ✅ 无内部依赖，最容易迁
- ⚠️ `distributed-lock.ts` 当前是文件锁实现，迁到包后建议改造为 Redis 适配器（接 `@aihub/db` 的 `redisClient`），避免本地多实例部署时锁失效
- ⚠️ `alert` 的 `SLACK_WEBHOOK_URL` 应改为从 `@aihub/config` 的 env schema 读取

---

### 2.2 `@aihub/db`（P0）

**当前**：`prisma/schema.prisma` + `src/lib/db.ts`（Prisma client 单例 + 字段加密）

**目标结构**：
```
packages/db/
├── src/
│   ├── domain/            # 无（数据库层无领域逻辑）
│   ├── infra/
│   │   ├── client.ts      # PrismaClient 单例（含 dev hot-reload 安全）
│   │   ├── encryption.ts  # 现有 crypto.ts（API Key 加解密）
│   │   └── redis.ts       # Redis client 单例
│   ├── interface/
│   │   └── index.ts
│   └── index.ts
├── prisma/
│   └── schema.prisma      # 从根目录 prisma/ 软链或迁移
├── package.json
└── tsconfig.json
```

**exports**：
```ts
export { prismaBase, type PrismaBase } from './infra/client'
export { encryptField, decryptField } from './infra/encryption'
export { redis } from './infra/redis'
```

**迁移要点**：
- ✅ Prisma schema 移到包内，根目录保留 `prisma/schema.prisma` 软链
- ⚠️ `prisma generate` 需要在 `packages/db/package.json` 的 `postinstall` 中执行
- ⚠️ 当前 `src/lib/db.ts` 与 `src/lib/crypto.ts` 合并到本包

---

### 2.3 `@aihub/slide-engine`（P1，零内部依赖）

**当前**：`src/lib/slide-engine/` 35 个文件，~4,550 行，**零内部依赖**

**目标结构**：
```
packages/slide-engine/
├── src/
│   ├── domain/            # contracts/* + registry/* + layout/* + qa/*
│   ├── infra/             # （无，纯函数库不需要）
│   ├── interface/
│   │   ├── render-pptx.ts # pptxgenjs 渲染
│   │   ├── render-web.tsx # React 渲染
│   │   └── cli.ts         # 命令行工具
│   └── index.ts
├── package.json
└── README.md
```

**exports**（按需分层）：
```ts
// 主入口（无 React/无 pptxgenjs 依赖）
export * from './domain'

// 可选 peer：pptxgenjs
export { renderDeckPptx, renderDeckToBuffer } from './interface/render-pptx'

// 可选 peer：react
export { SlideCanvas, DeckPreview } from './interface/render-web'
```

**迁移要点**：
- ✅ 纯函数库，无业务耦合，**最容易独立**
- ✅ 现有 `cli.ts` 完整保留，可作为内部测试工具
- ⚠️ `templates/briefing/*` **不**放到本包 —— 它是 `@aihub/daily-briefing` 的领域
- ⚠️ `package.json` 的 `peerDependencies` 必须声明 `pptxgenjs` 与 `react` 为可选

---

### 2.4 `@aihub/multimodal`（P1，代码量极小）

**当前**：仅 `src/lib/multimodal/fuse.ts`，123 行

**目标结构**：
```
packages/multimodal/
├── src/
│   ├── domain/
│   │   └── fuse-event.ts   # 纯计算逻辑（拆出核心算法）
│   ├── infra/
│   │   └── fuse.ts         # 当前 fuse.ts（依赖 Prisma）
│   ├── interface/
│   │   └── index.ts
│   └── index.ts
```

**迁移要点**：
- ✅ 极小，可独立
- ⚠️ 当前 `fuse.ts` 直接依赖 `prismaBase`，迁到 `@aihub/db` 后通过类型注入解耦

---

### 2.5 `@aihub/ai-core`（P1）

**当前**：`src/lib/ai/`，7 个文件，~983 行

**目标结构**：
```
packages/ai-core/
├── src/
│   ├── domain/
│   │   ├── models.ts          # SUPPORTED_MODELS / getModel / 别名解析
│   │   ├── pricing.ts         # PRICING_TABLE / calculateCost
│   │   └── chat-style.ts      # buildSystemPrompt / sanitizePrefs
│   ├── infra/
│   │   ├── providers/         # 各 Provider 适配器
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   ├── gemini.ts
│   │   │   └── ... (其他 9 个)
│   │   ├── provider-registry.ts
│   │   └── key-resolver.ts    # resolveApiKey（DB → env 回退）
│   ├── interface/
│   │   ├── router.ts          # chat() / chooseModel()
│   │   └── index.ts
│   └── index.ts
```

**exports**：
```ts
export { chat, chooseModel, DEFAULT_MODEL } from './interface/router'
export { SUPPORTED_MODELS, getModel, isSupportedModel, resolveModelAlias } from './domain/models'
export { PRICING_TABLE, getPricing, calculateCost } from './domain/pricing'
export { getProviderAdapter, listProviders, FULL_ADAPTER_IDS } from './infra/provider-registry'
export { resolveApiKey, verifyKeyHash } from './infra/key-resolver'
export { buildSystemPrompt, sanitizeChatStylePrefs } from './domain/chat-style'
```

**迁移要点**：
- ✅ 依赖少：仅 `@aihub/db` + `@aihub/observability`
- ⚠️ `client.ts` 当前只导出兼容占位（`deepseek` / `litellm`），迁移后**建议直接删除**（已弃用）
- ⚠️ `router.ts` 引入 dev-mode mock 应改为 `process.env.AIHUB_AI_MOCK === '1'`，避免硬编码

---

### 2.6 `@aihub/rankings`（P2）

**当前**：`src/lib/rankings/{algorithm,scraper}.ts` (776 行) + `src/components/rankings/*` (665 行)

**目标结构**：
```
packages/rankings/
├── src/
│   ├── domain/
│   │   ├── algorithm.ts       # 纯计算（性价比/帕累托）
│   │   └── pricing-table.ts   # 静态定价表
│   ├── infra/
│   │   ├── scraper.ts         # HTTP 抓取（需解耦 fetch-with-retry）
│   │   └── persistence.ts     # 写入 Prisma
│   ├── interface/
│   │   ├── server/
│   │   │   └── router.ts      # tRPC router
│   │   └── ui/                # React 组件
│   │       ├── ParetoChart.tsx
│   │       ├── PriceChart.tsx
│   │       ├── RankingsTable.tsx
│   │       ├── Top3Podium.tsx
│   │       ├── StatsOverview.tsx
│   │       └── index.ts
│   └── index.ts
```

**exports**：
```ts
// 服务端
export { calculateValueScore, normalizeScores, paretoFrontier } from './domain/algorithm'
export { ModelScraper } from './infra/scraper'
// UI
export { StatsOverview, ParetoChart, PriceChart, RankingsTable, Top3Podium } from './interface/ui'
```

**迁移要点**：
- ⚠️ `scraper.ts` 当前隐式依赖 `fetch-with-retry`，迁到包后**改用构造函数注入 fetch 函数**，便于测试
- ⚠️ UI 组件无内部依赖，但**只导出，不在 apps/web 里二次封装**——直接 import 即可
- ⚠️ `algorithm.test.ts` 应改为 Vitest 单测，写在 `tests/`

---

### 2.7 `@aihub/news`（P2，依赖最复杂）

**当前**：`src/lib/news/` 19 个文件，~3,588 行；`src/components/news/*` 多个组件

**目标结构**：
```
packages/news/
├── src/
│   ├── domain/
│   │   ├── sources.ts          # NEWS_SOURCES / CATEGORY_KEYWORDS / AI_COMPANIES
│   │   ├── search.ts           # 同义词展开 + 精确搜索
│   │   ├── dedup.ts            # 跨源去重（基于 entity-fingerprint）
│   │   └── intent-parse.ts     # LLM 解析自然语言意图（纯逻辑）
│   ├── infra/
│   │   ├── parsers/            # 各源解析器
│   │   │   ├── rss.ts
│   │   │   ├── html.ts
│   │   │   ├── wechat-mp.ts
│   │   │   ├── hacker-news.ts
│   │   │   ├── aibase.ts
│   │   │   ├── aitnt.ts
│   │   │   ├── tmtpost.ts
│   │   │   ├── maomu.ts
│   │   │   ├── ai-bot-daily.ts
│   │   │   ├── unite-ai.ts
│   │   │   └── index.ts
│   │   ├── service.ts          # fetchAllNews / queryNews / 主流程
│   │   ├── intent-search.ts    # Model 排行用意图搜索
│   │   ├── news-intent.ts      # News 用意图搜索
│   │   └── health.ts
│   ├── interface/
│   │   ├── server/
│   │   │   └── router.ts       # tRPC router
│   │   ├── ui/                 # React 组件
│   │   │   ├── NewsCard.tsx
│   │   │   ├── NewsBriefDashboard.tsx
│   │   │   ├── NewsAnalyticsModal.tsx
│   │   │   └── index.ts
│   │   └── index.ts
│   └── index.ts
```

**exports**（按 consumer 分层）：
```ts
// @aihub/news（公共）
export { fetchAllNews, queryNews, countNews, getAvailableDates, extractModelNames } from './infra/service'
export { searchNews, expandQuery, expandSynonymsLocally } from './domain/search'
export { applyHealth, getUnhealthySources } from './infra/health'
export { NEWS_SOURCES, CATEGORY_KEYWORDS, AI_COMPANIES } from './domain/sources'
export type { NewsQueryOptions, SearchResult } from '...'

// @aihub/news/intent（依赖 LLM）
export { intentSearch, parseSearchIntent } from './infra/intent-search'
export { newsIntentSearch, parseNewsIntent } from './infra/news-intent'

// @aihub/news/ui（依赖 React）
export { NewsCard, NewsBriefDashboard, NewsAnalyticsModal } from './interface/ui'
```

**迁移难点（必须解决）**：
1. ❗ **`parsers/index.ts` 当前依赖 `../service`（隐式）** —— 解析器若反过来依赖 service，会形成循环。需重写为：parsers 只依赖 `domain/types.ts`，service 编排 parsers
2. ❗ **`parsers/wechat-mp.ts` 当前 `import './types'`，需统一为 `domain/types`**
3. ❗ **`intent-search.ts` 依赖 `@aihub/rankings/algorithm`** —— 迁包后通过 `@aihub/rankings` 的 `domain` 子路径暴露算法，**禁止深路径穿透**
4. ❗ **`bilibili/scraper.ts` 当前 `import` 了 `@/lib/news/parsers`** —— 迁移后改为 `@aihub/news/parsers` 子路径（需在 `package.json#exports` 中暴露）

---

### 2.8 `@aihub/bilibili`（P3，最复杂）

**当前**：`src/lib/bilibili/` 12 个文件，~1,853 行；`src/components/bilibili/*` 433 行

**目标结构**：
```
packages/bilibili/
├── src/
│   ├── domain/
│   │   ├── sources.ts       # UP 主配置（UPLOADERS）
│   │   └── classify.ts      # AI 关键词过滤 + 标题切分
│   ├── infra/
│   │   ├── api.ts           # B 站公开 API 封装
│   │   ├── wbi.ts           # WBI 签名
│   │   ├── cookie.ts        # Cookie 注入
│   │   ├── subtitle.ts      # 字幕搜索
│   │   ├── rss.ts           # RSSHub 兜底
│   │   ├── storage.ts       # 写入 Prisma
│   │   └── merge.ts         # 合并到 NewsItem
│   ├── interface/
│   │   ├── server/
│   │   │   └── scraper.ts   # 现有 scraper.ts（编排层）
│   │   ├── ui/
│   │   │   ├── BilibiliPanel.tsx
│   │   │   ├── BilibiliNewsTab.tsx
│   │   │   └── index.ts
│   │   └── index.ts
│   └── index.ts
```

**exports**：
```ts
// 公开
export { scrapeBilibili, runBilibiliFetch } from './interface/server/scraper'
export { signWbi, getMixinKey } from './infra/wbi'
export { getBiliCookie } from './infra/cookie'
export { UPLOADERS, ENABLED_UPLOADERS, getUploaderByUid } from './domain/sources'
export { parseNewsFromTitle, parseNewsFromArticle, classify } from './domain/classify'
export type { BiliNews, BiliVideo, BiliData, BilibiliFetchResult } from './interface/server/scraper'
export { BilibiliPanel, BilibiliNewsTab } from './interface/ui'
```

**迁移难点**：
1. ❗ **`scraper.ts` 当前依赖 `@/lib/news/parsers`（wechat-mp）** —— 改为通过 `@aihub/news/parsers` 子路径 import
2. ❗ **`scraper.ts` 当前依赖 `@/lib/news/sources`（共用 NEWS_SOURCES）** —— 改为通过 `@aihub/news/domain` import
3. ❗ **scraper 是"编排层"，不应放在 `infra/`** —— 放到 `interface/server/scraper.ts` 以体现"它是暴露给外部的入口"
4. ⚠️ `api.ts` 当前硬编码 `fetchWithRetry`，迁包后改为构造函数注入 `fetch: typeof fetch` 便于 mock

---

### 2.9 `@aihub/daily-briefing`（P3，最深依赖）

**当前**：`src/features/daily-briefing/` 13 个文件，~4,491 行

**目标结构**：
```
packages/daily-briefing/
├── src/
│   ├── domain/
│   │   ├── types.ts             # v4 schema + 阶段枚举
│   │   ├── themes.ts            # BRIEFING_PALETTES
│   │   ├── adapters.ts          # v1 → v4 适配
│   │   └── slides/              # slide-engine 的"业务页型"
│   │       ├── cover.ts
│   │       ├── overview.ts
│   │       ├── direction-index.ts
│   │       ├── direction-detail.ts
│   │       ├── rumor.ts
│   │       ├── verification.ts
│   │       ├── sources.ts
│   │       ├── authors.ts
│   │       ├── trends.ts
│   │       └── index.ts         # registerPageType 调用
│   ├── infra/
│   │   ├── collect.ts           # 当日数据采集
│   │   ├── generate.ts          # 两步 LLM 生成管线
│   │   └── build-pptx.ts        # pptxgenjs 构建
│   ├── interface/
│   │   ├── server/
│   │   │   ├── router.ts        # tRPC router
│   │   │   └── cron.ts          # 现有 cron.ts（含分布式锁 + 重试）
│   │   ├── ui/
│   │   │   ├── BriefingToast.tsx
│   │   │   ├── BriefingPanel.tsx
│   │   │   ├── SlidePreview.tsx
│   │   │   └── index.ts
│   │   └── index.ts
│   └── index.ts
```

**exports**：
```ts
// 服务端
export { dailyReportRouter } from './interface/server/router'
export { runDailyReportCron } from './interface/server/cron'
export { generateDailyReport } from './infra/generate'
export { collectDailyNews, beijingDateString } from './infra/collect'

// 共享类型
export type { DailyReportContent, Item, DirectionIndex, VideoAuthor, VerificationRow, Trend, BriefingPhase } from './domain/types'
export { DailyReportContentSchema, BRIEFING_THEMES, BRIEFING_PHASES, BRIEFING_PHASE_LABELS, enforceLimits, truncate } from './domain/types'
export { BRIEFING_PALETTES, getPalette, css } from './domain/themes'
export { adaptV1ToV4, isV1Content } from './domain/adapters'

// UI
export { BriefingToast, BriefingPanel, SlidePreview } from './interface/ui'
```

**迁移难点**：
1. ❗ **`domain/slides/` 当前直接 import `slide-engine` 内部** —— 迁移后通过 `@aihub/slide-engine` 的 `domain` 子路径暴露的注册 API 调用 `registerPageType(...)`
2. ❗ **`build-pptx.ts` 直接 import `slide-engine` 内部文件** —— 改为通过子路径
3. ❗ **`generate.ts` 依赖 `@/lib/ai/router`、`@/lib/news/service`、`@/lib/rankings/algorithm`、`@/lib/observability/*`** —— 全部改为 `@aihub/*` 命名空间
4. ⚠️ **`SlidePreview.tsx`（1103 行）当前无后端依赖，但耦合了 React Server Component 写法** —— 迁到 ui 子路径时需检查 `'use client'` 边界

---

## 3. 跨包依赖的"合法矩阵"

| 调用方 ↓ \ 被调用方 → | db | observability | ai-core | news | rankings | bilibili | multimodal | slide-engine | daily-briefing | ui |
|---|---|---|---|---|---|---|---|---|---|---|
| **db** | - | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **observability** | ✅ | - | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **ai-core** | ✅ | ✅ | - | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **news** | ✅ | ✅ | ✅(int) | - | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **rankings** | ✅ | ✅ | ✗ | ✗ | - | ✗ | ✗ | ✗ | ✗ | ✗ |
| **bilibili** | ✅ | ✅ | ✗ | ✅(parsers) | ✗ | - | ✗ | ✗ | ✗ | ✗ |
| **multimodal** | ✅ | ✅ | ✗ | ✅ | ✅ | ✗ | - | ✗ | ✗ | ✗ |
| **slide-engine** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | - | ✗ | ✗ |
| **daily-briefing** | ✅ | ✅ | ✅ | ✅ | ✅(domain) | ✗ | ✗ | ✅(domain) | - | ✗ |
| **ui** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | - |
| **apps/web** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **apps/cron** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✗ |

> 详细规则与违规阻断机制见 [05-dependency-rules.md](./05-dependency-rules.md)

---

## 4. 迁移期间的特殊处理

迁移不是一次性事件，整个过程会持续 2-4 周。期间必须做到：

1. **新旧共存** —— `src/` 与 `packages/*` 同时存在，逐步用 `import` 转发
2. **类型先迁** —— 先把 `.d.ts` 和 interface 迁到新包，让消费方先切换
3. **测试覆盖** —— 每个包迁完必须跑一次该包的单元测试 + 集成测试
4. **git tag 标注** —— 每个 P 阶段完成后打 tag（如 `v0.5-monorepo-p0`），便于回滚

具体迁移顺序与回滚预案见 [03-migration-roadmap.md](./03-migration-roadmap.md)

---

> 最后修订：2026-09-04
