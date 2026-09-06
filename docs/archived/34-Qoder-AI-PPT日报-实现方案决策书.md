# 34 - AI 早报（PPT）· 实现方案决策书（Qoder · 最终版 v2）

**时间**：2026-08-31
**编写人**：Qoder Agent
**状态**：待用户确认后实施
**产品名**：**AI 早报**（统一命名）
**用户需求**：参考橘鸦 AI 早报，做 AIHub 自己的每日 AI 新闻 PPT 早报；每天定时自动生成；设置可控；新闻页可手动生成/查看；永久保存；可换风格与删除；下载带 AIHub 署名，作者为 AIHub。

> v2 修订记录（相对 v1）：页数改精简版 7~9 页；主题对齐应用 6 预设且更"PPT 化"；生成时间改 7:00；弹窗改为全应用级右上角状态提示（文案轮播）+ 失败自动重试；水印改轻量；logo 只在封面/末页；文件名/署名定稿；末页加产品信息。

---

## 一、已确认决策（用户拍板）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 技术形态 | **真 .pptx**（pptxgenjs）+ 应用内幻灯片预览；不用 Puppeteer 方案（Vercel 不可行） |
| 2 | 编辑范围 | 应用内**只改风格主题**；文字内容修改由用户下载后在 Office 完成 |
| 3 | 生成时间 | **每天北京时间 7:00**（cron：UTC `0 23 * * *`）；失败**自动重试** |
| 4 | 状态提示 | 全应用级**右上角小弹窗**：生成中转圈+文案轮播；失败提示去新闻页重试；完成后「点击查看」；**每天首次登录只出现一次**（详见 §九） |
| 5 | 页数规模 | **精简版 7~9 页**：封面 + 要点总览 + 4~6 条精选详情 + 数据&趋势合 1 页 + 末页 |
| 6 | 主题 | **对齐应用 6 预设**（paper / ink / mint / lavender / amber / ocean），版式为正式演示 PPT 风格（§六） |
| 7 | 存储 | 数据库存**结构化内容**（永久），点下载时即时生成 .pptx；不依赖 R2 |
| 8 | 管理入口 | AI 新闻页顶部「AI 早报」按钮 → 面板（今日早报 + 历史列表 + 换主题/下载/删除） |
| 9 | 设置 | 设置页加「早报提示」开关；关闭时仍会生成（供手动查看），只是不弹提示 |
| 10 | 下载细节 | 文件名 `AIHub-AI早报-{日期}.pptx`；作者/公司属性 = AIHub；封面署名「AIHub · AI 早报」；轻量水印；末页产品信息（§七） |
| 11 | 质量优先 | 用户明确"更看重质量不是数量"——见 §八 |

---

## 二、架构总览

```
┌────────────────────────────────────────────────────────────┐
│ 生成管线（服务器侧）                                          │
│                                                            │
│  当日新闻（北京时间，不足 3 条自动放宽到近 24h）              │
│      │                                                     │
│      ▼                                                     │
│  Step 1: gpt-4o-mini 选题（4~6 条精选 + 理由）               │
│      │                                                     │
│      ▼                                                     │
│  Step 2: gpt-4o-mini 成稿（要点文案 + 每条点评 + 趋势总结）   │
│      │                                                     │
│      ▼                                                     │
│  zod 校验 → DailyReport.content（JSON，入库永久保存）        │
│  失败 → 自动重试 1 次 → 仍失败 → 无 AI 文案降级版             │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ 消费侧                                                      │
│                                                            │
│  应用内预览：content + theme → HTML 16:9 幻灯片              │
│  下载：      content + theme → pptxgenjs → .pptx（即时生成） │
│  换主题：    改 DailyReport.theme 一个字段，立即生效          │
└────────────────────────────────────────────────────────────┘
```

**触发方式**：
1. `vercel.json` cron：UTC `0 23 * * *`（= 北京 7:00）→ `/api/cron/generate-daily-report`（CRON_SECRET + 分布式锁 + 幂等）
2. 手动：新闻页「AI 早报」面板里的「生成今日早报」按钮（当天已有则直接打开）
3. 失败自动重试：cron 路由内重试 1 次；前端状态为 failed 时，用户打开面板也可手动重试

---

## 三、数据模型

```prisma
model DailyReport {
  id        String   @id @default(uuid())
  /// 北京日期，如 "2026-08-31"（全局唯一：一天一份）
  date      String   @unique
  /// generating | ready | failed
  status    String   @default("generating")
  /// 结构化内容（JSON，见 §四）；降级/失败时可能为简化内容
  content   String?
  /// 主题：paper | ink | mint | lavender | amber | ocean
  theme     String   @default("paper")
  /// 是否降级生成（LLM 失败，无 AI 文案版）
  degraded  Boolean  @default(false)
  /// 失败原因（status=failed 时）
  error     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([date])
}
```

- **一天一份**（`date` unique）：重复触发幂等。
- 全局共享（不存租户），与新闻模块一致。**永久保存**，删除仅用户手动。

---

## 四、结构化内容格式（content JSON）

```ts
interface DailyReportContent {
  version: 1;
  date: string;                  // "2026-08-31"
  generatedAt: string;           // ISO
  cover: {
    title: string;               // "AIHub AI 早报"
    subtitle: string;            // LLM 一句话导读 ≤30 字
  };
  overview: {
    intro: string;               // 开场 ≤60 字
    points: Array<{ headline: string; oneLine: string }>;  // 3~4 条
  };
  items: Array<{                 // 4~6 条精选
    title: string;
    source: string;
    publishedAt: string;         // HH:mm
    summary: string;             // ≤90 字
    comment: string;             // LLM 一句话点评 ≤30 字
    category: string | null;
    url: string;
  }>;
  insight: {                     // 数据 & 趋势合页
    todayTotal: number;
    sourceCount: number;
    categoryDist: Array<{ name: string; count: number }>;
    companyTop: Array<{ name: string; count: number }>;   // Top 5
    weekSeries: Array<{ date: string; count: number }>;   // 近 7 天
    trendText: string;           // LLM 趋势总结 ≤120 字
  };
}
```

入库前 **zod 全量校验**，超长字段服务端截断。

---

## 五、幻灯片结构（16:9，共 7~9 页）

| 页 | 内容 | 排版要点 |
|----|------|---------|
| 1 封面 | 「AIHub · AI 早报」署名 + 大标题 + 日期 + 一句话导读 + logo | 大字居中、留白充足，正式演示封面样式 |
| 2 要点总览 | 开场 + 3~4 条要点（编号列表） | 每条一行标题 + 一行说明 |
| 3~N 详情（4~6 页） | 每页 1 条：来源徽标 + 时间 + 标题 + 摘要 + 点评 | 标题超 24 字自动缩字号；底部页码 |
| N+1 数据&趋势 | 今日数据 + 分类条形 + 厂家 Top5 + 7 天柱状 + 趋势总结 | 图形用 pptx 原生形状；左右分栏 |
| 末页 | 产品信息页（§七） | 小字、克制 |

**内页固定元素**：右下角小字页码 + 「AIHub · {date}」；**每页轻量水印**（§七）。

---

## 六、主题系统（对齐应用 6 预设，PPT 化）

色板直接取应用主题系统的强调色（`themePreset` 同名），每套定义：背景 / 主文字 / 次文字 / 强调色 / 色块底色。

| 主题 | 气质 | 适配 |
|------|------|------|
| `paper` | 米白纸感 | 默认，最通用 |
| `ink` | 深色高对比 | 暗色偏好 |
| `mint` | 薄荷清新 | 轻盈 |
| `lavender` | 薰衣草紫 | 优雅 |
| `amber` | 暖橙 | 早报感最强 |
| `ocean` | 海洋蓝 | 科技/商务 |

**"更贴合 PPT"的版式规则**（所有主题共用）：
- 封面/末页为**全幅色块**布局（大标题 + 署名条），非网页式留白
- 详情页统一**标题区 + 正文区 + 底部信息条**三段式（经典演示版式）
- 编号、分隔线、页码使用强调色点缀，正文保持高对比
- 换主题 = 改一个字段，预览与下载立即生效；预览面板提供 6 色卡切换

---

## 七、下载文件规格（定稿）

| 项 | 规格 |
|----|------|
| 文件名 | `AIHub-AI早报-2026-08-31.pptx` |
| 作者/公司属性 | `AIHub`（`pptx.author` / `pptx.company`） |
| 标题属性 | `AIHub AI 早报 2026-08-31` |
| 封面署名 | 「AIHub · AI 早报」+ 日期 |
| **水印（轻量）** | 每页右下角 9px 灰字 `AIHub · {date}`（不再用全页斜置大字），几乎不干扰正文 |
| **logo** | 只出现在**封面 + 末页**（圆角矩形 #5C6BC0 + 白色 A + AIHub 字标，pptx 原生图形绘制，免图片资源） |
| **末页产品信息** | ① 数据来源：AIHub 多源聚合（{N} 个启用源）② 生成时间：{北京时间} ③ 内容说明：由 AI 基于当日新闻自动整理，观点仅供参考 ④ AIHub 标语 |
| 生成方式 | 服务端 `pptx.write({ outputType: 'nodebuffer' })` → 下载接口返回，客户端不装 pptx |

---

## 八、质量保障措施（用户最关心）

| 措施 | 做法 |
|------|------|
| **字数硬约束** | 提示词 + 服务端截断双保险：导读 ≤30、要点 ≤30、点评 ≤30、摘要 ≤90、趋势 ≤120 字 |
| **选题质量** | Step 1 提示词标准：重大发布/融资/政策/事故优先，剔除营销软文；同事件多源只留一条 |
| **两步生成** | 先选题后成稿，输入输出都小，gpt-4o-mini 稳定性远高于一步到位 |
| **降级链** | LLM 失败 → 重试 1 次 → 仍失败出"无 AI 文案版"（原文摘要直出 + 数据页照常），标记 `degraded`，绝不给空早报 |
| **数据不足兜底** | 当日新闻 < 3 条自动放宽到近 24h；仍不足则早报注明"今日收录较少" |
| **所见即所得** | 预览与下载使用同一份 content + theme 参数（字号/行数/边距共享），不会预览好看下载乱 |
| **状态可见** | generating 显示进度；failed 显示原因 + 重试按钮 |

---

## 九、定时任务与状态弹窗（v2 重写）

### 9.1 cron
- `vercel.json`：`{ "path": "/api/cron/generate-daily-report", "schedule": "0 23 * * *" }`（UTC 23:00 = 北京 7:00）
- 路由内：CRON_SECRET 校验 → `withLock('cron:daily-report')` → 幂等检查 → 生成（失败自动重试 1 次）；`maxDuration = 300`

### 9.2 右上角状态弹窗（全应用级，AppShell 内）

**触发条件**（全部满足）：当天**首次登录/打开** AIHub（`localStorage['aihub-briefing-shown'] !== 今天`）且用户设置「早报提示」开启。满足后无论早报处于什么状态都展示对应形态，并写入标记（**每天只出现这一次**）。

| 早报状态 | 弹窗形态 |
|----------|---------|
| **生成中** | 转圈 spinner + **轮播文案**（4 秒切换，可配置）：① 「今日的 AI 早报生成中…」② 「如果无须早报，可以在设置里关闭提示」③ 「早报将在生成完成后在这里通知你」；右上角 × 可关闭 |
| **已完成** | 「今日 AI 早报已生成 ✓」**点击查看** 按钮 → 打开早报预览弹窗；× 关闭 |
| **失败** | 「数据获取异常，如需重新生成，可以到 AI 新闻页生成」；× 关闭 |

- 弹窗位置：右上角固定浮层（复用/参考现有 toast 样式，但为持久卡片，不自动消失，只能手动关闭或点击查看）
- 「点击查看」打开的预览弹窗 = 新闻页面板里同一个预览组件（16:9 幻灯片 + 6 主题切换 + 下载按钮）
- 轮播文案在组件内配置为数组，便于后续调整

### 9.3 设置项
- `UserPreferences.briefingToast Boolean @default(true)`（schema + 设置页开关）
- 关闭 = 不弹状态提示；早报照常生成，新闻页随时手动查看

---

## 十、前端入口

1. **新闻页顶部按钮区**：新增「AI 早报」按钮（与 展开筛选/数据统计/抓取新闻 并列）
2. **早报记者面板（Modal）**：
   - 顶部：今日早报状态（未生成 → 「生成今日早报」；生成中 → 进度；失败 → 原因+重试；已生成 → 预览）
   - 中部：16:9 幻灯片预览（← → 翻页）+ 6 主题色卡
   - 底部：下载 .pptx / 删除（走确认对话框）/ 关闭
   - 侧栏：历史早报列表（日期 + 状态），点击回看，可单独删除
3. **预览组件复用**：`SlidePreview` 同时服务面板与状态弹窗的「点击查看」

---

## 十一、风险与规避清单

| 风险 | 规避 |
|------|------|
| LLM 输出非法 JSON | 要求纯 JSON + 去代码块围栏修复 + zod 校验 + 降级链 |
| Vercel 函数超时 | 每次 LLM 调用限 60s；cron maxDuration=300；前端轮询状态不做长连接 |
| 当天重复生成 | `date` unique + 事务先查后建 + 分布式锁 |
| 弹窗骚扰 | 每天仅首登一次；× 关闭即写标记；设置可全局关 |
| 生成中用户反复点 | 生成按钮/状态接口幂等，pending 态禁用 |
| 中文换行溢出 | 入库截断 + `fit:'shrink'` 自适应 + 预览同规则 |
| 水印/署名错漏 | 下载前对 author/company/文件名做单元断言（构建时验证） |
| 时区错位 | 全流程北京时间（复用 `beijingDayStart`） |
| 删除后想再看 | 「生成今日早报」按钮重新出现，幂等支持重新生成 |
| 无图片资源依赖 | logo 全部 pptx 原生图形绘制 |

---

## 十二、实施文件清单与顺序

| 步 | 文件 | 内容 |
|----|------|------|
| 1 | `prisma/schema.prisma` | DailyReport + UserPreferences.briefingToast + db push |
| 2 | `src/lib/daily-report/types.ts` | content 类型 + zod schema |
| 3 | `src/lib/daily-report/collect.ts` | 当日新闻采集 + 数据快照 |
| 4 | `src/lib/daily-report/generate.ts` | 两步 LLM + 重试 + 降级 + 入库 |
| 5 | `src/lib/daily-report/themes.ts` | 6 主题色板（预览与 pptx 共用） |
| 6 | `src/lib/daily-report/build-pptx.ts` | pptxgenjs 构建（7~9 页 + 轻量水印 + 封面/末页 logo + 署名 + 产品信息） |
| 7 | `src/server/routers/daily-report.ts` | today / list / get / generate / setTheme / delete / download |
| 8 | `src/app/api/cron/generate-daily-report/route.ts` | cron 路由（7:00 + 自动重试） |
| 9 | `src/components/daily-report/SlidePreview.tsx` | HTML 16:9 幻灯片 + 6 主题 |
| 10 | `src/components/daily-report/BriefingPanel.tsx` | 早报面板（预览/主题/下载/删除/历史） |
| 11 | `src/components/daily-report/BriefingToast.tsx` | 右上角状态弹窗（轮播文案 + 点击查看） |
| 12 | 接线 | AppShell 挂 Toast、新闻页按钮、设置页开关 |
| 13 | `docs/35-Qoder-AI早报完成报告.md` | 完成总结 |

**新增依赖**：仅 `pptxgenjs`。

---

## 十三、验收标准

1. 手动生成：4~6 条精选、7~9 页齐全、文案无溢出
2. 幂等：重复点生成不产生第二份
3. 6 主题切换即时生效，下载与预览一致
4. 下载：文件名/作者/署名/轻量水印/末页产品信息全部符合 §七；Office/WPS 打开正常
5. cron：北京 7:00 自动生成，失败自动重试 1 次（本地脚本模拟验证）
6. 状态弹窗：每天首登只弹一次；生成中轮播文案；完成后点击查看打开预览；失败提示正确；设置关闭后不弹
7. 删除后可重新生成
8. 降级：模拟 LLM 失败仍产出可用早报（标记 degraded）

---

**一句话方案**：数据库存结构化早报（永久、可换 6 主题），两步 LLM 生成保质量，pptxgenjs 即时导出真 PPT（作者 AIHub、轻量水印、封面/末页原生图形 logo、末页产品信息），cron 每天 7:00 生成 + 全应用首登状态弹窗（轮播文案/点击查看/失败提示），全部绕开 Vercel 的 Puppeteer 死路。
