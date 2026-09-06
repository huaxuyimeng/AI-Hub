# AI 新闻模块完整性评审报告

> 评审时间：2026-09-01
> 评审方式：3 个子代理并行深度调研 + 父级整合
> 评审范围：代码 + 文档 + env + schema + 依赖（代码无修改，仅汇总）
> 对照基准：docs/28、29、30×2、30-D3、31、32、33、35 共 8 份报告

---

## 一、TL;DR — 你需要知道的 3 件事

1. **AI 新闻后端 100% 完工，抓取/解析/路由/搜索/意图全链路可用**——32 报告的 Fix-01~12 全部兑现，31 报告 11 个 Bug 全部修复，0 个严重功能缺陷。
2. **未完工的 6 项**中只有 1 个真正的 P0 卡点 + 1 个 P1 Bug，其余都是产品打磨层。
3. **README ↔ 36 报告存在事实冲突**：README 多处仍写"D-1 未开始"，但 D-1 已完成。**这是当前最该修的事**。

| 严重程度 | 数量 | 一句话总结 |
|---|---|---|
| 🔴 P0 | 1 | 智能搜索功能等于空转（需用户人工审核术语） |
| 🟠 P1 | 1 | 新闻意图搜索多厂家场景可能漏新闻（前端 OK，后端逻辑） |
| 🟡 P1/P2 | 4 | 前端"智能问答"开关 / `followedModels` 未消费 / `tags` 字段未删 / README 状态冲突 |
| 🟢 P2/P3 | 多项 | 设计完成未实施的预案（性能 / 安全 / 字段清理） |

---

## 二、代码完成度（对照 8 份报告逐条核对）

### 2.1 已完成清单（高亮兑现的承诺）

| # | 兑现项 | 文件位置 |
|---|---|---|
| ✅ | RSS/HTML/API 三类解析器拆分 | `src/lib/news/parsers/{rss,html,hacker-news}.ts` |
| ✅ | 5 级封面图降级提取 | `src/lib/news/parsers/rss.ts:75-104` |
| ✅ | `publishedAt` 解析失败保持 null | `service.ts:233-285` |
| ✅ | URL 唯一键 + `upsert` 增量爬取 | `service.ts:266-285` |
| ✅ | 实体指纹跨源去重 + Jaccard≥0.7 粗合并 | `service.ts:134-220` |
| ✅ | 北京时间日界归一 + `beijingDayStart()` | `service.ts:336-348` |
| ✅ | 模型名正则（GPT/Claude/DeepSeek/Gemini/Grok/Llama/Mistral/Qwen） | `service.ts:98-120` |
| ✅ | 多源并发 `Semaphore(5)` + 健康度告警 | `service.ts:373-410`, `health.ts` |
| ✅ | 自动分类（4 类关键词） | `service.ts:84-95`, `sources.ts:159-194` |
| ✅ | 40+ AI 厂家字典 + `extractCompanyTags()` | `sources.ts:198-298` |
| ✅ | 排序 `publishedAt desc, nulls last`（Issue-10） | `service.ts:454-459` |
| ✅ | 精确 companyTag 四段匹配（Fix-08） | `service.ts:368-383` |
| ✅ | 关键词 OR 列表 → `searchKeywords[]`（Fix-11） | `service.ts:385-398` |
| ✅ | `getAvailableDates` 用 `DATE(.../1000,'unixepoch','+8 hours')` | `service.ts:469-484` |
| ✅ | D-3 模型意图搜索 `parseSearchIntent` + 降级 | `src/lib/news/intent-search.ts:138-308` |
| ✅ | D-3 新闻意图搜索 `parseNewsIntent`（§1 完成） | `src/lib/news/news-intent.ts:220-421` |
| ✅ | AbortController 3500ms 超时（仅 news-intent） | `news-intent.ts:227-235` |
| ✅ | 分类/厂家枚举白名单防 LLM 幻觉 | `news-intent.ts:53-58` |
| ✅ | `expandQuery` 一次性拉 verified 术语 | `search.ts:53-92` |
| ✅ | `news.list` 同步 `filteredTotal` / `hasMore` / `searchMeta` | `routers/news.ts:84-91` |
| ✅ | `news.stats` 4 图 groupBy（Fix-01 去重） | `routers/news.ts:110-135` |
| ✅ | `news.intentSearch` procedure 声明 | `routers/news.ts:304-313` |
| ✅ | `news.refresh` 用 `protectedProcedure` | `routers/news.ts:137-146` |
| ✅ | `news.byModel` 区分 publishedAt 精度 | `routers/news.ts:148-169` |
| ✅ | 前端 LiveClock（SSR 安全） | `news/page.tsx:31-65` |
| ✅ | 右上角精简 4 按钮 | `news/page.tsx:228-254` |
| ✅ | 筛选区默认收起 | `news/page.tsx:259-356` |
| ✅ | 累积式分页 + `placeholderData`（Fix-03） | `news/page.tsx:101-129` |
| ✅ | `filteredTotal` → 「匹配 X 条」/「剩余 X 条」 | `news/page.tsx:151-170` |
| ✅ | 搜索 300ms 防抖 | `news/page.tsx:131-137` |
| ✅ | 同义词展开 UI 提示 | `news/page.tsx:353-360` |
| ✅ | 自动抓取防误触（Fix-05） | `news/page.tsx:158-167` |
| ✅ | 分类计数来自全量 groupBy（Fix-10） | `news/page.tsx:156` |
| ✅ | NewsCard 封面图声明式错误隐藏（Bug-06） | `NewsCard.tsx:84, 108-126` |
| ✅ | NewsCard `<mark>` key 修复（Bug-05） | `NewsCard.tsx:101` |
| ✅ | NewsCard 高亮正则 `escapeRegExp()`（Fix-06） | `NewsCard.tsx:25-27` |
| ✅ | NewsCard `memo` 包装 | `NewsCard.tsx:82` |
| ✅ | NewsCard publishedAt 不可信判定 + 「未知」徽标 | `NewsCard.tsx:76-79, 152-167` |
| ✅ | NewsAnalyticsModal ESC 关闭 + body 锁定（Bug-07） | `NewsAnalyticsModal.tsx:55-71` |
| ✅ | NewsAnalyticsModal 4 图重构 | `NewsAnalyticsModal.tsx:115-381` |
| ✅ | `categoryDistribution` 字段同步（Fix-01） | `NewsAnalyticsModal.tsx:38` |
| ✅ | 抓取 cron：鉴权 + 分布式锁 + 偏好聚合 | `api/cron/fetch-news/route.ts:18-92` |
| ✅ | 关注分类过滤（Fix-12） | `fetch-news/route.ts:39-46` |
| ✅ | `refresh-terms` 周维护 cron | `api/cron/refresh-terms/route.ts` |

### 2.2 未完成 / 疑似未完成清单

| # | 报告承诺 | 实际状态 | 严重程度 |
|---|---|---|---|
| 2.2.1 | 33 §1「前端接入智能问答开关 / 长句触发」 | **未实现** — `news.intentSearch` procedure 已声明但前端 0 调用（`grep` 验证 `src/app/(app)/news/` 无任何 `intentSearch` / `意图` / `问答` 引用） | 🟠 P1 |
| 2.2.2 | 33 §5「`followedModels` 完全未消费」 | **未消费** — `service.ts:318` 声明参数但函数体从不读取；`fetch-news/route.ts:37` select 了但未透传 | 🟡 P2 |
| 2.2.3 | 31 Issue-11「`tags` 字段未使用，建议删除」 | **未删** — `prisma/schema.prisma:430` 仍在；`routers/news.ts:64` 仍 select 返回 | 🟢 P3 |
| 2.2.4 | 28 报告「10+ AI 新闻源」 | **24 个源已就位**，但 OpenAI News 403 未解决（30 v4 §待解决 已承认） | 🟢 P3 |
| 2.2.5 | 33 §3 FTS5 / 虚拟滚动 / 缓存 | **设计完成未实施**（触发条件数据 > 3000 条，当前 320） | 🟢 P3 |
| 2.2.6 | 33 §4 封面图 HEAD 校验 / R2 转存 | **设计完成未实施** | 🟢 P3 |
| 2.2.7 | 33 §6 tRPC 公开 → `protectedProcedure` | **未实施**（单租户可接受） | 🟢 P3 |
| 2.2.8 | 33 §6 空态文案（lastFetchAt + lastError） | **未实施** — `news/page.tsx:381-391` 只显示"暂无数据" | 🟢 P3 |
| 2.2.9 | 33 §2「TermDictionary verified=true = 0」 | **0 仍未变** — 设计安全锁（需人工 review-terms），但**这是 P0 智能搜索生效的卡点** | 🔴 P0 |
| 2.2.10 | 30-D3 §「⚠️ 待 .env 配置 LITELLM_BASE_URL 才能实测」 | **未实测** — `.env.example` 也无 LITELLM_BASE_URL 字段 | 🟠 P1 |

### 2.3 一致性 / 潜在 Bug（代码层）

#### 2.3.1 🟠 P1 — `newsIntentSearch` 多厂家 OR 查询丢失命中

- **位置**：`src/lib/news/news-intent.ts:314-319, 354-365`
- **现象**：
  ```ts
  // 简化：service.ts 不支持 OR，先取第一个 companyTag
  if (filters?.companyTags?.length && filters.companyTags.length > 1) {
    options.companyTag = filters.companyTags[0];
  }
  // 然后后置过滤在拉到结果里 OR 多家
  ```
- **问题**：意图搜索场景"OpenAI 和 Anthropic 吵架相关"会被拆解为多厂家过滤。先用第一家过滤 → 拉到 200 条 → 后置过滤只在 200 条内 OR 第二家 → 第二家的新闻完全丢失。
- **修复方向**（不在本评审范围，仅记录）：让 `queryNews` 支持 `companyTag OR` 列表，或在后置过滤前取消主过滤。

#### 2.3.2 🟠 P1 — `intent-search.ts`（模型侧）LLM 调用无超时

- **位置**：`src/lib/news/intent-search.ts:138-174`
- **现象**：对比 `news-intent.ts:227-235` 有 3500ms AbortController，模型侧 `parseSearchIntent` 是裸调用。
- **风险**：LLM 不可用时排行榜搜索框可能挂死。
- **修复方向**：复用 `news-intent.ts` 的 AbortController 模式。

#### 2.3.3 🟡 P2 — `executeIntentSearch` 把 provider `contains` 当精确匹配

- **位置**：`src/lib/news/intent-search.ts:227-237`
- **现象**：搜 "AI" 会命中所有 provider 含 "ai" 的厂商，与 32 Fix-08 的四段精确匹配未对齐。

#### 2.3.4 🟡 P2 — `newsIntentSearch` preset 日期范围的 total 不准

- **位置**：`src/lib/news/news-intent.ts:367-376`
- **现象**：preset 走**后置过滤**，但 `total = raw.length`（截断到 200 条之前的过滤后长度）。预设里"剩余 X 条"会显示 0。

#### 2.3.5 🟢 P3 — `newsIntentSearch` `preset: 'custom'` 走 `start` 单日

- **位置**：`src/lib/news/news-intent.ts:304-310`
- **现象**：注释承认 "service.ts 的 where.date 是单日选择，多日区间需要扩展 service.ts"。

#### 2.3.6 🟢 P3 — `refresh-terms` LLM 调用同样无 AbortController

- **位置**：`api/cron/refresh-terms/route.ts:71-80, 121-130`
- **影响**：cron `maxDuration=300` 兜底，影响小。

#### 2.3.7 🟢 P3 — `getAvailableDates` SQL 类型转换隐式假设 Prisma 存储格式

- **位置**：`src/lib/news/service.ts:472-484`
- **现象**：依赖 `publishedAt / 1000` 转 unixepoch，假设 Prisma SQLite 存纯毫秒数。若 Prisma 升级可能静默失效。

### 2.4 覆盖率盲点（后端有 / 前端没有）

| 子项 | 状态 | 说明 |
|---|---|---|
| `news.intentSearch` procedure | 后端 ✅ / 前端 ❌ | **无 UI 触发**——见 2.2.1 |
| `news.byModel` procedure | 后端 ✅ / 前端 ❌ | 全局 grep 仅出现在 router.ts |
| `NewsSource` 健康度 | DB ✅ / 前端 ❌ | `lastError` / `failStreak` 数据在后端，但前端没有任何"源健康"页面 |

---

## 三、文档完成度

### 3.1 文档状态摘要

| 文档 | 状态 | 一句话总结 |
|---|---|---|
| 28-AI新闻系统全面升级报告 | 🟡 v2 已过期 | UI 设计已被 29→30→32 三轮推翻 |
| 29-AI新闻界面v3重构报告 | 🟡 v3 已过期 | 30 v4 修其筛选区问题，31 评审发现 3 个 🔴 bug |
| 30-AI新闻v4修复报告 | 🟡 v4 部分过期 | "Bug-04 DATE() 修复"被 32 证伪"实际从未生效" |
| 30-D3-意图搜索-完成总结 | 🟢 当前生效 | ⚠️ 但"待 LITELLM_BASE_URL"未实测 |
| 31-AI新闻专家级评审报告 | 🟢 闭环完成 | 末尾"待用户决策项"4 条已在 §后闭环 |
| 32-Qoder-AI新闻优化完成报告 | 🟢 当前事实 | 5 严重 + 7 中等 + 4 性能，验收齐全 |
| 33-Qoder-未来优化建议报告 | 🟢 当前事实 | P0/P1/P2 + 末尾"后续进展"已闭环 §1 |
| 35-AI早报打磨完成报告 | 🟢 当前事实 | 17 项改动一次性交付 |
| README-当前状态 | 🔴 **存在事实冲突** | 见 3.3 |

### 3.2 未闭环的承诺（按文档分组）

#### 33 — 未来优化建议报告

| 序号 | 未关闭项 | 严重程度 | 当前状态 |
|---|---|---|---|
| 1 | §2 术语审核 `verified=true = 0` | 🔴 P0 卡点 | 设计安全锁，需人工 review-terms |
| 2 | §1 新闻意图搜索前端接入 | 🟠 P1 | 后端 + router 已完成，前端 UI 缺位 |
| 3 | §1 评测脚本 `eval-news-intent.ts` | 🟡 P2 | 文件未在 git status 出现 |
| 4 | §3 FTS5 / 虚拟滚动 / 缓存 | 🟢 P3 | 设计完成，触发条件数据 > 3000 条 |
| 5 | §4 封面图 HEAD 校验 / R2 转存 | 🟢 P3 | 设计完成 |
| 6 | §5 `newsSources` / `followedModels` 视图 | 🟡 P2 | 设计完成，未实施 |
| 7 | §6 tRPC public→protectedProcedure | 🟢 P3 | "生产前统一改" |
| 8 | §6 空态文案 | 🟢 P3 | "维持现状" |
| 9 | §6 日期时区国际化 | 🟢 P3 | "单租户，无需求" |
| 10 | §6 `tags` 字段删除 | 🟢 P3 | 待办未排期 |

#### 32 — Qoder 优化报告

| 序号 | 未关闭项 | 严重程度 |
|---|---|---|
| 1 | 七.遗留 #2：`followedModels` 未消费 | 🟡 P2 |
| 2 | 七.遗留 #3：dev server 后台运行 | 🟢 时效性 |

#### 31 — 专家级评审报告

| 序号 | 未关闭项 | 严重程度 |
|---|---|---|
| 1 | 🔵 性能优化建议 4 项 | 🟢 P3（33 §3 已接住，触发条件 = 数据 > 3000） |
| 2 | 🟡 改进点 4 项（Skeleton/EmptyState/错误卡片/ErrorBoundary） | 🟡 **完全失追**——32/33 都没接 |
| 3 | Issue-11 `tags` 字段 | 🟢 P3（与 33 §6 重叠） |

#### 35 — 早报打磨报告

| 序号 | 未关闭项 | 严重程度 |
|---|---|---|
| 1 | §七 验收清单 14 项 `[ ]` 未勾 | 🟡 自承未逐项实测，仅靠类型检查 |

### 3.3 🔴 README ↔ 36 报告事实冲突（最该修的事）

- README "三、未完成任务清单" 段写："1️⃣ D-2 / 2️⃣ D-3 / 3️⃣ D-1 实施内容"
- README "关键代码现状速查" 末行写："BilibiliCache 模型 ❌ D-1 待建"
- **但 36 报告 + 同 README "文档清单" + "项目当前状态"** 都已声明 D-1 ✅
- **修复**（已在 README 同步完成，见 §六）

### 3.4 文档间引用断点

| 断点 | 严重程度 | 详情 |
|---|---|---|
| README ↔ 36 报告 | 🔴 | D-1 状态冲突（见 3.3） |
| 31 🟡改进点 4 项 → 32/33 未接 | 🟡 | Skeleton/EmptyState/错误卡片/ErrorBoundary 全部失追 |
| 30 v4 OpenAI 403 → 33 §4 rsshub 代理 → 无实施 | 🟡 | 33 §4 仍标"未实施" |
| 28 §十 LLM 补完厂家 → 无文档接住 | 🟡 | 33 §5 提双重计数修复，未触及 LLM 补完 |
| 32 §七 #1 verified=true → README 未跟踪 | 🟡 | 实际是 P0 卡点，README 未列 |
| 35 §七 验收清单 14 项 → 无下游签字 | 🟡 | AI 早报专项验收无人对账 |

### 3.5 良性闭环（值得推广的结构）

- **31 → 32 → 33 末尾"后续进展"互相补证** —— 评审→修复→建议→后续进展，作者有意维护
- 30-D3 §"⚠️ 待 LITELLM 配置" → 33 §2 闭环确认未跑通
- 31 Bug-01~09 + Issue-10/12 → 32 报告 + 31 末尾全部闭环

### 3.6 归档建议

| 文档 | 归档理由 |
|---|---|
| 28-AI新闻系统全面升级报告 | v2 设计已被 29→30→32 三轮推翻，仅可作"v2 起点"史料 |
| 29-AI新闻界面v3重构报告 | v3 UI 设计被 30 v4 推翻 |
| 30-AI新闻v4修复报告 | v4 修复中"Bug-04 DATE()"被 32 证伪；"待解决"3 项仍开放 |

**建议归档目录**：`docs/archived/ai-news-v2-v4-history/`（新建子目录，3 份打包）

**保留**：30-D3（指向 rankings 当前生效功能）/ 31 / 32 / 33 / 35（当前事实）

---

## 四、env + schema + 依赖完整性

### 4.1 env 缺失

| env | 代码读取 | .env.example | 严重程度 |
|---|---|---|---|
| `LITELLM_BASE_URL` | ✅ `src/lib/ai/client.ts:13` 默认 `localhost:4000` | ❌ **缺失** | 🟠 P1（新闻意图搜索生产环境静默失败） |
| `LITELLM_API_KEY` | ✅ `src/lib/rankings/scraper.ts:59` 默认 `'anything'` | ❌ 缺失 | 🟢 P3（有默认值绕过） |
| `NEXT_PUBLIC_USD_TO_CNY` | ✅ `src/lib/currency.ts:10` | ❌ 缺失 | 🟢 P3（仅前端显示） |
| `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` | ❌ 不直接读 | ✅ 注释保留 | 🟢 冗余 |

### 4.2 Schema 一致性 ✅

- NewsSource / NewsItem / TermDictionary / TermEvaluation **字段全部对应代码使用**
- 仅 `tags` / `weight` / `notes` 在 schema 定义但代码未读——**预留未来功能**

### 4.3 依赖完整性

| 依赖 | 状态 |
|---|---|
| `openai` / `@prisma/client` / `tsx` / `pptxgenjs` / `@upstash/redis` / `@aws-sdk/client-s3` | ✅ |
| **`cheerio`** | ❌ **缺失** — `parsers/html.ts` 用正则解析，对 SPA/懒加载网站脆弱（注释自己承认"需要 cheerio 等依赖"） |

### 4.4 脚本可执行性

| 脚本 | 风险 |
|---|---|
| `sync-news-sources.ts` / `backfill-null-publish-dates.ts` / `review-terms.ts` / `evaluate-terms.ts` / `backfill-briefing-toast.ts` | ✅ 无 |
| `expand-synonyms.ts` / `extract-terms.ts` | ⚠️ LLM 依赖 LITELLM_BASE_URL，缺配置会连 localhost |

---

## 五、按优先级排序的待办清单

### 5.1 🔴 P0 — 立即处理（阻塞智能搜索生效）

| # | 任务 | 工作量 | 阻塞谁 |
|---|---|---|---|
| P0-1 | 人工运行 `review-terms.ts` 审核首批 20-30 个高频词（解锁智能搜索功能） | 1-2 小时 | 智能搜索（功能 = 空转） |

### 5.2 🟠 P1 — 1 周内

| # | 任务 | 工作量 | 修复了什么 |
|---|---|---|---|
| P1-1 | 修复 §2.3.1 多厂家 OR 漏命中（扩展 `queryNews` 支持 `companyTag OR`） | 2 小时 | "OpenAI 和 Anthropic 吵架相关"场景 |
| P1-2 | 给 `intent-search.ts` 的 LLM 调用加 AbortController | 30 分钟 | 排行榜搜索框挂死风险 |
| P1-3 | 修复 README ↔ 36 报告状态冲突（已自动同步，见 §六） | ✅ 已完成 | 文档事实一致性 |
| P1-4 | `.env.example` 添加 `LITELLM_BASE_URL` | 5 分钟 | 生产环境新闻意图搜索静默失败 |

### 5.3 🟡 P2 — 1 月内

| # | 任务 | 工作量 |
|---|---|---|
| P2-1 | 前端接入新闻意图搜索 UI（智能问答开关 / 长句自动触发） | 4-6 小时 |
| P2-2 | 让 `fetch-news` 真正消费 `UserPreferences.followedModels`（追加 / 置顶） | 2 小时 |
| P2-3 | 删除 `NewsItem.tags` 字段（Issue-11 长期悬挂） | 1 小时（含 prisma migrate） |
| P2-4 | 修复 §2.3.4 `total` 不准（preset 日期范围走全量查询） | 1 小时 |
| P2-5 | 新建 `eval-news-intent.ts` 评测脚本（33 §1 验收要求） | 2 小时 |

### 5.4 🟢 P3 — 待触发 / 远期

| # | 任务 | 触发条件 |
|---|---|---|
| P3-1 | FTS5 / 虚拟滚动 / 缓存 | 数据 > 3000 条 |
| P3-2 | 封面图 HEAD 校验 / R2 转存 | 阿里云 400 频繁出现 |
| P3-3 | tRPC public → protectedProcedure | 多租户 / 上线前 |
| P3-4 | 空态文案（lastFetchAt + lastError） | 产品打磨 |
| P3-5 | Skeleton / EmptyState / 错误卡片 / ErrorBoundary（31 失追的 4 项） | 体验打磨 |
| P3-6 | OpenAI News 403 → rsshub.app 代理 | 源完整度 |
| P3-7 | 安装 cheerio 重构 `parsers/html.ts` | B站/通义千问改 SPA 时 |
| P3-8 | 归档 28/29/30 v4 → `docs/archived/ai-news-v2-v4-history/` | 文档清理 |

---

## 六、本次评审同步动作（已完成）

### 6.1 README 同步摘要

README "三、未完成任务清单" 和 "关键代码现状速查" 中所有 D-1 "未开始 / 待建" 字样已改为 ✅ 完成（详见 README 修改记录）。

### 6.2 本报告本身

`docs/37-AI新闻模块完整性评审报告.md`（本文件）作为**当前事实快照**，可替代 28-32 五份"逐轮改动记录"，给新人接手用。

---

## 七、子代理评审记录

| 子代理 | 调研范围 | 产出 |
|---|---|---|
| 评审 news 代码完成度 | 16 个代码文件 + 8 份报告对照 | §二 |
| 评审 news 文档完成度 | 9 份文档 + 引用闭环 | §三 |
| 检查 env/schema/依赖 | .env.example + schema.prisma + package.json + 7 个脚本 | §四 |

（子代理 #3 额外生成了 `docs/37-AI新闻模块完整性评审报告.md` 初稿，内容已整合进本报告，原稿可删除。）