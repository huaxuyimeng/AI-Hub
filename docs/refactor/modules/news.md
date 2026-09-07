# news.md · news 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.6

---

## 1. 一句话职责

AI 新闻聚合 / 解析 / 去重 / 关键词 / 意图搜索——`/news` 页面和 `fetch-news` cron 任务。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/news/service.ts` | ~500 | 聚合主流程（多源并发 / 去重 / 入库） |
| `src/lib/news/sources.ts` | ~400 | 源定义 + 厂家字典 |
| `src/lib/news/search.ts` | ~150 | 关键词搜索（含 expandQuery） |
| `src/lib/news/intent-search.ts` | ~300 | 模型侧意图搜索 |
| `src/lib/news/news-intent.ts` | ~420 | 新闻侧意图搜索 |
| `src/lib/news/health.ts` | ~100 | 源健康度监控 |
| `src/lib/news/parsers/*.ts` | 11 个文件 | 各源解析器（rss / html / hacker-news / wechat-mp 等） |
| `src/server/routers/news.ts` | ~350 | tRPC 入口 |
| `src/components/news/*` | 8 个文件 | UI 组件（NewsCard / NewsBriefDashboard / NewsAnalyticsModal） |

**合计**：~2500+ 行，是**最大业务模块**。

**关键修复历史**（来自 docs/AI新闻/）：

- Fix-01 ~ Fix-12（Qoder 优化报告）
- Issue-11（`tags` 字段未使用）
- 31 报告 11 个 Bug 全部修复

---

## 3. 目标包结构

```
packages/news/
├── src/
│   ├── domain/
│   │   ├── types.ts                 # 共享类型（NewsItem / NewsSource / ParsedItem）
│   │   ├── dedup.ts                 # 实体指纹跨源去重（Jaccard≥0.7）
│   │   ├── categorization.ts        # 4 类关键词
│   │   └── companyTag.ts            # extractCompanyTags
│   ├── infra/
│   │   ├── parsers/
│   │   │   ├── types.ts             # Parser 接口
│   │   │   ├── rss.ts
│   │   │   ├── html.ts
│   │   │   ├── hackerNews.ts
│   │   │   ├── wechatMp.ts
│   │   │   ├── aibase.ts
│   │   │   ├── aiBotDaily.ts
│   │   │   ├── aitnt.ts
│   │   │   ├── maomu.ts
│   │   │   ├── tmtpost.ts
│   │   │   ├── uniteAi.ts
│   │   │   └── index.ts             # 严禁 import ../service（防止循环）
│   │   ├── sources.ts               # 源定义 + 厂家字典
│   │   ├── searchRepo.ts            # Prisma 封装
│   │   └── sourceHealth.ts          # 健康度查询
│   ├── interface/
│   │   ├── server/
│   │   │   ├── trpcRouter.ts        # routers/news.ts 迁移
│   │   │   ├── service.ts           # 聚合主流程
│   │   │   ├── search.ts            # 关键词搜索
│   │   │   ├── intentSearch.ts      # 模型侧意图
│   │   │   └── newsIntent.ts        # 新闻侧意图
│   │   └── ui/                      # (可选) NewsCard 等组件
│   │       ├── NewsCard.tsx
│   │       └── NewsBriefDashboard.tsx
│   └── index.ts
├── tests/
│   ├── parsers/*.spec.ts            # 各 parser 单元测试
│   ├── dedup.spec.ts                # 跨源去重
│   └── intentSearch.spec.ts
├── package.json
└── README.md
```

**关键约束**：

- ❌ `parsers/index.ts` **严禁** import `../service`（防循环依赖）
- ✅ `parsers/types.ts` 改为引用 `domain/types.ts`（去重）
- ✅ `service.ts` 中所有 `parsers/*` import 改为相对路径 `./parsers`

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                  "./src/index.ts",
    "./interface/server": "./src/interface/server/trpcRouter.ts",
    "./interface/ui":     "./src/interface/ui/index.ts",
    "./parsers":          "./src/infra/parsers/index.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { newsRouter } from './interface/server/trpcRouter';
export type { NewsItem, NewsSource, ParsedItem } from './domain/types';
export { fetchAndStoreAllNews } from './interface/server/service';  // 给 cron 用
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | NewsItem / NewsSource / TermDictionary / TermEvaluation |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/observability` | `logger` / `withLock` / `alert` |
| `@aihub/aiCore` | LLM 调用（intent-search / news-intent） |
| `cheerio`（**新增**） | parsers/html.ts 重构（移除则用正则，但脆弱） |

**禁止依赖**：

- ❌ `chat` / `usage` / `projects`（news 是业务核心，不耦合 chat）
- ❌ `dailyBriefing` 反向引用（但 `dailyBriefing` 可引用 news）—— 边界规则见 dailyBriefing.md

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | `/news` 页面 |
| `apps/cron` | `fetchAndStoreAllNews`（Vercel Cron） |
| `dailyBriefing` | 从 `newsRouter` / `fetchAndStoreAllNews` 取当日新闻 |
| `multimodal` | NewsItem + ModelRanking 联合查询 |

---

## 7. 边界规则

1. ✅ 多源并发 `Semaphore(5)`——`service.ts:373-410`
2. ✅ 健康度告警：连续失败 N 次 → Slack alert（`health.ts`）
3. ✅ 北京时间日界归一 + `beijingDayStart()`（`service.ts:336-348`）
4. ✅ entity fingerprint 跨源去重（Jaccard ≥ 0.7 粗合并）
5. ⚠️ URL 唯一键 + `upsert` 增量爬取（**禁止** delete + insert）
6. ⚠️ 5 级封面图降级提取（`parsers/rss.ts:75-104`）
7. ❌ `parsers/index.ts` 严禁 import `../service`（循环依赖）
8. ❌ 公开路由（`publicProcedure`）不得暴露 NewsItem 详情（必须 `protectedProcedure`）

---

## 8. 迁移步骤

```bash
# P3.1 第 3 周（最大模块，最复杂）

mkdir -p packages/news/src/{domain,infra/parsers,interface/server,interface/ui}
mkdir -p packages/news/tests/parsers

# domain 先迁（无外部依赖）
cp src/lib/news/sources.ts packages/news/src/infra/sources.ts  # 简化后只留字典
# 提取 dedup / categorization / companyTag 到 domain/

# parsers 整体迁（注意严禁 import service）
cp -r src/lib/news/parsers/* packages/news/src/infra/parsers/
# parsers/types.ts 改为 import from '../../domain/types'

# service / search / intentSearch / newsIntent 迁到 interface/server/
cp src/lib/news/service.ts packages/news/src/interface/server/service.ts
cp src/lib/news/search.ts packages/news/src/interface/server/search.ts
cp src/lib/news/intent-search.ts packages/news/src/interface/server/intentSearch.ts
cp src/lib/news/news-intent.ts packages/news/src/interface/server/newsIntent.ts
cp src/lib/news/health.ts packages/news/src/infra/sourceHealth.ts

# tRPC router 迁
cp src/server/routers/news.ts packages/news/src/interface/server/trpcRouter.ts

# UI 组件（可选迁，保持 apps/web 也行）
# cp -r src/components/news/* packages/news/src/interface/ui/

# 替换全局 import
# @/lib/news/* → @aihub/news/*
# @/lib/news/parsers/* → @aihub/news/parsers

pnpm --filter @aihub/news typecheck
pnpm --filter @aihub/news test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| parsers ↔ service 循环依赖 | parsers 严禁 import service；service import parsers；types 独立 |
| `cheerio` 未安装（缺失依赖） | P3.1 同时装 `pnpm add cheerio` + 暂保留正则回退 |
| `intent-search.ts` 无 AbortController（已在 37 报告 §2.3.2 标记 P1） | 迁移时同步修复 |
| 多源并发 Semaphore 实现 | service.ts:373-410 整段复制，保留不动 |
| `dailyBriefing` 反向引用 | 在 dailyBriefing 迁完前不动 newsRouter exports |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/news typecheck` 通过
- [ ] `pnpm --filter @aihub/news test` 通过
- [ ] `pnpm dev` 后 `/news` 页正常加载
- [ ] `pnpm test:e2e` 跑 news intent-search 端到端（如果有）
- [ ] `pnpm cron:fetch-news` 跑通（单次抓取）
- [ ] 24 源全部 enabled，0 个 fail streak > 3

---

## 11. 过期条件

- 引入新源（>= 25 个时评估 parsers 拆分）
- TermDictionary verified 字段变更
- FTS5 全文索引启用（数据 > 3000 条触发）
- 引入 SSRF 防护（已识别 BUG-11）
- 切换意图搜索后端（OpenAI Function Call ↔ Anthropic Tool Use）

---

**创建时间**：2026-09-07
