# 02 · ai-news-daily 借鉴手册

> **本报告定位**：从 `d:\1Money\AI新闻\ai-news-daily` 提炼**可直接移植到 aihub** 的工程范式。
> **配套阅读**：01-AIHub-当前架构诊断.md（aihub 现状）、03-差距对照与迁移建议.md（如何落地）

---

## 1. 范式总览（13 项可移植范式）

| # | 范式 | 难度 | 优先级 | 来源文件 |
|---|---|---|---|---|
| **A** | 本地时区统一工具 | ⭐ | 🔴 P0 | `scripts/date-util.mjs` |
| **B** | 时间解析拆出 + 回归测试 | ⭐⭐ | 🔴 P0 | `scripts/time-utils.mjs` + `scripts/test-time.mjs` |
| **C** | 源健康度 + 自动告警 | ⭐⭐ | 🟠 P1 | `aggregate.mjs` §源健康度 + `data/health.json` |
| **D** | Fragile 源降级（不阻断主流程） | ⭐ | 🟠 P1 | `aggregate.mjs` §fetchOne |
| **E** | 实体指纹多源去重 + 停用词表 | ⭐⭐⭐ | 🔴 P0 | `aggregate.mjs` §4.5 |
| **F** | B站 yt-dlp 突破 412 + 文字版提取 | ⭐⭐⭐ | 🟡 P2 | `scripts/fetch_bilibili.py` |
| **G** | B站写入保护（风控不覆盖成功数据） | ⭐ | 🟡 P2 | `fetch_bilibili.py` §写入保护 |
| **H** | 配置热更新 + 白名单校验 | ⭐⭐ | 🟠 P1 | `src/index.ts` §PUT /config |
| **I** | 127.0.0.1 监听 + 路径穿越防御 + 参数校验 | ⭐⭐ | 🟠 P1 | `server.mjs` §安全 |
| **J** | 内存搜索索引 + refresh 失效 | ⭐⭐ | 🟠 P1 | `server.mjs` §searchCache |
| **K** | 编号注释体系（P0-1 / H-1 / E-4 / K-1） | ⭐ | 🟠 P1 | 散落 |
| **L** | 写入原子化（*.tmp + rename） | ⭐ | 🟢 P3 | `scripts/storage.mjs` |
| **M** | 日期文件夹归档 + 旧平铺回退 | ⭐ | 🟢 P3 | `scripts/storage.mjs` |

---

## 2. 范式逐项详解

### 2.A 本地时区统一工具

**问题背景**：GMT+8 时区下，每天 00:00-08:00 用 UTC 计算日期，会把当天数据写进前一天文件。表现为"凌晨抓完，数据看着没更新"。

**ai-news-daily 的实现**：

```js
// scripts/date-util.mjs
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function localDateTime(d = new Date()) {
  return `${localDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
```

**关键设计**：
- 一个工具文件，`aggregate.mjs` 与 `server.mjs` **共用**，避免实现漂移
- 默认参数 `d = new Date()` 让测试能注入任意时刻

**移植到 aihub**：

```ts
// src/lib/utils/date-util.ts
export function localDate(d: Date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
```

**使用点**：
- 替换 `src/server/routers/news.ts` 中 `setUTCHours(0,0,0,0)` 的逻辑
- `getAvailableDates` 改用 `localDate(publishedAt)` 而非 `toISOString().slice(0, 10)`

**收益**：
- ✅ 凌晨 1 点抓的数据正确归到当天
- ✅ 跨时区部署不再错位

**风险**：低。纯函数，无副作用。

---

### 2.B 时间解析拆出 + 回归测试

**问题背景**：4 个时间 Bug 中 3 个出在解析——跨年、跨午夜、用抓取时间冒充。**没有拆出 + 没有测试，就无法修**。

**ai-news-daily 的实现**：

```js
// scripts/time-utils.mjs
export const timeUnknown = () => ({ ts: null, precision: null })

/**
 * 未来时间回退。
 * 源站常只给「月日」或「时分」，需推断年份/日期，可能推到未来：
 *   - 跨年：2027-01-05 抓到 "12月28" → 应回退为 2026-12-28
 *   - 跨午夜：凌晨 00:30 抓到 "23:53" → 应回退为昨天 23:53
 * @param unit 'year' | 'day'
 * @param now 可选，便于测试
 */
export function rewindIfFuture(dt, unit, now = Date.now()) {
  const TOL = 3600000   // 容差 1 小时
  if (dt.getTime() - now <= TOL) return dt
  if (unit === 'year') dt.setFullYear(dt.getFullYear() - 1)
  else dt.setDate(dt.getDate() - 1)
  return dt
}

export function parseCnDateTime(s) { /* "2026年8月28日 09:21" */ }
export function parseUploadDate(s) { /* "YYYYMMDD" */ }
export function parseTodayHM(hm, now = Date.now()) { /* "HH:MM" */ }
export function parseMonthDay(s, now = Date.now()) { /* "8月28" */ }
```

**关键设计**：
- 所有函数接受可选 `now = Date.now()` 参数（**便于测试时注入**）
- 返回 `{ ts, precision }` 而非裸 Date，**显式标注时间精度**
- `precision: 'exact' | 'date' | null` 让 UI 知道"我能显示到分钟吗？"

**移植到 aihub**：

```ts
// src/lib/utils/time-utils.ts
export type TimePrecision = 'exact' | 'date' | null

export interface ParsedTime {
  ts: number | null
  precision: TimePrecision
}

export const timeUnknown = (): ParsedTime => ({ ts: null, precision: null })

export function rewindIfFuture(dt: Date, unit: 'year' | 'day', now = Date.now()): Date {
  const TOL = 3600 * 1000
  if (dt.getTime() - now <= TOL) return dt
  if (unit === 'year') dt.setFullYear(dt.getFullYear() - 1)
  else dt.setDate(dt.getDate() - 1)
  return dt
}

// 修复 P0-1：RSS pubDate 解析失败时保持 null
export function parseRssPubDate(raw: string, now = Date.now()): ParsedTime {
  if (!raw) return timeUnknown()
  const d = new Date(raw)
  if (isNaN(d.getTime())) return timeUnknown()
  // aitntnews 源站把年份写成 2001，需修正
  const nowY = new Date(now).getFullYear()
  if (d.getFullYear() < nowY - 1) d.setFullYear(nowY)
  rewindIfFuture(d, 'year', now)
  return { ts: d.getTime(), precision: 'exact' }
}
```

**修复 aihub 当前 Bug**：

```diff
// src/lib/news/service.ts
- items.push({
-   title, summary, url,
-   publishedAt: pubDate ? new Date(pubDate) : new Date(),  // ❌ P0-1
-   crawledAt: new Date(),
- });
+ const t = parseRssPubDate(pubDate)
+ items.push({
+   title, summary, url,
+   publishedAt: t.ts ? new Date(t.ts) : null,  // ✅ 解析失败显式为 null
+   publishPrecision: t.precision,
+   crawledAt: new Date(),
+ })
```

**测试套件**（必备）：

```ts
// src/lib/utils/time-utils.test.ts
import { parseRssPubDate, parseCnDateTime, rewindIfFuture } from './time-utils'

test('跨年回退', () => {
  const NOW = new Date('2026-01-05T00:00:00+08:00').getTime()
  const result = parseCnDateTime('2026年1月1日 09:21', NOW)  // 1月1日 > 1月5日？不对
  // 实际场景：2027-01-05 抓到 "12月28"
  const NOW2 = new Date('2027-01-05T10:00:00+08:00').getTime()
  const r2 = parseCnDateTime('12月28 09:21', NOW2)
  expect(r2.ts).toBe(/* 2026-12-28 的时间戳 */)
})

test('跨午夜回退', () => {
  const NOW = new Date('2026-08-30T00:30:00+08:00').getTime()
  const r = parseTodayHM('23:53', NOW)
  expect(new Date(r.ts!).getDate()).toBe(29)  // 应是昨天
})

test('P0-1：解析失败保持 null', () => {
  const r = parseRssPubDate('garbage')
  expect(r.ts).toBe(null)
  expect(r.precision).toBe(null)
})
```

**收益**：
- ✅ P0-1 一次性根治
- ✅ 跨年 / 跨午夜不会再出 Bug
- ✅ `publishPrecision` 字段让 UI 能区分"准确时间"与"仅日期"

**风险**：低。纯函数，可单测覆盖。

---

### 2.C 源健康度 + 自动告警

**问题背景**：正则爬虫（ai-bot）站点改版时条数会突降为 0，**靠人工看日报才发现已太晚**。

**ai-news-daily 的实现**：

```js
// aggregate.mjs §源健康度
const HEALTH_FAIL_THRESHOLD = 2   // 连续 N 次异常即标记 unhealthy

async function loadHealth() {
  try { return JSON.parse(await readFile(HEALTH_FILE(), 'utf8')) } catch { return { sources: {} } }
}

function applyHealth(health, id, r) {
  const prev = health.sources[id] || { okStreak: 0, emptyStreak: 0, failStreak: 0, total: 0, lastOkAt: null }
  const next = {
    ...prev,
    total: (prev.total || 0) + 1,
    lastCount: r.count,
    lastMs: r.ms,
    lastError: r.error || null,
    lastAt: Date.now(),
  }
  if (r.ok && r.count > 0) {
    next.okStreak = (prev.okStreak || 0) + 1
    next.emptyStreak = 0
    next.failStreak = 0
    next.lastOkAt = Date.now()
  } else if (r.ok && r.count === 0) {
    next.okStreak = 0
    next.emptyStreak = (prev.emptyStreak || 0) + 1
    next.failStreak = (prev.failStreak || 0) + 1   // 空结果也算"异常"
  } else {
    next.okStreak = 0
    next.emptyStreak = 0
    next.failStreak = (prev.failStreak || 0) + 1
  }
  next.unhealthy = next.failStreak >= HEALTH_FAIL_THRESHOLD
  health.sources[id] = next
  return next
}
```

**关键设计**：
- **三种状态分别计数**：`okStreak / emptyStreak / failStreak`（区别"成功抓但 0 条"与"抓失败"）
- **空结果也算异常**——正则爬虫改版的典型症状是 0 条而不是报错
- **连续 2 次即标记 unhealthy**——阈值要小，及时发现
- 持久化到 `data/health.json`，跨次抓取累积

**移植到 aihub**：

```prisma
// prisma/schema.prisma NewsSource 补字段
model NewsSource {
  ...
  lastFetchAt  DateTime?
  lastOkAt     DateTime?
  lastCount    Int       @default(0)
  emptyStreak  Int       @default(0)
  failStreak   Int       @default(0)
  failCount    Int       @default(0)  // 已有但没用上
  lastError    String?
  lastMs       Int?
  unhealthy    Boolean   @default(false)
  ...
}
```

```ts
// src/lib/news/health.ts
export interface FetchResult {
  ok: boolean
  count: number
  ms: number
  error?: string | null
}

export async function applyHealth(sourceId: string, r: FetchResult, prisma: PrismaClient) {
  const src = await prisma.newsSource.findUnique({ where: { name: sourceId } })
  if (!src) return null
  const okStreak = r.ok && r.count > 0 ? src.okStreak + 1 : 0
  const emptyStreak = r.ok && r.count === 0 ? src.emptyStreak + 1 : 0
  const failStreak = !r.ok ? src.failStreak + 1 : 0
  const unhealthy = failStreak + emptyStreak >= 2
  return prisma.newsSource.update({
    where: { id: src.id },
    data: {
      lastFetchAt: new Date(),
      lastOkAt: r.ok && r.count > 0 ? new Date() : src.lastOkAt,
      lastCount: r.count,
      lastError: r.error ?? null,
      lastMs: r.ms,
      okStreak,
      emptyStreak,
      failStreak,
      unhealthy,
    },
  })
}
```

**前端展示**（tRPC 路由扩展）：

```ts
// src/server/routers/news.ts
health: protectedProcedure.query(async () => {
  return prisma.newsSource.findMany({
    where: { enabled: true },
    orderBy: [{ unhealthy: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, type: true, enabled: true,
      lastFetchAt: true, lastOkAt: true, lastCount: true,
      emptyStreak: true, failStreak: true, lastError: true,
      unhealthy: true,
    },
  })
}),
```

**告警触发**（可在 cron route 里加）：

```ts
// 在 fetch-news cron 末尾
const unhealthy = await prisma.newsSource.findMany({ where: { unhealthy: true } })
if (unhealthy.length > 0) {
  console.warn(`[cron] ${unhealthy.length} sources unhealthy:`, unhealthy.map(s => s.name).join(', '))
  // 未来可接 Sentry / Slack webhook
}
```

**收益**：
- ✅ 正则爬虫塌陷能**自动感知**
- ✅ 数据源仪表盘直接可做
- ✅ 历史趋势可分析

**风险**：低。Schema 字段加，逻辑可后加。

---

### 2.D Fragile 源降级（不阻断主流程）

**问题背景**：正则爬虫是增强项，不该让整批失败。**单源失败不能拖垮所有源**。

**ai-news-daily 的实现**：

```js
// aggregate.mjs
const results = await Promise.all(SOURCES.filter((s) => s.enabled).map(fetchOne))
for (const r of results) {
  const h = applyHealth(health, r.src.id, { ok: !r.error, count: r.items.length, ms: r.ms, error: r.error || null })
  // fragile 源失败只降级为警告，不计入 errors
  const sink = r.src.fragile ? warnings : errors
  ...
}
```

并在 SOURCES 中标记：

```js
{ id: 'ai-bot', label: 'AI Bot 每日资讯', url: '...', kind: 'aibot', enabled: true, fragile: true },
```

**移植到 aihub**：

```ts
// src/lib/news/sources.ts
export interface NewsSourceConfig {
  name: string
  url: string
  type: 'rss' | 'api' | 'html'
  priority: number
  enabled?: boolean
  notes?: string
  fragile?: boolean  // 新增
}

export const NEWS_SOURCES: NewsSourceConfig[] = [
  ...
  { name: 'AI Bot', url: 'https://ai-bot.cn/daily-ai-news/', type: 'html', priority: 7, fragile: true, notes: 'HTML 抓取，需要针对性解析' },
  ...
]
```

```ts
// src/lib/news/service.ts:fetchAllNews
const errors = []      // 阻断级
const warnings = []    // 非阻断（fragile 源）

for (const cfg of configs) {
  try {
    const items = await fetchFromSource(cfg)
    results.push({ name: cfg.name, count: items.length, success: true })
  } catch (e) {
    if (cfg.fragile) warnings.push(`${cfg.name}: ${(e as Error).message}`)
    else errors.push(`${cfg.name}: ${(e as Error).message}`)
    results.push({ name: cfg.name, count: 0, success: false })
  }
}
```

**收益**：
- ✅ ai-bot 改版不会让整个新闻抓取失败
- ✅ 其它源照常入库

**风险**：极低。纯加法。

---

### 2.E 实体指纹多源去重 + 停用词表

**问题背景**：跨源标题措辞往往不同（"腾讯混元推出 Hy4 preview" vs "实测混元 Hy4 Preview：能杀入第一梯队吗？"），Jaccard 阈值匹配不上。**纯字符串比对会漏掉 80% 真实同事件**。

**ai-news-daily 的实现**：

```js
// aggregate.mjs §4.5
const STOP = new Set(['the','a','an','of','and','or','to','in','for','with','on','is','at','by','as',
  'ai','new','news','www','com','http','https','app','its','it','this','that',
  'more','from','will','can','now','has','have','not','but','are','was','were','been','their','there',
  'what','how','why','who','when','which','than','then','them','they','you','your','our','out','get',
  'just','like','make','made','take','over','into','about','after','before','first','last','year','years',
  'day','days','time','way','old','use','used','using','one','two','also','may','could','would',
  'says','said','want','wants','lets','let','data','model','models','openai','google'])

// 共享 token 达到该数量才认定为同一事件的多源报道
const MULTI_SOURCE_MIN_SHARED = 3

const tokenOf = (t) => new Set(
  ((`${t.title} ${t.summary || ''}`).match(/[A-Za-z][A-Za-z0-9.\-]{1,}|\d+(?:\.\d+)+/g) || [])
    .map((s) => s.toLowerCase())
    .filter((s) => s.length >= 3 && !STOP.has(s))
)

const toks = items.map(tokenOf)
for (let i = 0; i < items.length; i++) {
  const rel = new Set(items[i].sources || [items[i].source])
  for (let j = 0; j < items.length; j++) {
    if (i === j) continue
    let shared = 0
    for (const t of toks[i]) { if (toks[j].has(t)) shared++ }
    if (shared >= MULTI_SOURCE_MIN_SHARED) rel.add(items[j].source)
  }
  if (rel.size > 1) { items[i].relatedSources = [...rel]; multiCount++ }
}
```

**关键设计**：
- **Token 提取只取英文/数字**（`[A-Za-z][A-Za-z0-9.\-]{1,}|\d+(?:\.\d+)+`），**不取中文**（中文词太碎）
- **停用词表必须含英文通用词**（否则 "AI" "model" 满天飞）
- **阈值 3 是经验值**——阈值 2 虚高（47.2%）、3 合理（18.5%）、4 偏严（10.6%）
- 共享 token 的判定 = **集合交集**，复杂度 O(n²)，但 100 条新闻仅 10K 次比较，可承受

**aihub 当前 Jaccard 实现的问题**：

```ts
// src/lib/news/service.ts:163-180
function titleSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

**问题**：
- 阈值 0.4 太松——"AI 模型 OpenAI" vs "OpenAI 推出新模型" 几乎全部 token 共享
- 中英文一刀切切空格（中文没空格就完蛋）
- **没有停用词**——"AI"、"模型"、"news" 满天飞

**修复（移植实体指纹）**：

```ts
// src/lib/news/entity-fingerprint.ts
const STOP = new Set([
  // 英文通用词
  'the','a','an','of','and','or','to','in','for','with','on','is','at','by','as',
  'ai','new','news','www','com','http','https','app','its','it','this','that',
  'more','from','will','can','now','has','have','not','but','are','was','were','been','their','there',
  // 中文通用词（手动精选，量大时可改为 HMM 提取停用词）
  '的','了','在','是','和','与','或','也','都','很','就','要','会','能','不','没','有',
  '我','你','他','她','它','我们','你们','他们','这','那','这个','那个',
])

const TOKEN_RE = /[A-Za-z][A-Za-z0-9.\-]{1,}|\d+(?:\.\d+)+|[\u4e00-\u9fa5]{2,4}/g

export function tokenize(title: string, summary: string = ''): Set<string> {
  const text = `${title} ${summary}`
  const tokens = new Set<string>()
  for (const m of text.matchAll(TOKEN_RE)) {
    const t = m[0].toLowerCase()
    if (t.length >= 3 && !STOP.has(t)) tokens.add(t)
  }
  return tokens
}

export const MULTI_SOURCE_MIN_SHARED = 3

export interface MultiSourceRelation {
  sources: string[]
  itemId: string
}

export function findMultiSourceRelations<T extends { id: string; source: string; title: string; summary?: string | null }>(
  items: T[]
): MultiSourceRelation[] {
  const toks = items.map(it => tokenize(it.title, it.summary ?? ''))
  const relations: MultiSourceRelation[] = []
  for (let i = 0; i < items.length; i++) {
    const rel = new Set<string>([items[i].source])
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue
      let shared = 0
      for (const t of toks[i]) { if (toks[j].has(t)) shared++ }
      if (shared >= MULTI_SOURCE_MIN_SHARED) rel.add(items[j].source)
    }
    if (rel.size > 1) relations.push({ sources: [...rel], itemId: items[i].id })
  }
  return relations
}
```

**应用**：

```ts
// src/lib/news/service.ts
// 替换 dedupeAndCross
function dedupeAndCrossV2(items: FetchedItem[]): FetchedItem[] {
  // 第一步：粗粒度合并（同标题完全相同或 Jaccard ≥ 0.7）
  const groups: FetchedItem[][] = []
  for (const item of items) {
    let matched = false
    for (const group of groups) {
      if (item.title === group[0].title || titleSimilarity(item.title, group[0].title) >= 0.7) {
        group.push(item)
        matched = true
        break
      }
    }
    if (!matched) groups.push([item])
  }

  // 第二步：实体指纹发现跨组多源关联
  const flatItems = groups.flat().map(g => ({
    id: g.url,  // 暂用 url 作 id
    source: g.sourceName,
    title: g.title,
    summary: g.summary ?? null,
    groupIdx: groups.findIndex(grp => grp.includes(g)),
    groupItemIdx: groups.find(grp => grp.includes(g))!.indexOf(g),
    ref: g,
  }))
  const relations = findMultiSourceRelations(flatItems)

  // 把关联结果写回 crossSources
  const byId = new Map<string, FetchedItem>()
  for (const grp of groups) byId.set(grp[0].url, grp[0])
  for (const rel of relations) {
    const item = byId.get(rel.itemId)
    if (item) {
      item.crossSources = [...new Set([...(item.crossSources ?? []), ...rel.sources.filter(s => s !== item.sourceName)])]
    }
  }

  return groups.map(g => {
    g.sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0))
    const primary = g[0]
    const otherSources = g.slice(1).map(x => x.sourceName).filter(Boolean)
    return {
      ...primary,
      crossSources: [...new Set([...(primary.crossSources ?? []), ...otherSources])],
    }
  })
}
```

**收益**：
- ✅ 跨源同事件识别率大幅提升
- ✅ 停用词表抑制英文通用词误判
- ✅ 中文用 2-4 字窗口提取（"混元"、"Hy4"、"preview" 都能识别）

**风险**：中。需配测试套件保证阈值合理。

---

### 2.F B站 yt-dlp 突破 412 + 文字版提取

**问题背景**：B站 space API 在自动化环境下常返回 412/352 风控。**直接 fetch 拿不到**。

**ai-news-daily 的破解方案**（Python + yt-dlp）：

```python
# scripts/fetch_bilibili.py §list_latest_videos
def list_latest_videos(uid, limit=3):
    url = f"https://space.bilibili.com/{uid}/video"
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--flat-playlist",      # ← 关键：只拉列表不取详情
        "--playlist-end", str(limit),
        "--extractor-retries", "3",
        "--sleep-requests", "2",  # ← 防限流
        "--print", "%(id)s\t%(title)s\t%(upload_date)s",
        url,
    ]
    time.sleep(3)  # 前置冷却
    out = []
    for attempt in range(3):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            ...
```

**关键设计**：
- **子进程跑 yt-dlp**，不是 Python API（API 会多发请求，更易风控）
- **`--flat-playlist` 只拉列表**，省请求
- **`--sleep-requests 2`**——每个请求间隔 2 秒
- **3 次重试 + 8s/16s 退避**——给风控冷却时间

**文字版提取**（不依赖 ASR）：

```python
# scripts/fetch_bilibili.py §parse_news_from_article
def parse_news_from_article(text, limit=40):
    """适配橘鸦式早报结构：## 概览 -> - 标题 `#N` / ## 标题 `#N` / > 摘要"""
    items = []
    if not text:
        return items
    seen = set()
    for m in re.finditer(r"^##\s+(.+?)\s*`?#\d+`?\s*$", text, re.M):
        title = m.group(1).strip().strip("`").strip()
        if not title or title in seen or title in ("概览",):
            continue
        seen.add(title)
        rest = text[m.end(): m.end() + 1200]
        sm = re.search(r"^\s*>\s*(.+?)$", rest, re.M)
        summary = ""
        if sm:
            summary = sm.group(1).strip()
            summary = re.sub(r"[`*]", "", summary)
        items.append({
            "title": title,
            "summary": summary[:300],
            "source": "bilibili",
            "category": classify(title, summary),
        })
        if len(items) >= limit:
            break
    # 兜底：若没匹配到 ## 结构，用概览里的 "- 标题 `#N`" 行
    if not items:
        for m in re.finditer(r"^-\s+(.+?)\s*`?#\d+`?\s*$", text, re.M):
            ...
    return items
```

**移植到 aihub**：

```ts
// src/lib/bilibili/scraper.ts
// 用 child_process spawn 跑 yt-dlp（不需要 Python 环境）
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface BiliVideo {
  bvid: string
  title: string
  uploadDate: string  // YYYYMMDD
  description: string
  url: string
}

export async function listLatestVideos(uid: string, limit = 3): Promise<BiliVideo[]> {
  const url = `https://space.bilibili.com/${uid}/video`
  return new Promise((resolve) => {
    const cmd = [
      'yt-dlp',
      '--flat-playlist',
      '--playlist-end', String(limit),
      '--extractor-retries', '3',
      '--sleep-requests', '2',
      '--print', '%(id)s\t%(title)s\t%(upload_date)s',
      url,
    ]
    const p = spawn(cmd[0], cmd.slice(1))
    let out = ''
    let err = ''
    p.stdout.on('data', d => out += d.toString())
    p.stderr.on('data', d => err += d.toString())
    p.on('close', (code) => {
      if (code !== 0) { resolve([]); return }
      const videos: BiliVideo[] = []
      for (const line of out.trim().split('\n')) {
        const [bvid, title, uploadDate] = line.split('\t')
        if (bvid?.startsWith('BV')) {
          videos.push({
            bvid, title: title ?? '', uploadDate: uploadDate ?? '',
            description: '',  // 需另起请求
            url: `https://www.bilibili.com/video/${bvid}`,
          })
        }
      }
      resolve(videos)
    })
  })
}

export async function enrichDescription(v: BiliVideo): Promise<BiliVideo> {
  if (v.description) return v
  return new Promise((resolve) => {
    const p = spawn('yt-dlp', [
      '--skip-download',
      '--print', '%(description)s',
      v.url,
    ])
    let out = ''
    p.stdout.on('data', d => out += d.toString())
    p.on('close', () => resolve({ ...v, description: out.trim() }))
  })
}

export function findArticleLink(desc: string): string | null {
  const patterns = [
    /https?:\/\/mp\.weixin\.qq\.com\/\S+/,
    /https?:\/\S*?(?:zhihu|jianshu|juejin|163|sina|sohu)\.com\/\S+/,
    /(?:文字版|图文版|详情)[^\n]{0,20}?(https?:\/\/\S+)/,
  ]
  for (const re of patterns) {
    const m = desc.match(re)
    if (m) return (m[1] ?? m[0]).rstrip?.('。，,)）】') ?? m[0]
  }
  return null
}

export async function fetchArticleText(link: string): Promise<string> {
  const res = await fetch(link, {
    headers: { 'User-Agent': 'Mozilla/5.0 ... Chrome/120' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return ''
  const ctype = res.headers.get('content-type') ?? ''
  if (!ctype.includes('text/html')) return ''
  const html = await res.text()
  // 去 script/style
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ')
                   .replace(/<style[\s\S]*?<\/style>/g, ' ')
                   .replace(/<[^>]+>/g, '\n')
                   .replace(/&nbsp;?/g, ' ')
  return text.replace(/\n{2,}/g, '\n').trim()
}

export function parseNewsFromArticle(text: string, limit = 40): Array<{ title: string; summary: string; source: string; category: string }> {
  const items = []
  const seen = new Set<string>()
  const titleRe = /^##\s+(.+?)\s*`?#\d+`?\s*$/gm
  let m
  while ((m = titleRe.exec(text)) !== null && items.length < limit) {
    const title = m[1].trim().replace(/`/g, '').trim()
    if (!title || seen.has(title) || title === '概览') continue
    seen.add(title)
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 1200)
    const summaryMatch = rest.match(/^\s*>\s*(.+?)$/m)
    const summary = summaryMatch ? summaryMatch[1].trim().replace(/[`*]/g, '') : ''
    items.push({ title, summary: summary.slice(0, 300), source: 'bilibili', category: classify(title, summary) })
  }
  return items
}
```

**前置条件**：
- 部署环境装 `yt-dlp`（`pip install yt-dlp` 或独立 exe）
- aihub 改成 Python 调用或 yt-dlp 的 Node.js 绑定

**收益**：
- ✅ B站风控可绕过
- ✅ 文字版提取**无需 ASR**，直接拿作者准备好的 Markdown
- ✅ 完整接入"AI 新闻每日视频"能力

**风险**：高。yt-dlp 安装、B站风控突变、UP 主视频结构变化都可能影响。

**详见报告 06**。

---

### 2.G B站写入保护（风控不覆盖成功数据）

**问题背景**：B站风控频繁。**一次抓取失败绝不能覆盖上次成功的数据**。

**ai-news-daily 的实现**：

```python
# scripts/fetch_bilibili.py §写入保护
old = _load_old()
old_total = 0
if old:
    old_total = sum(len(v.get("news") or []) for u in old.get("ups", []) for v in u.get("videos", []))

if old and old_total > 0:
    # 逐 UP 主合并：只有本次真正抓到内容的才覆盖，否则沿用历史
    old_by_uid = {u["uid"]: u for u in old.get("ups", [])}
    restored = []
    for u in result["ups"]:
        nu = sum(len(v["news"]) for v in u["videos"])
        if nu > 0:
            old_by_uid[u["uid"]] = u
        elif u["uid"] in old_by_uid:
            restored.append(u["name"])
    merged = dict(old)
    merged["ups"] = list(old_by_uid.values())
    if restored:
        merged["note"] = f"{', '.join(restored)} 沿用历史缓存（本次受 B 站风控影响）"
    total = sum(len(v.get("news") or []) for u in merged["ups"] for v in u.get("videos", []))
    out_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    tag = "⚠ 部分沿用历史" if restored else "✓"
    print(f"\n{tag} 共 {total} 条新闻（本次新增 {new_total}）-> {out_path}")
    return 0

out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
```

**关键设计**：
- **逐 UP 主合并**，不是全量替换
- 本次抓到 ≥ 1 条 → 覆盖；本次 0 条 → 沿用旧数据
- 写入时加 `note` 字段，说明哪些 UP 主是历史缓存

**移植到 aihub**：

```ts
// src/lib/bilibili/storage.ts
export async function upsertBilibiliWithProtection(prisma: PrismaClient, newData: BiliData): Promise<BiliData> {
  const old = await prisma.bilibiliCache.findFirst({ orderBy: { fetchedAt: 'desc' } })
  if (!old) {
    return prisma.bilibiliCache.create({ data: { ...newData, fetchedAt: new Date() } })
  }
  // 逐 UP 主合并
  const oldUpsByUid = new Map(old.ups.map(u => [u.uid, u]))
  const restored: string[] = []
  for (const u of newData.ups) {
    const newCount = u.videos.reduce((sum, v) => sum + (v.news?.length ?? 0), 0)
    if (newCount > 0) {
      oldUpsByUid.set(u.uid, u)
    } else if (oldUpsByUid.has(u.uid)) {
      restored.push(u.name)
    }
  }
  const merged: BiliData = {
    fetchedAt: new Date(),
    ups: [...oldUpsByUid.values()],
    note: restored.length ? `${restored.join(', ')} 沿用历史缓存（本次受 B 站风控影响）` : undefined,
  }
  return prisma.bilibiliCache.create({ data: merged })
}
```

**收益**：
- ✅ 风控时数据不丢失
- ✅ 用户看到的是"最新成功数据"

**风险**：低。纯加法。

---

### 2.H 配置热更新 + 白名单校验

**问题背景**：开放 `/config` PUT 接口时，**输入零校验**会被攻击者写入 `refreshIntervalMs=0` 致 CPU 空转。

**ai-news-daily 的实现**：

```ts
// src/index.ts §PUT /config
router.put('/ai-news-daily/config', async (request) => {
  const body = await request.json?.() ?? {}
  // H-6：白名单字段 + 数值范围校验
  const allowed = ['refreshIntervalMs', 'bilibiliUps', 'sources', 'policyKeywords', 'categoryKeywords', 'useMockOnFailure']
  const patch = {}
  for (const k of allowed) if (k in body) patch[k] = body[k]
  if ('refreshIntervalMs' in patch) {
    const v = Number(patch.refreshIntervalMs)
    if (!Number.isFinite(v) || v < 60_000) {
      return { ok: false, error: 'refreshIntervalMs 需为 ≥60000 的数字（毫秒）' }
    }
    patch.refreshIntervalMs = v
  }
  if ('sources' in patch && (!Array.isArray(patch.sources) || patch.sources.length === 0)) {
    return { ok: false, error: 'sources 不能为空数组' }
  }
  if ('bilibiliUps' in patch && !Array.isArray(patch.bilibiliUps)) {
    return { ok: false, error: 'bilibiliUps 需为数组' }
  }
  if ('categoryKeywords' in patch && (typeof patch.categoryKeywords !== 'object' || patch.categoryKeywords === null)) {
    return { ok: false, error: 'categoryKeywords 需为对象' }
  }
  if ('useMockOnFailure' in patch) patch.useMockOnFailure = Boolean(patch.useMockOnFailure)
  store.config = { ...store.config, ...patch }
  startSchedule()   // 间隔可能变了，重启定时器
  return { ok: true, config: store.config }
})
```

**关键设计**：
- **白名单字段**（不接收任意 key）
- **类型校验**（Array.isArray / typeof / Number.isFinite）
- **数值范围校验**（refreshIntervalMs ≥ 60000）
- **修改后重启定时器**

**移植到 aihub**：

```ts
// src/server/routers/news.ts
updateSource: protectedProcedure
  .input(z.object({
    id: z.string(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(100).optional(),
    fragile: z.boolean().optional(),
  }))
  .mutation(async ({ input }) => {
    const { id, ...patch } = input
    return prismaBase.newsSource.update({
      where: { id },
      data: patch,
    })
  }),
```

**收益**：
- ✅ 防非法配置注入
- ✅ 用户能热更新关注源/分类

**风险**：低。已有 zod 用法。

---

### 2.I 127.0.0.1 监听 + 路径穿越防御 + 参数校验

**问题背景**：
- `listen(PORT)` 默认绑 `0.0.0.0`，暴露到局域网
- 静态文件路径未防 `../` 目录穿越
- 参数未校验会让 `setInterval(fn, NaN)` 按 1ms 空转

**ai-news-daily 的实现**：

```js
// server.mjs §安全
// H-1：只监听回环地址
server.listen(PORT, '127.0.0.1', async () => { ... })

// 防目录穿越
let rel = path === '/' ? '/advanced.html' : path
rel = normalize(rel).replace(/^(\.\.[/\\])+/, '')
let file = join(ROOT, rel)
if (!existsSync(file) || !(await stat(file)).isFile()) {
  return send(res, 404, 'Not Found: ' + rel, ...)
}

// 参数校验
const PORT = Number(getArg('--port', 8787))
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[参数错误] --port 需为 1–65535 的整数，当前：${getArg('--port', 8787)}`)
  process.exit(1)
}
const INTERVAL_MIN = Number(getArg('--interval', 60))
if (!Number.isFinite(INTERVAL_MIN) || INTERVAL_MIN < 1) {
  console.error(`[参数错误] --interval 需为 ≥1 的数字（分钟），当前：${getArg('--interval', 8787)}`)
  process.exit(1)
}

// H-3：不把子进程日志回传客户端（含内部路径等细节，配合 CORS 会泄漏）
if (!ok) console.error('[refresh] ' + state.lastError)
resolve({ ok, ms: Date.now() - t0 })  // 不回传 err/out 内容
```

**移植到 aihub 的建议**：

- ✅ Vercel Cron 已有 bearer token 鉴权（Cron 路由已实现）
- ✅ tRPC 输入有 zod 校验（已实现）
- ⚠️ **手动 /api/refresh（POST）要限制权限**（目前 `protectedProcedure` 已限制，但要注意 CSRF）
- ⚠️ **文件路径若由用户提供，需防穿越**（目前没有文件路径 endpoint，OK）

**收益**：细节级安全提升。

---

### 2.J 内存搜索索引 + refresh 失效

**问题背景**：`/api/search` 每次请求都遍历读盘所有日期文件（N+1 IO），历史增长后会劣化。

**ai-news-daily 的实现**：

```js
// server.mjs §搜索内存索引
const searchCache = { rows: null }

async function getSearchIndex() {
  if (searchCache.rows) return searchCache.rows
  const dates = await listDates(DATA_DIR)
  const rows = []
  for (const d of dates) {
    const day = await readDay(DATA_DIR, d)
    if (!day) continue
    for (const it of day.items || []) rows.push({ date: d, item: it })
  }
  searchCache.rows = rows
  return rows
}

// refresh 后失效
if (path === '/api/refresh') {
  ...
  searchCache.rows = null   // 数据已更新，搜索索引失效
  ...
}
```

**关键设计**：
- **首次搜索时构建**，缓存到内存
- **refresh 后失效**，下次重建
- **无锁、无 TTL**（单机服务够用）

**移植到 aihub**：

aihub 的搜索是数据库（`queryNews` with `contains` LIKE），不需要这种技巧——但有更好的方案：**全文索引**或 **PostgreSQL tsvector**。详见报告 07。

---

### 2.K 编号注释体系

**问题背景**：写代码时容易忘记"当时为什么这么做"。**审计级**注释能让 6 个月后的自己快速理解。

**ai-news-daily 的做法**：

```js
// P0-1 口径统一：解析失败保持 null，绝不回退成抓取时间 Date.now()
// H-6：白名单字段 + 数值范围校验。此前 body 零校验直接合并——
// E-4：spawn 失败时 Node 会先发 error 再发 close，finish 被调两次 → 计数错乱
// K-3：uid 统一用字符串，与 fetch_bilibili.py / 数据文件一致
```

**编号约定**：
- **P0-X**：数据正确性 Bug 修复
- **H-X**：安全/健壮性加固
- **E-X**：错误处理修正
- **K-X**：一致性 / 跨文件对齐
- **H-数字递增**代表重要性（可以每加一个修一个就 +1）

**移植到 aihub**：

在每个 PR 里沿用这套编号。报告 00 里我用 **P0-1 / P0-2 ...** 就是参考了这套体系。

**收益**：代码自带"决策考古"。

---

### 2.L 写入原子化（*.tmp + rename）

**ai-news-daily 的实现**：

```js
// storage.mjs §writeJsonAtomic
export async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}
```

**为什么**：
- 直接 `writeFile` 时若进程被 kill，会留下半截 JSON，下次读全坏
- 写 `.tmp` + rename（POSIX rename 是原子的）保证要么旧文件、要么新文件

**移植到 aihub**：

aihub 用 Prisma 写库，原子性由数据库事务保证，**不需要这套技巧**。但**批量 upsert 时**（如一次性更新 100 条），可考虑：

```ts
// 用事务包裹
await prisma.$transaction([
  ...items.map(item => prisma.newsItem.upsert({ ... }))
])
```

---

### 2.M 日期文件夹归档 + 旧平铺回退

**ai-news-daily 的实现**：

```js
// storage.mjs
export const dayFile = (dataDir, date) => join(dataDir, date, 'news.json')
export const legacyFile = (dataDir, date) => join(dataDir, `${date}.json`)

export async function readDay(dataDir, date) {
  if (!isDateStr(date)) return null
  return (await readJson(dayFile(dataDir, date))) ?? (await readJson(legacyFile(dataDir, date)))
}
```

**为什么**：
- 旧数据是 `data/2026-08-28.json`（平铺）
- 新数据是 `data/2026-08-28/news.json`（日期文件夹，可放更多文件如 `meta.json`、`raw.json`）
- **读时回退**：优先新格式，找不到再读旧格式

**移植到 aihub**：

aihub 用数据库，不需要。但**可以借鉴"读时回退"思想**——例如：读取某个 source 的旧配置时，回退到 `NEWS_SOURCES` 默认值。

---

## 3. 优先级与工作量

| 范式 | 优先级 | 工作量 | 风险 |
|---|---|---|---|
| A 本地时区 | P0 | 1 天 | 低 |
| B 时间解析 + 测试 | P0 | 2-3 天 | 低 |
| C 源健康度 | P1 | 2 天 | 低 |
| D Fragile 源 | P1 | 0.5 天 | 低 |
| E 实体指纹 | P0 | 3-4 天 | 中 |
| F B站 yt-dlp | P2 | 4-5 天 | 高 |
| G 写入保护 | P2 | 0.5 天 | 低 |
| H 配置热更新 | P1 | 1 天 | 低 |
| I 安全 | P1 | 0.5 天 | 低 |
| J 内存索引 | — | 已由 DB 替代 | — |
| K 注释体系 | P1 | 持续 | 低 |
| L 原子写 | — | 已由事务替代 | — |
| M 日期归档 | — | 已由 DB 替代 | — |

**总工作量估算**：4 周（1 人）。

---

**下一步**：阅读 **03-差距对照与迁移建议.md**，看每个范式如何落地到 aihub 的具体文件。