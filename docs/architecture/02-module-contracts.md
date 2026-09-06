# 02 · 模块边界契约

> 本文件定义每个 `packages/*` 的**对外 API 契约**，确保任何模块只能通过白名单入口访问其他模块。

---

## 1. 总规则

### 1.1 三条不可违反的边界

1. **入口锁定**：每个包只能从 `package.json#exports` 声明的入口被导入
2. **依赖单向**：依赖图必须无环，且只允许"下层"被"上层"依赖
3. **类型显式**：任何对外暴露的类型必须 `export type`，且不能在跨包间传递 Prisma 实体（必须先 `.pick()` / `.omit()`）

### 1.2 实施工具

| 工具 | 作用 |
|---|---|
| `package.json#exports` | Node.js 原生支持，编译期阻断深路径 |
| `eslint-plugin-import/no-restricted-paths` | ESLint 规则，IDE 内实时警告 |
| `dependency-cruiser` | CI 阶段做完整依赖图校验，违规则阻断 merge |
| `pnpm --filter` | 增量构建，只重编改动的包 |

---

## 2. 每个包的契约

### 2.1 `@aihub/observability`

```typescript
// === 公共入口（index.ts）===
export { logger, log, type LogLevel, type LogContext } from './infra/logger'
export { alert, type Alert, type AlertSeverity } from './infra/alert'
export { withLock, isLockSkipped, type LockOptions, type LockResult } from './infra/distributed-lock'
```

**依赖**：
- 内置：`fs`, `path`, `os`, `crypto`
- 第三方：~~无~~（建议后续加入 `ioredis` 用于真正的分布式锁）

**被谁依赖**：`@aihub/*` 所有业务包 + `apps/*`

---

### 2.2 `@aihub/db`

```typescript
export { prismaBase, type PrismaBase } from './infra/client'
export { encryptField, decryptField } from './infra/encryption'
export { redis } from './infra/redis'
```

**依赖**：`@prisma/client`

**被谁依赖**：`@aihub/observability`（间接） + 几乎所有业务包

⚠️ **强约束**：`@aihub/db` 不允许 import 任何 `@aihub/observability` 之外的包（避免循环依赖）

---

### 2.3 `@aihub/slide-engine`

```typescript
// === 主入口（无 React/无 pptxgenjs）===
export type { ThemeTokens, TypeStyle, TypeScaleKey } from './domain/theme-contract'
export type { Box, BoxKind, TextMeta, PlacedBox, PlacedSlide } from './domain/geometry-contract'
export type { SlotBudget, CapacityOverflow, CapacityCheck } from './domain/capacity-contract'
export type { LintRuleId, LintIssue, LintReport } from './domain/lint-contract'
export type { SlideIR, SlidePlanEntry } from './domain/slide-ir-contract'
export type { MeasureOpts, PlanContext, PageTypeDefinition } from './domain/page-type-contract'
export { registerPageType, getPageType, hasPageType, listPageTypes, clearPageTypes } from './domain/registry'
export { measureWidth, measureLines, measureTextHeight } from './domain/measure'
export { passCapacity, checkCapacity } from './domain/capacity'
export { nextSmallerSize, dropTail } from './domain/degrade'
export { lintSlide, lintDeck } from './domain/lint'
export { runQAGate, checkQA, checkSlide, isQAPassed, getErrorCount, getWarnCount, formatQAReport } from './domain/qa-gate'

// === 可选 peer ===
export { renderDeckPptx, renderDeckToBuffer } from './interface/render-pptx'  // peer: pptxgenjs
export { SlideCanvas, DeckPreview } from './interface/render-web'             // peer: react
```

**依赖**：
- 第三方：`zod`（必选）、`pptxgenjs`（可选 peer）、`react`（可选 peer）

**被谁依赖**：`@aihub/daily-briefing`（仅通过 `domain` 子路径）

⚠️ **`templates/briefing/*` 严禁放入本包** —— 它属于 `@aihub/daily-briefing`

---

### 2.4 `@aihub/multimodal`

```typescript
export { fuseEvent, type FuseEventOptions } from './infra/fuse'
export type { FusedEvent } from './domain/fuse-event'
```

**依赖**：`@aihub/db`、`@aihub/news`（通过 `domain` 子路径）

---

### 2.5 `@aihub/ai-core`

```typescript
export { chat, chooseModel, DEFAULT_MODEL, type ChatOptions, type ChatMessage } from './interface/router'
export { SUPPORTED_MODELS, getModel, getModelsByProvider, isSupportedModel, resolveModelAlias, type ModelMeta } from './domain/models'
export { PRICING_TABLE, getPricing, calculateCost, type PricingEntry } from './domain/pricing'
export { getProviderAdapter, listProviders, FULL_ADAPTER_IDS, type ProviderId, type ProviderAdapter } from './infra/provider-registry'
export { resolveApiKey, verifyKeyHash, type ResolvedKey } from './infra/key-resolver'
export { buildSystemPrompt, sanitizeChatStylePrefs, type ChatStylePrefs } from './domain/chat-style'
```

**依赖**：`@aihub/db`、`@aihub/observability`、第三方 `openai`/`@anthropic-ai/sdk`/`@google/generative-ai`

⚠️ **删除** 现有 `client.ts` 的兼容占位导出（`deepseek` / `litellm`），改用 `getProviderAdapter(...)` 工厂

---

### 2.6 `@aihub/rankings`

```typescript
// 公共
export { calculateValueScore, normalizeScores, paretoFrontier, type ModelScoreInput, type ScoringResult } from './domain/algorithm'
export { ModelScraper, type ScrapedModelData } from './infra/scraper'
export { fetchRankingsForCron } from './interface/server/cron-entry'

// UI
export { StatsOverview, ParetoChart, PriceChart, RankingsTable, Top3Podium } from './interface/ui'
```

**依赖**：`@aihub/db`、`@aihub/observability`、内置 `crypto`

⚠️ **解耦**：`scraper.ts` 当前硬编码 `fetchWithRetry`，迁包后改用构造函数注入

---

### 2.7 `@aihub/news`

```typescript
// === 公共 ===
export { fetchAllNews, queryNews, countNews, getAvailableDates, extractModelNames, type NewsQueryOptions } from './infra/service'
export { searchNews, expandQuery, expandSynonymsLocally, type SearchResult, type SearchResponse } from './domain/search'
export { applyHealth, getUnhealthySources, type SourceHealth } from './infra/health'
export { NEWS_SOURCES, CATEGORY_KEYWORDS, AI_COMPANIES, type NewsSourceConfig } from './domain/sources'

// === 子路径：parsers（被 @aihub/bilibili 等复用）===
export { parseRssXml, fetchHtml, getParser, type ParsedItem } from './infra/parsers'

// === 子路径：intent（依赖 LLM）===
export { intentSearch, parseSearchIntent } from './infra/intent-search'
export { newsIntentSearch, parseNewsIntent } from './infra/news-intent'

// === 子路径：ui ===
export { NewsCard, NewsBriefDashboard, NewsAnalyticsModal } from './interface/ui'
```

**依赖**：
- 公共：`@aihub/db`、`@aihub/observability`、`@aihub/utils`、`@aihub/ai-core`（仅 intent 子路径）
- 子路径 parsers：无（最底层）
- 子路径 intent：`@aihub/ai-core`、`@aihub/rankings/domain`（用于复用算法）

⚠️ **强制规则**：`infra/parsers/*` 严禁 import `infra/service.ts`（避免循环）

---

### 2.8 `@aihub/bilibili`

```typescript
// === 公共 ===
export { scrapeBilibili, runBilibiliFetch, findArticleLink, parseNewsFromTitle, parseNewsFromArticle, classify, type BiliNews, type BiliVideo, type BiliData, type BilibiliFetchResult } from './interface/server/scraper'
export { signWbi, getMixinKey } from './infra/wbi'
export { getBiliCookie } from './infra/cookie'
export { UPLOADERS, ENABLED_UPLOADERS, getUploaderByUid, type BilibiliUploaderConfig } from './domain/sources'

// === 子路径：ui ===
export { BilibiliPanel, BilibiliNewsTab } from './interface/ui'
```

**依赖**：
- 公共：`@aihub/db`、`@aihub/observability`、`@aihub/news/parsers`、`@aihub/news/domain`
- ui：`react`（peer）

⚠️ **强制规则**：`interface/server/scraper.ts` 是唯一允许 import `@aihub/news/*` 的文件（编排层）

---

### 2.9 `@aihub/daily-briefing`

```typescript
// === 服务端 ===
export { dailyReportRouter } from './interface/server/router'
export { runDailyReportCron } from './interface/server/cron'
export { generateDailyReport, type GenerateOptions } from './infra/generate'
export { collectDailyNews, beijingDateString, type CollectResult } from './infra/collect'

// === 类型 ===
export type { DailyReportContent, Item, DirectionIndex, VideoAuthor, VerificationRow, Trend, BriefingPhase, SourceFamilyStat, ConfidenceBucket } from './domain/types'
export { DailyReportContentSchema, BRIEFING_THEMES, BRIEFING_PHASES, BRIEFING_PHASE_LABELS, enforceLimits, truncate } from './domain/types'
export { BRIEFING_PALETTES, getPalette, css, type BriefingPalette } from './domain/themes'
export { adaptV1ToV4, isV1Content } from './domain/adapters'

// === UI ===
export { BriefingToast, BriefingPanel, SlidePreview } from './interface/ui'

// === 子路径：pptx（peer: pptxgenjs）===
export { buildBriefingPptx, briefingFileName } from './infra/build-pptx'
```

**依赖**：
- 服务端：`@aihub/ai-core`、`@aihub/news`、`@aihub/rankings/domain`、`@aihub/slide-engine/domain`、`@aihub/db`、`@aihub/observability`
- pptx：第三方 `pptxgenjs`（peer）
- UI：`react`（peer）

⚠️ **强制规则**：`domain/slides/*` 中的每个文件**必须**通过 `registerPageType(...)` 调用注册，不允许直接修改 `slide-engine` 内部状态

---

### 2.10 `@aihub/ui`

```typescript
export { PageHeader, type PageHeaderProps } from './page-header'
export { MetricCard, type MetricCardProps } from './metric-card'
export { StatCard, type StatCardProps } from './stat-card'
export { SparkLine, type SparkLineProps } from './spark-line'
export { ErrorState, type ErrorStateProps } from './error-state'
```

**依赖**：`react`（peer）、`@tabler/icons-react`（peer，可选）、`next/link`（peer，可选）

---

### 2.11 `@aihub/config`

```typescript
// 仅配置文件，无运行时代码
export const baseTsConfig = { ... }
export const baseEslintConfig = { ... }
export const basePrettierConfig = { ... }
```

---

## 3. 跨包共享类型协议

### 3.1 通用规则

1. **任何 `Prisma.*GetPayload<...>` 实体禁止跨包传递**
   - ❌ `import { NewsItem } from '@aihub/db'` 然后传给其他包
   - ✅ `export type NewsSummary = Pick<NewsItem, 'id' | 'title' | 'publishedAt'>`

2. **共用枚举必须定义在依赖图最下层的包**
   - 例如 `ProviderId` 定义在 `@aihub/ai-core/domain`，禁止在 `@aihub/news` 重新声明

3. **错误类型统一**
   - 所有包定义 `class XxxError extends Error`，避免直接抛 `Error`
   - 顶层提供 `isXxxError(value): value is XxxError` 类型守卫

### 3.2 已知需要共享的类型清单

| 类型 | 定义位置 | 消费方 |
|---|---|---|
| `ProviderId` | `@aihub/ai-core/domain` | `@aihub/news/intent`、`@aihub/daily-briefing` |
| `NewsSourceName` | `@aihub/news/domain` | `@aihub/bilibili`、`@aihub/multimodal` |
| `ScoringResult` | `@aihub/rankings/domain` | `@aihub/news/intent`、`@aihub/daily-briefing` |
| `SlidePlanEntry` | `@aihub/slide-engine/domain` | `@aihub/daily-briefing` |
| `DailyReportContent` | `@aihub/daily-briefing/domain` | `apps/web` |

---

## 4. 契约验证

### 4.1 CI 检查清单

```yaml
# .github/workflows/contract-check.yml
- name: 依赖图校验
  run: pnpm depcruise --validate .dependency-cruiser.cjs
- name: 入口白名单校验
  run: node scripts/check-public-exports.mjs
- name: 类型边界校验
  run: pnpm typecheck --filter './packages/*'
```

### 4.2 Pre-commit Hook

```bash
# .husky/pre-commit
pnpm lint --filter '[origin]'
pnpm depcruise:local
```

---

## 5. 契约变更流程

任何对外 API 的修改必须：

1. 在 PR 中显式声明 `BREAKING CHANGE`（即使在 monorepo 内）
2. 更新 `ARCHITECTURE.md` 与本文件的对应章节
3. 通知所有 consumer 的 owner（用 CODEOWNERS 文件标记）
4. 在下一个 minor version（0.x.0）前提供过渡期（保留旧入口 2 周）

---

> 最后修订：2026-09-04
