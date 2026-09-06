# 01 · AIHub 当前架构诊断

> **本报告定位**：逐模块评估 aihub 现状，识别**优点 / 缺口 / 隐患**。
> **配套阅读**：00-总览与路线图.md（问题分级在这里）、02-ai-news-daily-借鉴手册.md（范式来源）

---

## 1. 总体评估

AIHub 是一个**架构良好的毕业设计 MVP**——多租户、软删除、tRPC、Prisma、AI 路由都已成型，**关键设计（多租户隔离、软删除白名单、LiteLLM 路由、Cron 共享 cleanup）有清晰决策**。

但**爬虫 / 数据采集模块是明显的薄弱区**——它能跑，但**几乎是"演示级"**：

- 抓取 → 简单正则解析 → 标题相似度去重 → 串行写库
- 模型定价 / 能力分**全是静态表**（README 自承）
- 没有任何可观测性、没有健康度、没有失败降级
- 没有 B站 / 视频 / 多模态、没有 AI 驱动的关键词、没有意图搜索

**结论**：技术债集中在**爬虫模块与多模态空白**，其它模块（鉴权、OAuth、Prisma、tRPC、AI 路由、Cleanup）都健康。

---

## 2. 模块逐一评估

### 2.1 ✅ 优秀（无需改动或只需小优化）

#### 2.1.1 多租户与软删除

```prisma
// prisma/schema.prisma
model Tenant {
  id        String   @id @default(uuid())
  ...
  users     User[]
  projects  Project[]
  ...
}
```

**评估**：
- ✅ 9 个核心模型含 `deletedAt`（User/Project/ApiKey/Conversation/Score/InstalledPlugin/PluginAuditLog/UsageStat）
- ✅ 复合唯一键 `(tenantId, email)`、`(tenantId, slug)` 等，避免跨租户冲突
- ✅ Cascade 删除正确配置

**评价**：**MVP 级典范**，无需改动。

#### 2.1.2 性价比算法

```ts
// src/lib/rankings/algorithm.ts
export function calculateValueScore(input: ModelScoreInput): ScoringResult {
  // blendPrice = 0.7 * input + 0.3 * output
  // f(x) = (μ + (x-μ)²)² when x ≥ μ
  // valueScore = f(intelligence) * speed^0.8 / blendPrice
}
```

**评估**：
- ✅ 数学完备：能力变换、速度指数、价格混合权重
- ✅ 有 `isExcluded` 排除逻辑（能力 < 25、价格 ≤ 0）
- ✅ 帕累托前沿独立函数
- ✅ **单测 13/13 通过**（README 自述）

**评价**：**算法的工程实现非常扎实**。问题不在算法，而在**输入数据的真实性**（见 2.3 P0-5/6）。

#### 2.1.3 LiteLLM 客户端

```ts
// src/lib/ai/client.ts
export const litellm = new OpenAI({
  apiKey: 'anything',
  baseURL: process.env.LITELLM_BASE_URL ?? 'http://localhost:4000/v1',
});
```

**评估**：
- ✅ OpenAI 兼容协议 → LiteLLM 统一暴露
- ✅ 客户端只关心 baseURL，不关心 provider
- ✅ 批次 C25 已删除 anthropic 死代码

**评价**：**MVP 干净**，符合"LiteLLM 是统一路由"的设计意图。

#### 2.1.4 Cron 鉴权

```ts
// src/app/api/cron/fetch-news/route.ts:15-19
const authHeader = req.headers.get('authorization');
const expected = process.env.CRON_SECRET;
if (expected && authHeader !== `Bearer ${expected}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**评估**：
- ✅ Bearer Token 鉴权
- ✅ 未设 CRON_SECRET 时跳过（开发友好）
- ✅ POST 兼容（便于手动触发）

**评价**：**模式正确**。但**没有幂等、没有失败日志、没有告警**（详见 P1-7/8）。

#### 2.1.5 数据库清理

```ts
// src/lib/cleanup.ts
// src/app/api/cron/cleanup/route.ts
```

**评估**：
- ✅ 三处共用（API / script / cron route）
- ✅ ORPHAN_RETENTION_DAYS 可配置
- ✅ 设计文档 11.1 节有清晰决策

**评价**：**好实践**，值得其它模块效仿（但新闻 cron 没这么做，详见 P1-7/8）。

---

### 2.2 🟡 良好（可工作但有改进空间）

#### 2.2.1 新闻 tRPC 路由

```ts
// src/server/routers/news.ts
list: publicProcedure.input(...).query(...)
dates: publicProcedure.query(...)
stats: publicProcedure.query(...)
byModel: publicProcedure.input(...).query(...)
```

**评估**：
- ✅ 路由分层清晰（list / dates / stats / byModel）
- ✅ 输入用 zod 校验
- ✅ `confidence` 字段已建模

**不足**：
- ⚠️ `stats.today` 用 UTC 日界（`setUTCHours(0,0,0,0)`），与新闻归档的本地日界（如果按本地时区）会有 8 小时偏差
- ⚠️ `byModel` 用 `contains` 做 SQL LIKE（见 P1-5）

**建议**：对齐时区（见 04 §3 时间处理）+ 改用索引字段或外键（见 04 §6 搜索）。

#### 2.2.2 模型排行 tRPC 路由

```ts
// src/server/routers/rankings.ts
list: publicProcedure
detail: publicProcedure
refresh: protectedProcedure
priceHistory: publicProcedure
frontier: publicProcedure
providers: publicProcedure
```

**评估**：
- ✅ 帕累托前沿独立 endpoint
- ✅ 价格历史按时间倒序
- ✅ `protectedProcedure` 限制手动刷新

**不足**：
- ⚠️ `refresh` 是同步调用，**没有进度回报**（前端拿不到进度条）
- ⚠️ `priceHistory` 限定 30 天，没有"全部"
- ⚠️ 没有"按厂商聚合"的端点

**建议**：异步任务化 + 进度回报（见 08 §3）。

#### 2.2.3 UserPreferences 模型

```prisma
// prisma/schema.prisma:227-249
model UserPreferences {
  ...
  newsRefreshInterval Int  @default(3)
  newsCategories  String   @default("")
  newsSources     String   @default("")
  followedModels  String   @default("")
  priceAlertThreshold Float?
  ...
}
```

**评估**：
- ✅ 字段定义完整：刷新频率 / 关注分类 / 关注源 / 关注模型 / 价格预警阈值
- ✅ 与 Tenant/User 关系正确

**严重问题**：
- 🚨 **没有任何代码读取这些字段**——cron 是统一抓、UI 也读不到偏好

**评价**：**死字段**。这是一个明确的信号——MVP 阶段定义字段时想好了，但实现没跟上。修复优先级：**P1-3**。

---

### 2.3 🔴 薄弱（必须修复）

#### 2.3.1 新闻抓取服务（详见报告 04）

```ts
// src/lib/news/service.ts
function parseRssXml(xml: string): FetchedItem[] {
  // P0-1: pubDate 缺失时回退为 new Date() —— 用抓取时间冒充发布时间
  publishedAt: pubDate ? new Date(pubDate) : new Date(),
}
```

**问题清单**（详见 04）：
- **P0-1**：发布时间兜底错
- **P0-2**：HTML 抓取无白名单
- **P0-3**：Cron 不读用户偏好
- **P0-4**：Jaccard 阈值 0.4 太松
- **P1-1**：源没有 fragile 标记
- **P1-2**：串行分块并发
- **P1-3**：串行 upsert
- **P1-5**：`contains` LIKE 搜索

#### 2.3.2 模型爬虫（详见报告 05）

```ts
// src/lib/rankings/scraper.ts:73-181
private async parseOpenAI(model: ModelRecord): Promise<ScrapedModelData | null> {
  // P0-5: PRICING_TABLE 静态表 —— README 自承"仅占位"
  const PRICING_TABLE: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10.0 },
    ...
  };
}
```

**问题清单**（详见 05）：
- **P0-5**：5 个厂商全是静态表
- **P0-6**：AA 也是静态表
- **P1-6**：discoverFromNews 不复用标题正则
- **P1-7**：没有任何日志

#### 2.3.3 Cron 路由

```ts
// src/app/api/cron/fetch-news/route.ts
// src/app/api/cron/refresh-models/route.ts
```

**问题清单**：
- **P1-7**：结构化日志缺失
- **P1-8**：无幂等保护
- **P1-9**：schema 没健康度字段
- **P3-5**：cron 分级调度缺失

#### 2.3.4 数据库 schema（爬虫相关）

```prisma
// prisma/schema.prisma:344-359 NewsSource
model NewsSource {
  id          String   @id @default(uuid())
  name        String   @unique
  url         String
  type        String
  enabled     Boolean  @default(true)
  priority    Int      @default(1)
  lastFetchAt DateTime?
  failCount   Int      @default(0)  // ⚠️ 没用到
  notes       String?
  ...
}
```

**问题清单**：
- **P1-9**：缺 `lastOkAt / emptyStreak / lastError / lastMs`
- **P1-10**：NewsItem 缺 `tags JSON / media / publishPrecision`
- ⚠️ `failCount` 字段存在但**没任何代码递增**（与 UserPreferences 同病）

---

### 2.4 🚫 完全缺失（必须新建）

#### 2.4.1 B站 / 视频 / 多模态（详见报告 06）

aihub 当前**完全没有**任何 B 站 / 视频转录 / 多模态代码。这是与 ai-news-daily 的最大差距，也是**最大的差异化机会**。

#### 2.4.2 AI 驱动的关键词系统（详见报告 07）

当前 `CATEGORY_KEYWORDS` 是**完全人工词表**。**没有 AI 抽取新词、没有用户协同、没有意图理解**。

#### 2.4.3 跨模态融合

没有任何"同一事件 = 新闻 + 视频 + 论文 + 榜单"的拼接能力。

#### 2.4.4 事件演变跟踪

任何"事件"都是单条新闻，没有"从首发到落地"的时间轴。

---

## 3. 修复优先级总结

| 优先级 | 模块 | 详见 |
|---|---|---|
| 🔴 P0（1 周内） | news/service.ts (4 处) + rankings/scraper.ts (2 处) | 报告 04 / 05 |
| 🟠 P1（1-2 周） | 源健康度、并发、日志、幂等、schema 字段、UserPreferences 复活 | 报告 04 / 05 / 08 |
| 🟡 P2（2-4 周） | B站 + 多模态、AI 关键词、意图搜索 | 报告 06 / 07 |
| 🟢 P3（持续） | OTel、端到端测试、金标准快照 | 报告 08 |

---

## 4. 不要做的事

为避免范围蔓延：

- ❌ **不要重写 Next.js / tRPC / Prisma**——它们都好
- ❌ **不要做 OAuth 改造**——已经够用
- ❌ **不要上消息队列 / Kafka**——MVP 阶段过设计
- ❌ **不要做多区域部署**——单体 Vercel 够用
- ❌ **不要做自建 AI 路由**——LiteLLM 已经解决

聚焦在**爬虫模块 + 多模态 + 差异化能力**上。

---

**下一步**：阅读 **02-ai-news-daily-借鉴手册.md** 了解哪些范式可以直接搬过来。