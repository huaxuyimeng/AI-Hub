# 32 - AI 新闻模块优化完成报告（Qoder）

**时间**：2026-08-31
**执行人**：Qoder Agent
**范围**：AI 新闻功能块（前端页面 + tRPC 路由 + 抓取服务 + 数据库）
**依据**：用户四项决策 —— ① 修复已确认 bug ② UX 优化 ③ 性能与扩展性 ④ 接通 Phase 2 搜索能力（仅 D-2）

---

## 一、总览

| 类别 | 数量 |
|------|------|
| 🔴 严重功能缺陷修复 | 5（含 2 个实施中新发现） |
| 🟡 中等问题修复 | 7 |
| 🔵 性能/健壮性改进 | 4 |
| 数据库回填 | 61 条脏数据 |
| 新增脚本 | 1（回填脚本） |
| 修改文件 | 7 |

验收：`npx tsc --noEmit` 0 错误；浏览器实测通过（见 §五）。

---

## 二、🔴 严重问题修复

### Fix-01 厂家提及榜 SQL 缺 GROUP BY（图表数据是坏的）

**位置**：`src/server/routers/news.ts` analytics
**问题**：`SELECT companyTags, COUNT(*)` 无 `GROUP BY`，SQLite 只返回任意一行 + 总数，「AI 厂家提及榜」实际只有 1~2 条虚高数据。文档 31 以为已修，实际代码更糟。
**修复**：补 `GROUP BY companyTags`；聚合时用 `Set` 对行内标签去重（消除文档 31 指出的双重计数）；`tagDistribution` 改名 `categoryDistribution`（前端 Modal 同步）。
**实测**：榜单现返回 15 条正确排名（Anthropic 32 / OpenAI 27 / Google 19 …）。

### Fix-02 publishedAt 回退 1970 而非 null

**位置**：`src/lib/news/service.ts` saveItems
**问题**：解析器输出 `null`（所有 HTML 源无发布时间），但入库写成 `new Date(0)`，与 schema 可空设计和前端「未知」徽标矛盾。7 个 HTML 源（Cursor/Qoder/Anthropic 等）新闻全部显示 1970-01-01 并沉底。
**修复**：入库直接存 `item.publishedAt`（可为 null）；排序改为 `publishedAt desc, nulls last`。
**数据回填**：`scripts/backfill-null-publish-dates.ts` 已执行，61 条 1970 记录置 null，库中不再残留（支持 `--dry-run`）。

### Fix-03 「加载更多」实际是翻页替换

**位置**：`src/app/(app)/news/page.tsx`
**问题**：文档 31 改 skip 分页后，前端未累积数据——点按钮会用下一页 50 条替换当前列表，与 v4 累积设计矛盾；「剩余 N 条」也算错。
**修复**：前端维护累积列表（第 0 页替换、后续页去重追加）；服务端新增 `filteredTotal`（同条件 count），「剩余」= `filteredTotal - 已加载`；`placeholderData` 期间不同步列表，避免筛选切换瞬间回跳。
**实测**：50 → 100 条追加，首条不变，按钮文案「270 条剩余」→「220 条剩余」准确。

### Fix-04（新发现）SQLite 无法解析 Prisma 存的日期，DATE() 恒为 null

**位置**：`getAvailableDates()` + analytics 趋势图
**问题**：Prisma 6 的 SQLite 驱动把 DateTime 存为**毫秒时间戳字符串**（如 `'1788139623000'`），`DATE(publishedAt)` 解析失败返回 null——日期下拉框一直是空的，趋势图分组失效。文档 31 的"SQL DATE() 修复"在真实存储格式下从未生效。
**修复**：`DATE(publishedAt / 1000, 'unixepoch', '+8 hours')`。
**实测**：日期下拉出现 2026-08-31、08-30…；趋势图 17 个数据点正常。

### Fix-05（新发现）自动抓取被筛选误触发

**位置**：`src/app/(app)/news/page.tsx`
**问题**：「数据库为空时自动抓取」的判断只看 `items < 5`——筛选到冷门厂家标签（结果不足 5 条）就会误触全量抓取，抓取完成回调又把用户视图重置。浏览器实测复现。
**修复**：有任意活跃筛选时绝不自动抓取。

---

## 三、🟡 中等问题修复

| # | 问题 | 修复 |
|---|------|------|
| Fix-06 | 搜索高亮正则未转义，输入 `(` `[` 等字符抛异常 | `escapeRegExp()`（NewsCard） |
| Fix-07 | 清除搜索只清查询态不清输入框，状态不一致 | `clearSearch()` 同步清两者 |
| Fix-08 | companyTag 用 `contains` 过滤，「AI」误命中所有含 AI 标签 | 逗号分隔串四段精确匹配（整串/开头/结尾/中间）；实测 `Amazo`→0、`Amazon`→9 |
| Fix-09 | Modal 条形图把 `<title>` 嵌在 `<div>` 里（无效 HTML，tooltip 不显示） | 改为 `title` 属性 |
| Fix-10 | 筛选区分类计数按当前页 50 条估算，误导 | 服务端 `stats.categoryCounts` 全量 groupBy 真实计数 |
| Fix-11 | D-2 智能搜索写完但从未接入（`searchNews` 无人调用） | `news.list` 搜索先经 `expandQuery` 同义词展开；返回 `search` 元数据，前端显示「智能搜索 · 已展开 N 个关键词」 |
| Fix-12 | cron 传的「关注分类」被静默忽略（参数声明未实现） | `fetchAllNews` 分类后过滤入库，丢弃数记入 warnings；手动抓取保持全量 |

---

## 四、🔵 时区与性能

### 北京时间（UTC+8）
「今日新增」、日期筛选、日期列表、趋势图全部改为北京时间日界（`beijingDayStart()` 辅助函数 + SQL `'+8 hours'`）。凌晨 0-8 点的新闻不再归入前一天。用量统计模块未动。

### 性能
- **索引**：`NewsItem` 新增 `@@index([deletedAt, publishedAt(sort: Desc)])`、`@@index([category, publishedAt(sort: Desc)])`（已 `prisma db push`）。
- **expandQuery N+1 修复**：原实现对每个命中术语逐条 `findUnique` + 全表拉两次；现一次拉全部 `verified` 术语后内存匹配。
- **渲染**：`NewsCard` 包 `memo`；厂家标签回调用 `useCallback` 保持引用稳定；封面图 `decoding="async"`。
- **按需拉取**：保持服务端分页，只有点「加载更多」才请求更多数据。

---

## 五、验收证据

| 项 | 方式 | 结果 |
|----|------|------|
| 类型检查 | `npx tsc --noEmit` | ✅ 0 错误 |
| Schema 同步 | `npx prisma db push` | ✅ |
| 数据回填 | 回填脚本 + 计数核对 | ✅ 61 条置 null，残留 0 |
| stats/dates/analytics/list | HTTP 直调 tRPC（含 superjson 包裹） | ✅ 全部符合预期 |
| 厂家精确匹配 | `Amazo`→0 / `Amazon`→9 | ✅ |
| 分页 | skip=50 返回第 2 页 + hasMore | ✅ |
| 浏览器：列表/计数 | 打开 /news | ✅ 「已加载 50 · 匹配 320」 |
| 浏览器：累积追加 | 点加载更多 | ✅ 100 条，首条不变 |
| 浏览器：特殊字符搜索 | 输入 `Claude(` | ✅ 不崩溃 |
| 浏览器：搜索高亮 | 输入 `Claude` | ✅ 26 条、17 处 mark |
| 浏览器：分类计数 | 展开筛选 | ✅ 全部 320 / AI Coding 67 / AI IDE 29 / 具身智能 14 / AI政策 4 |
| 浏览器：日期下拉 | 展开筛选 | ✅ 有北京时间日期选项 |
| 浏览器：统计 Modal | 点数据统计 | ✅ 4 图全渲染，无「暂无数据」 |

---

## 六、文件变更清单

| 文件 | 变更 |
|------|------|
| `src/lib/news/service.ts` | publishedAt 存 null；分类过滤；北京时间；where 抽取；countNews；getAvailableDates 修复 |
| `src/server/routers/news.ts` | analytics 彻底修复；D-2 展开接入；filteredTotal；stats 分类计数；北京时间 |
| `src/lib/news/search.ts` | expandQuery 重写（修 N+1，导出） |
| `src/app/(app)/news/page.tsx` | v5 重构：累积追加、真实计数、智能搜索提示、自动抓取防误触 |
| `src/components/news/NewsCard.tsx` | 正则转义、memo、decoding=async |
| `src/components/news/NewsAnalyticsModal.tsx` | categoryDistribution 同步、title 属性修复 |
| `prisma/schema.prisma` | +2 组合索引 |
| `scripts/backfill-null-publish-dates.ts` | 新增（已执行） |

---

## 七、遗留与交接

1. **TermDictionary 当前 0 个 `verified` 术语**——智能搜索接线正常，但会一直走字面回退，直到运行 `npx tsx scripts/review-terms.ts` 审核术语。建议尽快审核一批（见文档 33 §2）。
2. `followedModels` 参数仍未被消费（本次未决策，见文档 33 §6）。
3. 开发服务器仍在后台运行（`npx next dev`，http://localhost:3000），测试账号 `admin@aihub.local` / `admin123`。
4. 未来优化方向全部整理在 `33-Qoder-未来优化建议报告.md`。
