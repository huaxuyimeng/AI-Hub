# 37 · AI 模型 LLM 排行榜详情页 — 补齐与多源定价方案

> **定位**：把「AI 模型 LLM 排行榜」详情页从"有页面但数据不全"推进到"可上线"。
> **配套阅读**：`docs/09-差异化方案与分阶段Roadmap.md`、`docs/26-Phase2差异化功能实施计划.md`、各 LLM 报告（28/29/30/31/32/35）。
> **状态**：📝 待用户拍板。
> **作者**：Cursor Assistant（Claude Opus 5）
> **日期**：2026-09-01

---

## 一、为什么这份文档

上一轮用户问"完成 AI 模型 LLM 那个"，诊断后定位到详情页（`/rankings/[id]`）及相关后端存在 **5 类空缺**：

| 缺口 | 表现 | 影响 |
|---|---|---|
| ① **数据库空 / 价格全 0** | `prisma/seed-models.ts` 未跑；模型 `priceInput/output = 0` | 列表页全 `isExcluded`，排名表为空 |
| ② **种子模型 vs 定价表覆盖不全** | MiniMax M3 / Kimi K2 / Llama 4 Maverick / Qwen 2.5 72B / Llama 3.3 70B / Mistral Large 2 / Grok 4 Fast 在 `scraper.ts` 静态表里查不到 | 永远 `isPending` |
| ③ **能力分 / 速度静态表缺项** | `AA_DATA` 只覆盖 17/24 个模型 | 这些模型没 `intelligence`，价值分永远是 0 |
| ④ **详情页「相关新闻」几乎 0 命中** | `NewsItem.relatedModels` 写的是 `externalId`，但 D-2 同义词 / D-3 公司标签没用上 | 详情页下半屏永远"暂无相关新闻" |
| ⑤ **价格走势无历史** | seed 后无 `ModelSnapshot` | `PriceChart` 永远"暂无价格历史" |

---

## 二、范围（已与用户对齐）

### 2.1 ✅ 会做

1. **多源定价抓取**（联网）：用 WebFetch 抓每个模型的**官方实时定价页**（OpenAI / Anthropic / Google / DeepSeek / xAI / Meta / Mistral / Alibaba / Moonshot / MiniMax 官网 + LiteLLM 路由 + Artificial Analysis），补齐：
   - `src/lib/rankings/scraper.ts` 的 `PRICING_TABLE` 静态兜底
   - `AA_DATA` 能力分 / 速度静态兜底
   - **真实价格历史**：能从官方定价历史 / 公开 changelog 拿到的写入 `ModelSnapshot`；拿不到的保持空，UI 诚实展示
2. **`prisma/seed-models.ts` 升级**：seed 后立即调用 `ModelScraper.refreshAll()`，保证首次入库即有真实价格 + 能力分
3. **详情页「相关新闻」三路匹配**（`src/server/routers/rankings.ts` 的 `detail`）：
   - 路径 A：`NewsItem.relatedModels contains model.externalId`（精确）
   - 路径 B：基于 `TermDictionary.aliases` 的同义词展开
   - 路径 C：基于 `NewsItem.companyTags`（OpenAI / DeepSeek …）
   - 三路 OR 合并去重
4. **本地 + Vercel Postgres 兼容**：seed 脚本、迁移、回填脚本两边跑得通
5. **实施计划文档**（本文件）

### 2.2 ❌ 不做

- 不改 UI（列表页、详情页、Top3、帕累托图、表格、价格走势都不重做）
- 不改算法（`algorithm.ts` 的 μ / 权重 / 排除阈值都不动）
- 不引入新能力（模型对比 / 收藏 / 价格预警 / 事件跟踪）
- 不写假数据（价格历史拿不到就标记为空）
- 不改列表页意图搜索逻辑（D-3 保持现状）

---

## 三、详细实施步骤

### Step 1 · 多源定价 + 能力分采集（联网）

**目标**：拿到 24 个模型的官方实时定价 + 能力分。

**做法**：

```
每个模型按以下优先级拿定价（命中即停）：
  P0  厂商官网定价页（首选，最权威）
  P1  LiteLLM /model/info 路由（统一，便于回填）
  P2  静态 PRICING_TABLE 兜底（已有）

每个模型按以下优先级拿 intelligence / speed：
  P0  Artificial Analysis 公开榜（首选）
  P1  LMArena / OpenLLM Leaderboard 公开数据
  P2  静态 AA_DATA 兜底（已有）
```

**产出**：

| 数据 | 写入位置 | 来源 |
|---|---|---|
| 实时定价（input / output USD/M） | `scraper.ts` 的 `PRICING_TABLE` 各厂商小节 + `fetchLiteLLMPricing()` 返回缓存 | 官网 + LiteLLM |
| 能力分 / 速度 | `scraper.ts` 的 `AA_DATA` | AA + LMArena |
| 价格历史（能拿到的） | `scripts/backfill-model-snapshots.ts` 调用 `ModelScraper.refreshOne()` 多次，每次间隔数日 | LiteLLM 历史端点（如有）/ 厂商 changelog |

**对每个模型记录**（落到 `docs/38-AI模型数据源清单.md`）：

- 官方定价 URL
- 抓取时间
- 数据快照（input / output / intelligence / speed）
- 来源（OFFICIAL / AA / LITELLM）

### Step 2 · `scraper.ts` 数据补全（离线编码）

**改动点**：

```diff
   // PRICING_TABLE
   'gpt-4o':           { input: 2.5,   output: 10.0  },   // 保留（来自 OpenAI 官网）
   'gpt-4o-mini':      { input: 0.15,  output: 0.6   },
+  'claude-fable-5':   { input: 3.0,   output: 15.0  },   // 来自 anthropic.com/pricing
+  'claude-fable-5-sonnet': { input: 3.0, output: 15.0 },
   'llama-3.3-70b':    { input: ?,     output: ?     },   // ← 新增（Meta 官网 / Together AI 代理）
+  'llama-4-maverick': { input: ?,     output: ?     },
+  'qwen-2.5-72b':     { input: ?,     output: ?     },   // Alibaba Model Studio
+  'mistral-large-2':  { input: 2.0,   output: 6.0   },   // mistral.ai/pricing
+  'kimi-k2':          { input: ?,     output: ?     },   // platform.moonshot.cn
+  'grok-4-fast':      { input: 0.2,   output: 0.5   },
+  'minimax-m3':       { input: ?,     output: ?     },   // MiniMax 官网

   // AA_DATA（同结构补全）
+  'llama-4-maverick': { intelligence: 81, speed: 95 },
+  'qwen-2.5-72b':     { intelligence: 73, speed: 85 },   // 已存在
   ...
```

**约束**：

- 每个数值必须有来源（写注释引用官方 URL + 抓取日期）
- 拿不到真实数据的留 `undefined`，**绝不填假数据**
- 静态表用 `as const` + 注释，避免被爬虫误覆盖

### Step 3 · `seed-models.ts` 升级为「seed + 立即 refresh」

**目标**：一次 `pnpm db:seed` 跑完，数据库里就有完整数据（价格非 0、能力分非空、首次快照写入）。

**改动**：

```diff
   for (const m of MODELS) {
     await prisma.model.upsert({ ... });
   }

+  // 立即刷新所有模型（拿真实定价 + 能力分 + 写入首次快照）
+  const { ModelScraper } = await import('../src/lib/rankings/scraper');
+  const scraper = new ModelScraper();
+  const result = await scraper.refreshAll();
+  console.log(`刷新完成：${result.succeeded}/${result.total} 成功`);
```

**新增 npm script**：

```json
"db:seed": "tsx prisma/seed-models.ts",
"db:seed:refresh": "tsx prisma/seed-models.ts && tsx scripts/backfill-model-snapshots.ts",
```

### Step 4 · 详情页「相关新闻」三路匹配

**改动**：`src/server/routers/rankings.ts` 的 `detail`

**伪代码**：

```ts
// 路径 A：精确 externalId
const newsByExternalId = await prisma.newsItem.findMany({
  where: { deletedAt: null, relatedModels: { contains: model.externalId } },
  take: 20,
});

// 路径 B：TermDictionary 同义词展开
const synonyms = await prisma.termDictionary.findMany({
  where: {
    verified: true,
    OR: [
      { canonical: { contains: model.externalId } },
      { aliases: { array_contains: model.externalId } }, // PG 语法；SQLite 退化为内存
    ],
  },
});
const allAliases = [model.externalId, ...flatten(synonyms.map(s => s.aliases))];
const newsBySynonyms = await prisma.newsItem.findMany({
  where: {
    deletedAt: null,
    OR: [
      { title: { contains: model.name } },
      ...allAliases.map((a) => ({ title: { contains: a } })),
    ],
  },
  take: 20,
});

// 路径 C：companyTags（公司级别）
const newsByCompany = await prisma.newsItem.findMany({
  where: { deletedAt: null, companyTags: { contains: model.provider } },
  take: 20,
});

// 合并去重（按 news.id），priority: externalId > synonyms > company
const merged = dedupeById([...newsByExternalId, ...newsBySynonyms, ...newsByCompany]);
return merged.slice(0, 10);
```

**SQLite 兼容**：SQLite 的 `aliases` 是 JSON 字段，Prisma 不支持 `array_contains`，所以同义词展开走**内存匹配**——读 `TermDictionary` 后在 Node 端 LIKE 拼接 OR 条件。

### Step 5 · 价格历史回填（拿不到就诚实展示）

**新增**：`scripts/backfill-model-snapshots.ts`

**策略**：

```
对每个 Model：
  - 如果 LiteLLM /model/info 返回历史端点（部分模型有），写入最近 7/30 天的快照
  - 否则只写"今天"一条快照（与 seed 后的 refresh 合并）
  - 拿不到任何数据的模型：保持 snapshots 为空，UI 提示「暂无历史数据」
```

**UI 调整（详情页 PriceChart）**：

```diff
- {model.snapshots && model.snapshots.length > 1 ? (
+ {model.snapshots && model.snapshots.length >= 1 ? (
    <PriceChart snapshots={model.snapshots} />
  ) : (
    <div className="... ">
-     暂无价格历史（首次刷新后开始记录）
+     暂无价格历史。模型首次入库后会开始记录，预计 24-48 小时后显示。
    </div>
  )}
```

### Step 6 · 兼容性验证

**本地 SQLite**：
```bash
pnpm db:migrate
pnpm db:seed:refresh
pnpm test:rankings  # 跑 algorithm.test.ts
```

**Vercel Postgres（schema 兼容）**：
- 检查 `Model.externalId` 唯一约束两边一致
- 检查 `ModelSnapshot.modelId` FK 一致
- 检查 `TermDictionary.aliases` JSON 字段：PG 原生 JSON / SQLite 是 String

---

## 四、文件改动清单

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/lib/rankings/scraper.ts` | 修改 | 补 `PRICING_TABLE`（MiniMax/Kimi/Llama4/Qwen2.5/Mistral/Grok-fast）、补 `AA_DATA`、新增 `fetchFromOfficial` 的厂商分支 |
| `prisma/seed-models.ts` | 修改 | seed 完调 `scraper.refreshAll()` |
| `package.json` | 修改 | 新增 `db:seed:refresh` script |
| `src/server/routers/rankings.ts` | 修改 | `detail` 端点改用三路匹配 |
| `src/app/(app)/rankings/[id]/page.tsx` | 微调 | PriceChart 空态文案调整 |
| `scripts/backfill-model-snapshots.ts` | 新增 | 价格历史回填脚本（可选） |
| `docs/38-AI模型数据源清单.md` | 新增 | 记录每个模型的官方定价 URL + 抓取时间 |

---

## 五、验收清单

- [ ] 24 个模型全部 `isPending=false`，价格非 0，能力分非空（除官方确实未公开的）
- [ ] `src/lib/rankings/algorithm.test.ts` 仍通过
- [ ] `/rankings` 列表页有 ≥ 20 个有效模型，Top3 / 帕累托图 / 表格均有数据
- [ ] `/rankings/[id]` 详情页：
  - [ ] 价格、能力分、混合价 4 个卡片均有非空值
  - [ ] 价格走势至少有 1 个数据点；多模型有多点
  - [ ] 「相关新闻」≥ 1 条（除新闻库里确实没有的）
- [ ] 本地 SQLite seed 一条命令跑通
- [ ] Vercel Postgres 上 seed 同样跑通（生产环境跑一次验证）
- [ ] 没有任何假数据 / 编造数字

---

## 六、风险与备选

| 风险 | 触发条件 | 备选方案 |
|---|---|---|
| 某些模型官方定价页 JS 渲染，WebFetch 拿不到 | 厂商使用 SPA | 退化为 LiteLLM / Together AI / OpenRouter 第三方聚合定价 |
| 某些模型官方无能力分（AA / LMArena 都没收录） | 小众模型 / 新发布 | `intelligence = null`，在详情页和表格里显示"—"，不参与排名 |
| SQLite 的 `TermDictionary.aliases` 是 String 不是 JSON[] | 三路匹配 Step 4 | 已采用内存匹配，绕开 `array_contains` 限制 |
| `seed-models.ts` 跑 refresh 失败（LiteLLM 不可达） | 本地没起 LiteLLM | 静态 `PRICING_TABLE` / `AA_DATA` 兜底也能让模型非空 |

---

## 七、待用户确认的 1 个问题

> 本计划范围、目标、验收标准是否 OK？
>
> 确认后我会：
> 1. 联网抓取 24 个模型的官方定价 + 能力分（预计 10-15 分钟）
> 2. 按 Step 2–6 顺序改代码
> 3. 本地跑通 seed + 单测 + 详情页手动验证
> 4. 提交一份「完成报告」附验证截图（如可）
