# AIHub · AI 早报 → 真 PPT 优化方案（实施指南）

> 路径：`docs/AI新闻/AIppt/01-AIHub-AI早报-PPT优化方案.md`
> 对照参考：`D:\1Money\AI新闻\ai-news-daily`（企业级 AI 每日 PPT 生成器 · 已交付并验收）
> 现状：`D:\1Money\aihub\src\lib\daily-report\` + `src\components\daily-report\` + `src\server\routers\daily-report.ts`
> 目标读者：后续接手/改造 AIHub AI 早报模块的前后端工程师

---

## 0. 一句话总结

AIHub 的 AI 早报 PPT 模块**已经能生成真实 .pptx、可下载、可重新生成当天的**，三条硬要求在代码层面已满足。本次优化要做的是：**补齐企业级工程化能力**（流水线化、幂等、可观测、降级、调度），并**统一"真 PPT"的口径**——所有页面必须在 PowerPoint 中可二次编辑（不可扁平化/栅格化）。

下文按"差距 → 改造方案"组织。每条都标了**优先级（P0/P1/P2）**和**预计改动量**，可直接进迭代排期。

---

## 1. 现状盘点（AIHub 已有什么）

| 能力 | 已实现 | 代码位置 |
|---|---|---|
| 真 .pptx（pptxgenjs 原生形状 + 文本框） | ✅ | `src/lib/daily-report/build-pptx.ts` |
| 16:9 标准版式（13.33 × 7.5 in），封面 + 要点 + 逐条 + 数据 + 末页 | ✅ | `build-pptx.ts` |
| 多主题色板（paper/ink/mint/lavender/amber/ocean 共 6 套） | ✅ | `src/lib/daily-report/themes.ts` |
| 前端 16:9 所见即所得预览 | ✅ | `src/components/daily-report/SlidePreview.tsx` |
| 一键下载 .pptx（前端 `a[download]` + tRPC base64） | ✅ | `routers/daily-report.ts` 的 `download` |
| 历史列表 / 主题切换 / 删除 / 重新生成 | ✅ | `BriefingPanel.tsx` + `routers/daily-report.ts` |
| PPT 缓存（DB 存 base64 + pptxBuiltAt） | ✅ | `DailyReport.pptxBase64` 字段 |
| 异步生成（不阻塞 mutation 返回，前端轮询 `today`） | ✅ | `generateDailyReport()` fire-and-forget |
| 数据采集 + AI 改稿 | ✅ | `src/lib/daily-report/collect.ts` + `generate.ts` |
| 每日 7:00 cron 兜底 | ✅ | `src/app/api/cron/generate-daily-report/route.ts` |

### 1.1 数据模型（Prisma `DailyReport`）

```
id, date (unique), status (none|generating|ready|failed),
phase, error, content (JSON string),
degraded (bool), theme,
pptxBase64, pptxBuiltAt,
createdAt, updatedAt
```

### 1.2 关键文件清单

```
src/lib/daily-report/
├── build-pptx.ts     # pptxgenjs 构建（**核心改造目标**）
├── themes.ts         # 6 套色板
├── types.ts          # zod schema + 字数硬约束 + 截断
├── collect.ts        # 数据采集 + beijingDateString
└── generate.ts       # AI 改稿主流程
src/components/daily-report/
├── BriefingPanel.tsx # 管理面板（弹窗 + 历史侧栏）
├── BriefingToast.tsx # 顶栏提醒
└── SlidePreview.tsx  # 16:9 预览（与 build-pptx 共用色板参数）
src/server/routers/daily-report.ts
src/app/api/cron/generate-daily-report/route.ts
```

---

## 2. 参考实现盘点（`ai-news-daily`）

参考实现的核心思路：**生成端统一到 slidep，pptxgenjs 降级为快速预览**。已落地的工程化能力：

| 能力 | 实现方式 |
|---|---|
| 一键流水线 | `scripts/daily-pipeline.mjs`：抓取 → 选稿 → 生成 → 校验 → 渲染 → 归档 |
| 幂等重建 | 覆写 `state.json.lastCommit = {}` + 逐个清理孤儿页（用写代替删） |
| 渲染前校验 | `slidep-validate`：校验失败 → 不产出 PPT，改输出 Markdown 降级版 |
| 失败降级 | slidep 不可用 / 校验不过 / 渲染超时 → Markdown 日报，绝不输出半成品 |
| 选稿打分 | 多因子：时效(最大权重) + 多源印证 + 关注方向 + 中文 + 数字 + 长摘要 + HN 热度 |
| 评级 | A/B/C/D 仅按独立信源数：≥3=A、=2=B、=1=C、其余=D |
| 选稿约束 | 单一信源最多 N 条（防信息源刷屏） |
| 排版 | 1280×720、padding 20/60、A 区标题 / B 区内容 / C 区页脚、白底浅色 |
| 数据安全 | `{JSON.stringify(x)}` 注入用户数据，规避 JSX 特殊字符 |
| 测试 | `time-utils.mjs` + 26 个时间解析回归用例 |
| 调度 | 外部 Cron 调 `node scripts/daily-pipeline.mjs`，代码不变 |

---

## 3. 差距分析（按改造维度）

### 3.1 真 PPT 的"口径统一"【P0·紧急】

**现状**：AIHub 已经生成真 .pptx，但 `BriefingPanel` 文案含糊（"AI 早报"、"下载 .pptx"），没有显式声明"可在 PowerPoint 中二次编辑"；若未来有人误把 pptx 改成 canvas 截图/扁平化，会同时违背"真 PPT"和"可下载"两条要求。

**改造动作**：
- `BriefingPanel.tsx` 在"下载 .pptx"按钮旁加一行小字注脚：`原生 .pptx，可在 PowerPoint / Keynote / WPS 中二次编辑文字、图表、版式`。把这句作为产品口径写进 README 与本目录的 `README.md`。
- 在 `build-pptx.ts` 顶部加硬注释：`本文件禁止把 addText 改成 addImage / 禁止任何 canvas.toDataURL 栅格化。一旦栅格化即违背"真 PPT"承诺。`

**预计改动**：< 30 行（注释 + 一行 UI 注脚）。

---

### 3.2 流水线化（把 6 个分散动作串成一个命令）【P1】

**现状**：用户要"重新生成当天 AIppt"只能点面板里的按钮；批量回填历史、调度失败后重跑等场景无 CLI 入口。

**改造方案**：新增 `scripts/ai-ppt-pipeline.mjs`（Node 18+），把以下 6 步串起来：

1. 加载 `config/daily-ppt.json`（主题、TopN、字数阈值）
2. 调 `src/lib/daily-report/collect.ts` 的等价逻辑（或者直接 HTTP 调 `/api/cron/fetch-news` + `/api/cron/generate-daily-report`）
3. 调 `generate.ts` 的 AI 改稿（参考实现里的选稿打分可复用：时效权重最大、多源加分、关注方向加分、单源封顶）
4. 写入 `DailyReport`（status=`generating` → `ready/failed`）
5. **渲染前校验**（P0-3 对应）：zod 校验 `DailyReportContentSchema`（已存在）+ 字数硬约束（已存在）+ pptx 字段完整性
6. 调用 `buildBriefingPptx()` 渲染，**渲染成功才写 `pptxBase64`**

**对外 CLI 形态**（参考实现的 `daily-pipeline.mjs`）：

```bash
node scripts/ai-ppt-pipeline.mjs                     # 今天
node scripts/ai-ppt-pipeline.mjs --date 2026-08-28   # 指定日期
node scripts/ai-ppt-pipeline.mjs --no-fetch          # 复用已有数据
node scripts/ai-ppt-pipeline.mjs --no-render         # 只生成数据不渲染
```

**预计改动**：1 个新文件 + 1 个 config 文件，约 200 行。

---

### 3.3 幂等性【P0】

**现状**：`regenerate` mutation 用 `deleteMany + generateDailyReport()` 异步重跑。问题：

- **缓存键粗**：当前缓存只看 `date`，换主题才会清缓存。但同一日多次点"重新生成"会留下中间脏状态（status=`generating`、pptxBase64 残留旧值）。
- **失败后无清理**：`generating` 状态卡死时无法恢复（虽然有 cron 兜底，但兜底是次日 7 点）。

**改造方案**：

1. **加幂等锁**：在 `DailyReport` 表加 `generationLockId`（uuid，30 分钟 TTL），生成开始时写入，结束（成功/失败）时清掉。
2. **加 status transition 校验**：`none → generating → ready/failed`，禁止 `ready → generating`（必须先 delete 或加 `force` 标志）。
3. **加 `/api/cron/recover-stuck` 路由**：扫描 status=`generating` 且 updatedAt > 30 分钟前的记录，标 `failed` 并触发重试或人工介入。

**预计改动**：1 个 schema 字段 + 1 个路由 + `generate.ts` 入口加锁，约 80 行。

---

### 3.4 失败降级【P0】

**现状**：

- AI 改稿失败时 status=`failed`，前端弹"重新生成"按钮。✅ 已做。
- **但**：如果 AI 文案产出但 zod 校验失败（极罕见），前端只看到 `failed`，用户不知道是"内容损坏"还是"AI 不可用"，没有 fallback 内容。

**改造方案**：

借鉴参考实现的 `writeMarkdownFallback`：当 AI 改稿失败 / zod 校验失败 / 渲染失败时，**降级产物 = Markdown 日报**（标题 + 摘要 + 链接 + 信源 + 时间戳），写到 `DailyReport.content` 并标 `degraded=true`。前端展示时仍可下载，但下载的是 `.md` 而非 `.pptx`，并在面板上明确标注"降级版（AI 文案不可用，展示原文摘要）"。

> AIHub 已部分实现：`degraded` 字段已存在 + UI 已有"降级版"提示文案。只缺把"Markdown 日报"路径补齐。

**预计改动**：`generate.ts` 加 try/catch 降级分支，约 40 行。

---

### 3.5 多因子选稿打分【P1】

**现状**：`generate.ts` 当前依赖 `collect.ts` 排序（具体排序规则需要查 collect.ts），未见显式的"时效为主、多源为辅、单源封顶"打分逻辑。

**改造方案**：从参考实现移植 `scoreItem()`：

```
score = 0
+ 时效（小时衰减，最大权重）         ← 主要
+ 多源印证（n=1 得 0, n=2 得 2, n=3 得 4, 封顶 6）
+ 命中关注方向
+ 中文优先
+ 摘要含数字
+ 摘要 ≥100 字
+ HN 热度（仅 HN 源）
```

**约束**：

- 单一信源最多 N 条（默认 2）
- 同分按发布时间新者优先

**预计改动**：1 个新函数 + 配套单测，约 80 行。

---

### 3.6 选稿可观测性【P2】

**现状**：选了哪些、为什么选、有没有触发单源封顶，**全黑盒**。

**改造方案**：在 `DailyReport.content` 之外，新增 `selectionAudit` 字段（jsonb）记录：

```ts
{
  poolSize: 216,
  filteredOut: { noTitle: 3, shortSummary: 12, ... },
  top10Scored: [{ id, title, score, lv, ageH, sourceCount, ... }],
  sourceDistribution: { infoq: 4, qbit: 3, ... },
  warnings: ['infoq 单源已达上限 2，剩余 5 条被压低排名']
}
```

前端面板可在"高级"折叠里展示。

**预计改动**：1 个 schema 字段 + `generate.ts` 输出 + UI 折叠面板，约 100 行。

---

### 3.7 排版硬约束（避免溢出）【P0·已部分实现】

**现状**：`types.ts` 已有 `LIMITS`（subtitle=30, intro=60, headline=30, ...）和 `enforceLimits()` 服务端截断。✅

**但仍有 2 个问题**：

1. **中文宽度估算不准确**：`build-pptx.ts` 用 `estimateVisualWidth`（CJK=1, ASCII=0.5）算 chip 宽度，但标题区、要点行的宽度估算仍是固定 `W - MARGIN*2`，**未做字符级防溢出**。
2. **CJK 标点截断位置不友好**：`truncateOnce` 按字符数截，可能在标点前断开（"标题…"看着不雅）。

**改造方案**：

1. **新增 `visualLineHeight(s, maxWidth, fontSize)`**：根据字符串视觉宽度 + pptx 容器宽度，反算字号下限，把 `fit: 'shrink'` 的兜底改成"显式缩字号"，避免 PowerPoint 自动缩字号导致跨机器渲染不一致。
2. **优先在标点/空格处截断**：在 `truncateOnce` 里加 `preferBreakAt` 选项，截断点优先选 `、，。 ` 后 1 个字符。

**预计改动**：`types.ts` + `build-pptx.ts`，约 60 行。

---

### 3.8 测试覆盖【P1】

**现状**：参考实现有 26 个时间解析回归用例 + 87 个解析器用例。AIHub 目前**几乎没有 daily-report 相关单测**。

**改造方案**：至少补 3 类：

| 类型 | 重点 | 文件 |
|---|---|---|
| `LIMITS` / `truncateOnce` / `enforceLimits` | 边界（恰好等于上限、超长、空字符串、标点截断） | `src/lib/daily-report/__tests__/types.test.ts` |
| `scoreItem` / 选稿 | 时效衰减、单源封顶、多源加分 | `src/lib/daily-report/__tests__/score.test.ts` |
| `buildBriefingPptx` 快照 | 渲染产物 hash（防回归）+ 6 主题 × 3 items 数 = 18 个快照 | `src/lib/daily-report/__tests__/build-pptx.test.ts` |

**预计改动**：3 个测试文件，约 350 行。

---

### 3.9 调度与重试【P1】

**现状**：已有 `src/app/api/cron/generate-daily-report/route.ts`（每日 7:00 北京时间触发）。

**改造方案**：

1. **加 retry**：cron 失败 → 7:30 / 8:00 各重试 1 次（最多 2 次）。
2. **加 dashboard 入口**：在 `BriefingPanel` 顶部加"调度状态"行，显示下次 cron 时间、上次 cron 结果、是否降级。
3. **加 webhook**：当某天 `status=failed` 且 30 分钟内无重试，POST 到 webhook URL（可配置在 `.env`）。

**预计改动**：1 个新 cron route + UI 行 + 1 个 env 配置，约 60 行。

---

### 3.10 文件名 / 元数据规范【P2】

**现状**：`briefingFileName()` 已生成 `AIHub-AI早报-{date}.pptx` ✅，pptx 的 author/company/title 已设 ✅。

**改造方案**：

- 加 `revision` 字段（PPT 版本号，对应 build-pptx.ts 的 hash），便于用户反馈时定位。
- 加 `subject`（每日一句 AI 摘要 ≤ 60 字），方便 PowerPoint 文件属性面板展示。

**预计改动**：< 10 行。

---

## 4. 改造优先级与排期建议

| 优先级 | 项 | 预计工时 | 阻塞依赖 |
|---|---|---|---|
| **P0** | 3.1 真 PPT 口径统一 | 0.5 人日 | — |
| **P0** | 3.3 幂等性（锁 + recover 路由） | 1.5 人日 | Prisma migration |
| **P0** | 3.4 失败降级（Markdown fallback） | 1 人日 | — |
| **P0** | 3.7 排版硬约束（CJK 截断 + 显式字号） | 1 人日 | — |
| **P1** | 3.2 流水线化（ai-ppt-pipeline.mjs） | 2 人日 | 3.3, 3.4 |
| **P1** | 3.5 多因子选稿打分 | 1 人日 | — |
| **P1** | 3.8 测试覆盖（3 类） | 2 人日 | 3.5, 3.7 |
| **P1** | 3.9 调度与重试 | 1 人日 | 3.3 |
| **P2** | 3.6 选稿可观测性 | 1 人日 | 3.5 |
| **P2** | 3.10 文件名 / 元数据规范 | 0.2 人日 | — |

**合计**：约 11 人日（含测试）。

**建议执行顺序**：3.1 → 3.7 → 3.4 → 3.3 → 3.5 → 3.8 → 3.2 → 3.9 → 3.6 → 3.10

---

## 5. 验收标准

完成全部 P0+P1 后，应满足以下可观测的验收条件：

1. **真 PPT**：用 PowerPoint 打开任意 `AIHub-AI早报-*.pptx`，可正常修改任意文字、调整版式、复制图表 → ✅
2. **可下载**：`BriefingPanel` 点击"下载 .pptx" → 浏览器落盘 `.pptx` 文件（非 .html、PDF）→ ✅
3. **可重新生成当天**：连续点击"重新生成"两次，第二次产物与第一次**逐字节一致**（同主题同数据）→ 幂等 ✅
4. **AI 改稿失败时降级**：手动把 AI 服务的 API key 改成无效 → 面板显示"降级版" → 下载得到 `.md` 文件，内含完整新闻列表 → ✅
5. **6 主题切换**：换主题后下次下载产物 hash 变化，pptxBase64 被清空重写 → ✅
6. **历史回填**：用 `node scripts/ai-ppt-pipeline.mjs --date 2026-08-28 --no-fetch` 能补齐历史日的 PPT → ✅
7. **cron 兜底**：手动把某天 status 卡在 `generating` → 30 分钟后被 `recover-stuck` 路由标 `failed` → ✅

---

## 6. 不做的事（明确边界）

- ❌ **不做**："扁平化不可二次编辑"的 PPT（与"真 PPT"目标直接冲突）。
- ❌ **不做**：把 pptxgenjs 换成 slidep 或别的 GUI 驱动（会增加本地依赖、CI 不友好；参考实现已确认 slidep 是"可选降级"而非"主线"）。
- ❌ **不做**：把 `BriefingPanel` 从 Next.js 客户端组件改成服务端组件（要保持"打开面板即拉到当日最新状态"的实时性）。
- ❌ **不做**：在 PPT 里嵌入视频/音频（pptxgenjs 支持但会增加文件大小 5~50MB，与"企业分发"目标冲突）。

---

## 7. 参考资料

- 参考实现验收报告：`D:\1Money\AI新闻\overview.md`
- 参考实现 PPT 流水线：`D:\1Money\AI新闻\ai-news-daily\scripts\daily-pipeline.mjs`
- 参考实现页面生成：`D:\1Money\AI新闻\ai-news-daily\scripts\build-slides.mjs`
- 参考实现主题：`D:\1Money\AI新闻\ai-news-daily\scripts\lib\theme.mjs`
- 参考实现渲染封装：`D:\1Money\AI新闻\ai-news-daily\scripts\lib\slide-render.mjs`

---

**文档维护者**：AIHub 工程团队
**下次 review**：完成 P0 后（约 2 周）