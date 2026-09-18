# AI 早报功能模块

每日自动生成的 AI 新闻研究报告，16:9 幻灯片 + 主题切换 + PPTX 下载 + Markdown 降级版。

> **页数说明（2026-09-16 切流后实测）**：两套引擎页数不同；engine 的页数**随当天新闻条数变化**，不是固定页数。
>
> **engine（slide-engine，当前生产默认）** —— 09-16 实测 **13 页**（5 条新闻）
> 页序：封面 / 概览 / 方向索引 / 详情×3 / 方向索引 / 详情×1 / 传闻 / 作者 / 验证表 / 趋势 / 信源 / 免责声明
> 规则：`1 封面 + 1 概览 + Σ方向(1 索引 + min(该方向条数, 5) 详情) + min(传闻数, 2) + 作者 + 验证表 + 趋势 + 信源 + 免责声明`
> 实测：5 条新闻 → 13 页；8 条（fixture）→ 17 页；硬上限 30 页兜底。
> 设计要点是「**一条新闻一页详情**」（参考稿 `AI日报_2026-08-29` 的做法），
> 所以页数直接跟着当天的信息量走，不再与内容脱钩。
>
> **legacy（pptxgenjs 旧引擎，回滚档）** —— **15 页**固定，含独立的「置信度评级一览」页。
> 回滚：设 `BRIEFING_PPTX_ENGINE=legacy`（`BRIEFING_LEGACY_FALLBACK` 可自动回退）。
>
> 差异说明：engine 没有独立的「置信度评级一览」页，因为置信度图例与分布已经并入概览页（`overview.confidenceLegend` / `overview.distribution`），不再单独占一页。
>
> ⚠️ **页数有且只有一个真相源**：`planBriefingDeck(content).length`。
> 面板页脚、预览组件、PPTX 文件名都以它为准。任何地方再手抄一套页数公式都会立刻失准
> （历史踩过两次：预览写死 14 页、BriefingPanel 自算 `tp`）。

## 目录结构

```
src/features/daily-briefing/
├── README.md                 # 本文件
├── index.ts                  # 公开 API barrel export
├── components/
│   ├── BriefingToast.tsx     # 右上角状态弹窗（AppShell 全局挂载）
│   ├── BriefingPanel.tsx     # 完整管理面板（点击 toast 后打开）
│   └── SlidePreview.tsx      # 预览：消费 slide-engine 几何，页数随内容变化
├── lib/
│   ├── types.ts              # v4 Zod schema + 类型定义
│   ├── themes.ts             # 6 套主题调色板（兼容保留，v4 实际只用一个）
│   ├── collect.ts            # 候选新闻采集 + 北京日期工具
│   ├── generate.ts           # 两步 LLM 生成管线
│   ├── build-pptx.ts         # pptxgenjs 生成 14 页 PPT
│   └── adapters/
│       └── v1-to-v4.ts       # 历史 v1 数据兼容 adapter
└── server/
    ├── router.ts             # tRPC 路由（today / list / get / generate / regenerate / setTheme / delete / download）
    └── cron.ts               # 定时任务业务逻辑（含分布式锁 + 重试）
```

## 数据流

```
[Vercel Cron 7:00]            [用户手动触发]            [AppShell 启动]
        ↓                            ↓                          ↓
   /api/cron/generate-daily-report    │                    BriefingToast 加载
        ↓                            ↓                          ↓
   runDailyReportCron() ───────► generateDailyReport()      todayQuery refetch
        │                            │                          ↓
        └────────────────► prisma.dailyReport ◄──────────────┘
                                (status: generating → ready / failed)
                                     ↓
                              parseContent() ──► v4 直接用
                                              ──► v1 → adaptV1ToV4()
                                     ↓
                              BriefingPanel / SlidePreview 渲染
```

## 关键设计

### Schema 版本兼容
- v4 是当前生产 schema（见 `lib/types.ts` 的 `DailyReportContentSchema`）
- 历史 v1 数据（旧 DailyReport 记录）通过 `lib/adapters/v1-to-v4.ts` 自动转换
- `parseContent` 在 router 中优先尝试 v4 校验，失败时回退到 v1 adapter

### 异步生成 + 轮询
- 触发生成后立即返回 `{ status: 'generating' }`
- 前端 `BriefingToast`/`BriefingPanel` 用 `refetchInterval` 5s/4s 轮询直到 `ready` 或 `failed`
- Vercel 函数执行 60s 上限由 cron 兜底（次日 7:00 重跑未完成项）

### 防并发
- 用户层：`generate` / `regenerate` 在 router 检查 `existing.status`
- 任务层：`runDailyReportCron` 用 `withLock('cron:daily-report', 600s)` 跨实例互斥

### 主题系统
- v4 视觉固定白底单主题（参考 `D:\1Money\AI新闻\AI日报_2026-08-29`）
- 历史 6 主题（paper/ink/mint/lavender/amber/ocean）保留类型用于兼容 DB 中旧 `theme` 字段
- `setTheme` mutation 仍接受 6 主题枚举，仅用于切换主题标识重生成 PPT 缓存

## 本地调试

```bash
# 触发今日生成（需登录态）
curl -X POST http://localhost:3000/api/trpc/dailyReport.generate \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{}'

# 手动跑 cron（含鉴权）
curl http://localhost:3000/api/cron/generate-daily-report \
  -H "Authorization: Bearer $CRON_SECRET"

# 查询今日状态
curl http://localhost:3000/api/trpc/dailyReport.today \
  -H "Cookie: <session>"
```

## 已知问题

| 现象 | 原因 | 状态 |
|------|------|------|
| 历史 v1 数据报内容损坏 | schema 不兼容 | ✅ 已通过 v1-to-v4 adapter 修复 |
| BriefingPanel 在 toast 后打开 + news 页底部也有"查看早报"按钮 | 两个入口为有意设计：toast 推送 vs 主动查阅 | ✅ 确认保留 |
| 历史列表里 `todayQuery.data?.date` undefined 时 today 会闪现在历史里 | filter 边界 | ⚠️ 待优化 |
| `5 + items.length` 页数显示与预览不一致 | 历史上有三套页数公式（预览写死 14、面板自算、PPTX 实际） | ✅ 全部收敛到 `planBriefingDeck(content).length`（2026-09-16） |
| 预览显示 14 页固定版面，下载的 PPTX 却是 13 页另一套版式 | 预览是 1236 行硬编码 `switch(page){case 1..14}`，未接引擎 | ✅ 改为消费 slide-engine 几何 + `DeckPreview`（2026-09-16） |
| legacy 作者页第 3/4 张卡片出画布（>960pt） | 卡宽按 2 列算、位置按 4 张横排 | ✅ 已修为 2×2 网格（2026-09-16） |
| 封面"条精选新闻"与置信度分布合计不一致 | LLM 幻觉，无跨字段校验 | ✅ postprocess 规则 7：以 items 为准重算 + 同步封面卡（2026-09-16） |
| engine 作者页只出 2 张卡（内容有 4 位） | 页型容量 2，plan 未截断 → 静默丢数据 | ✅ plan 显式 slice(0,2) + 副标题动态数量（2026-09-16） |
| `briefing:lint` 无参数冒烟必挂 | fixture 未随 v4 schema 更新 | ✅ fixture 重写（2026-09-16） |
| CLI 双引擎渲染同名互相覆盖 | 文件名不含引擎标识 | ✅ 加 `.legacy/.engine` 后缀（2026-09-16） |

### 2026-09-16 参考稿吸收（engine 版面整改）

| 现象 | 根因 | 状态 |
|------|------|------|
| 详情页留白 > 50%，一条新闻的信息量撑不满一页 | 只渲染了 `summary` + 2 个 `heroMetrics`；`bulletPoints` / `whyMatters` / `independentSources` / `totalReposts` / `source` / `publishedAt` 全都存在却没上版 | ✅ plan 透传 + 详情页重排为「摘要 / 点评 / 要点 / 为什么重要 / 一手来源」，真实数据右列填充 **100%**（2026-09-16） |
| 详情页 8 处 L2 溢出（右列压过页脚页码） | 每块各自 `if (装得下)`，互不知道对方要多少：期望总高 431pt > 可用 418pt | ✅ 右列改为一次分配：按「要点条数 → why 行数 → 摘要行数」回缩到预算内，再垂直均摊剩余空间（2026-09-16） |
| 方向索引页只有 1 条新闻时被拉成 320pt 巨型色块 | `rowH = (circleH - 5*8) / Math.min(n, 6)`：分子按 6 行留间距、分母却是实际条数 | ✅ 行高夹在 `[50, 88]`、间距按 `n-1` 算、列表块垂直居中（2026-09-16） |
| 方向索引页类别徽标压住 oneLine | 徽标锚在行底（`ry + rowH - 22`），行高被压到 53pt 时必然相交；5 条时只差 0.4pt 靠 lint 容差侥幸通过 | ✅ 徽标改锚标题行右侧固定位（2026-09-16） |
| 详情页左列（深色块）文字几乎看不见 | 用了 `ink` / `inkSubtle` 深色字压在深色底上 | ✅ 全部改白系（`#FFFFFF` / `#FFFFFFCC` / `#FFFFFFB3`）（2026-09-16） |
| 详情页标题被腰斩到 20 字 | `clipAllStrings` 的全局 `title: 20` 是照抄 trends 的最严值，误伤 schema 允许 40 字的详情页标题 | ✅ 全局表放宽到 40，trends 自己在 entry 里显式截 20（2026-09-16） |
| 只写一句话的 `whyMatters` 整块消失 | 布局门槛 `MIN_WHY_LINES = 2`，实测会丢掉 1 行内容 | ✅ 门槛降为 1（2026-09-16） |
| 字号随手写（17pt / 15pt …），层级散掉 | 无统一字号栅格 | ✅ 收敛为 9 级栅格 + lint **L7** 守卫；实测 distinct 17 → 9、越界盒 70 → 0（2026-09-16） |

> 版面契约的自动化守卫：`pnpm test:slides:all`（10 道门）+ `pnpm audit:fonts`（字号栅格）。
> 视觉基线 `snapshots/baseline.json` 覆盖 fixture 的 17 页 × 6 套主题；改版面后需 `UPDATE_BASELINE=1` 重建并**人工确认差异是预期的**。
