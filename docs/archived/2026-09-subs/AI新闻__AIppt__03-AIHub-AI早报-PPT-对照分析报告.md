# AIHub AI 早报 PPT 模块 · 对照分析报告

> 分析日期：2026-09-01
> 参考文档：
> - `docs/AI新闻/AIppt/01-AIHub-AI早报-PPT优化方案.md`
> - `docs/AI新闻/AIppt/02-AIHub-AI早报-PPT设计规格书.md`
>
> 项目实际代码：
> - `src/lib/daily-report/build-pptx.ts`
> - `src/lib/daily-report/themes.ts`
> - `src/lib/daily-report/types.ts`
> - `src/lib/daily-report/generate.ts`
> - `src/components/daily-report/BriefingPanel.tsx`
> - `src/components/daily-report/SlidePreview.tsx`

---

## 一、页面结构对照

| 页码 | 设计规格书定义 | 项目实际实现 | 差距 |
|---|---|---|---|
| P1 | 封面（主标题 + 日期 + LLM生成副标题 + 底部署名） | ✅ 已实现 | 无 |
| P2 | 今日要点（编号卡片 + 开场白 intro） | ✅ 已实现 | 无 |
| **P3** | **信源透明度页（置信度 A/B/C/D + 10个信源贡献柱图）** | ❌ **缺失** — 实际 P3 是第1条新闻详情 | 缺少独立"信源透明度页" |
| P4~P(N+2) | 新闻详情页（来源chip + 分类 + 时间 + 标题 + 摘要 + 点评 + **置信度标签**） | ✅ 已实现基础结构 | **缺少置信度 A/B/C/D 标签** |
| P(N+3) | 数据趋势页（今日统计 + 分类分布 + 厂家Top5 + 7天柱图 + 趋势总结） | ✅ 已实现（`addInsight`） | 无 |
| P(N+4) | 尾页（Logo + 透明声明 4 条 + 产品署名） | ✅ 已实现 | 无 |

**结论**：P3"信源透明度页"完全缺失，P4 新闻详情页缺少置信度标签。

---

## 二、6 大记忆亮点对照

| 亮点 | 设计规格书要求 | 项目实际 | 差距 |
|---|---|---|---|
| **① 信源透明度页** | P3 独立页面，展示置信度 A/B/C/D 说明 + 各信源当日贡献条数柱图 | ❌ 缺失 | **严重** — 这是 AIHub 独家差异化功能 |
| **② 置信度标签** | 每条新闻详情页右上角 chip（A 确证 / B 高 / C 中 / D 存疑） | ❌ 缺失（`types.ts` 数据模型无此字段） | **严重** — 需要扩展数据模型 |
| **③ 每日动态副标题** | 封面底部 LLM 生成一句话概括（≤30字） | ✅ 已实现（`content.cover.subtitle`） | 无 |
| **④ 数据趋势页** | 厂家Top5 + 近7天柱图 + 分类分布 + 趋势总结 | ✅ 已实现（`addInsight`） | 无 |
| **⑤ AI 点评区** | 每条新闻底部浅色框，一句话说明"为什么这条重要" | ✅ 已实现（`item.comment`） | 无 |
| **⑥ 一手来源链接** | 每条新闻附 URL（防幻觉、防侵权） | ⚠️ 数据模型有 `url`，但 PPT 未展示 | **中等** — `build-pptx.ts` 未渲染链接 |

---

## 三、工程能力对照

| 能力 | 优化方案要求 | 项目实际 | 差距 |
|---|---|---|---|
| 真 PPT 原生格式 | 可在 PowerPoint 中二次编辑 | ✅ 已实现 | 无 |
| **幂等性** | 锁机制（`generationLockId`）+ status transition 校验 + recover 路由 | ⚠️ 有基础幂等（`upsert`），但无锁机制 | **中等** — 多次点"重新生成"可能留脏状态 |
| **失败降级** | LLM 失败 → Markdown 日报（`.md` 下载） | ⚠️ 有 `buildFallbackContent()`，但下载仍是 `.pptx`（comment 为空） | **中等** — 降级时 UI 无感知（下载 .pptx 但内容是原文摘要） |
| **流水线化** | CLI 脚本 `ai-ppt-pipeline.mjs` | ❌ 缺失 | 需要 |
| **多因子选稿打分** | 时效为主 + 多源印证 + 单源封顶 + 中文优先 + 数字加分 | ⚠️ 有选题逻辑，但未显式打分 | 需要强化 |
| **选稿可观测性** | `selectionAudit` 字段记录选稿过程 | ❌ 缺失 | 需要 |
| **测试覆盖** | `types.test.ts` + `score.test.ts` + `build-pptx.test.ts` | ❌ 缺失 | 需要 |
| **调度重试** | cron 失败 → 7:30/8:00 各重试 1 次 + webhook | ⚠️ 有每日 cron，无重试机制 | 需要 |
| **文件名/元数据规范** | `revision` 字段 + `subject`（每日AI摘要 ≤60字） | ⚠️ 有基础元数据 | 需要补全 |

---

## 四、核心代码差距详情

### 4.1 `build-pptx.ts` 缺少的功能

| 缺失项 | 规格书定义 | 说明 |
|---|---|---|
| P3 信源透明度页 | 独立 `addSourceTransparency()` 函数 | **必须新增** |
| 新闻详情页置信度标签 | 右上角 A/B/C/D chip（不同颜色） | **必须新增**（依赖数据模型扩展） |
| 一手来源链接 | 点评框下方展示 URL（≤58字符） | `addItemSlide()` 中可选新增 |
| CJK 标点截断 | `truncateOnce` 优先在标点/空格处截断 | `types.ts` 可优化 |

### 4.2 `types.ts` 数据模型缺口

| 缺失字段 | 类型 | 用途 |
|---|---|---|
| `items[].confidenceLevel` | `'A' \| 'B' \| 'C' \| 'D'` | 置信度标签（信源数量判定） |
| `items[].relatedSources` | `string[]` | 印证信源列表（用于 A/B/C/D 计算） |
| `bySource` | `Record<string, number>` | 各信源贡献条数（用于 P3 柱图） |
| `audit` | `SelectionAudit` | 选稿可观测性（可选 P2） |

### 4.3 `generate.ts` 缺失功能

| 缺失项 | 说明 |
|---|---|
| 置信度计算 | 入选新闻需根据 `relatedSources.length` 计算 A/B/C/D |
| 多因子打分 | 从参考实现移植 `scoreItem()` |
| 选稿审计 | 输出 `selectionAudit` 到 `DailyReport` 表 |

---

## 五、配色与设计细节对照

| 项目 | 设计规格书 | 项目实际 | 差距 |
|---|---|---|---|
| 6 套主题 | ✅ 完全一致 | ✅ `themes.ts` 已实现 | 无 |
| 字体 | Microsoft YaHei（各字号已定义） | ✅ 已实现 | 无 |
| 页边距 | 0.7 in | ✅ `MARGIN = 0.7` | 无 |
| 来源 chip 宽度计算 | `estimateVisualWidth(source) * 0.19 + 0.4` | ✅ 已实现（`build-pptx.ts` 有注释说明 CJK 修复） | 无 |
| 分割线粗细 | 0.012 in | ✅ 已实现 | 无 |
| 水印透明度 | 55% | ✅ `transparency: 55` | 无 |

---

## 六、结论与改造范围

### 6.1 已完成（与设计规格书对齐）

- ✅ 真 .pptx 原生格式（pptxgenjs 原生形状）
- ✅ 6 套主题色板（预览与 PPT 共用）
- ✅ 16:9 预览（`SlidePreview.tsx` 所见即所得）
- ✅ 页面结构（封面/要点/详情/趋势/尾页）
- ✅ 字数硬约束（`LIMITS` + `enforceLimits`）
- ✅ 失败降级基础能力（`buildFallbackContent`）
- ✅ CJK 宽度估算

### 6.2 必须新增（P0）

| 序号 | 改造项 | 涉及文件 | 优先级 |
|---|---|---|---|
| 1 | **新增 P3 信源透明度页** | `build-pptx.ts`（+160行）、`SlidePreview.tsx`（+120行） | P0 |
| 2 | **新增置信度标签** | `types.ts`（数据模型）、`generate.ts`（计算逻辑）、`build-pptx.ts`（渲染）、`SlidePreview.tsx`（预览） | P0 |
| 3 | **降级版 UI 感知** | `BriefingPanel.tsx`（标注"降级版"）、`generate.ts`（Markdown下载路径） | P0 |

### 6.3 建议新增（P1）

| 序号 | 改造项 | 涉及文件 | 优先级 |
|---|---|---|---|
| 4 | 一手来源链接（PPT 展示 URL） | `build-pptx.ts` | P1 |
| 5 | 幂等锁机制（`generationLockId`） | Prisma schema、`generate.ts` | P1 |
| 6 | 多因子选稿打分 | `generate.ts` | P1 |
| 7 | 调度重试（cron 失败后 2 次重试） | cron route | P1 |
| 8 | 测试覆盖（3 类测试文件） | `__tests__/` | P1 |

### 6.4 可选新增（P2）

| 序号 | 改造项 | 涉及文件 | 优先级 |
|---|---|---|---|
| 9 | CLI 流水线脚本 `ai-ppt-pipeline.mjs` | `scripts/` | P2 |
| 10 | 选稿可观测性（`selectionAudit`） | `generate.ts` + Prisma | P2 |
| 11 | CJK 标点截断优化 | `types.ts` | P2 |

---

## 七、改造风险提示

1. **P3 信源透明度页会改变总页数**：当前 `totalPages = 4 + items.length`，新增 P3 后应改为 `5 + items.length`，需同步修改 `SlidePreview.tsx` 的页码计算。
2. **置信度标签需要历史数据兼容**：已在库中的 `DailyReport` 记录无 `confidenceLevel` 字段，需设计向后兼容方案（如默认 B 级）。
3. **降级下载格式**：当前下载统一是 `.pptx`，降级时内容质量差。应考虑降级时输出 `.md` 文件，或在 PPT 中明确标注。

---

**文档状态**：待确认
**下一步**：根据本报告，与用户确认改造优先级和实施方案
