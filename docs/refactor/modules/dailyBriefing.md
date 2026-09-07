# dailyBriefing.md · dailyBriefing 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.9

---

## 1. 一句话职责

AI 早报 PPT 生成（采集 → LLM 生成 → slideEngine 排版 → 持久化 + PPTX 下载）。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/features/daily-briefing/lib/collect.ts` | ~200 | 从 news / rankings 采集当日数据 |
| `src/features/daily-briefing/lib/generate.ts` | ~400 | LLM 生成大纲 + 文案 |
| `src/features/daily-briefing/lib/build-pptx.ts` | ~300 | 调 slideEngine 渲染 PPTX |
| `src/features/daily-briefing/lib/themes.ts` | ~100 | 主题切换 |
| `src/features/daily-briefing/lib/adapters/v1-to-v4.ts` | ~200 | 历史 v1→v4 适配（迁移期兼容） |
| `src/features/daily-briefing/lib/types.ts` | ~100 | 共享类型 |
| `src/features/daily-briefing/server/cron.ts` | ~150 | cron 入口 |
| `src/features/daily-briefing/server/router.ts` | ~120 | tRPC 入口 |
| `src/features/daily-briefing/components/*` | 多个 | SlidePreview / BriefingPanel / BriefingToast |

**合计**：~2000 行。

**关键约束**（来自 ARCHITECTURE.md）：

- ⚠️ `dailyBriefing` 是"编排层"，可依赖一切下层
- ⚠️ `templates/briefing/*` **必须**从 slideEngine 移到 dailyBriefing 的 domain/slides/

---

## 3. 目标包结构

```
packages/dailyBriefing/
├── src/
│   ├── domain/
│   │   ├── slides/                  # 从 slide-engine/templates/briefing 迁过来
│   │   │   ├── cover.ts
│   │   │   ├── overview.ts
│   │   │   ├── trends.ts
│   │   │   ├── authors.ts
│   │   │   ├── directionIndex.ts
│   │   │   ├── directionDetail.ts
│   │   │   ├── verification.ts
│   │   │   ├── rumor.ts
│   │   │   ├── sources.ts
│   │   │   ├── theme.ts
│   │   │   ├── plan.ts
│   │   │   └── index.ts
│   │   ├── themes.ts                # 主题切换
│   │   └── types.ts                 # BriefContent / DailyReportContent 等
│   ├── infra/
│   │   ├── dailyReportRepo.ts       # Prisma 封装
│   │   └── adapters/
│   │       └── v1ToV4.ts            # 历史适配（保留期 1 个版本后删除）
│   ├── interface/
│   │   ├── server/
│   │   │   ├── trpcRouter.ts        # router.ts 迁移
│   │   │   ├── cron.ts              # cron.ts 迁移
│   │   │   ├── collect.ts           # 数据采集
│   │   │   ├── generate.ts          # LLM 生成
│   │   │   └── buildPptx.ts         # PPTX 渲染
│   │   └── ui/                      # SlidePreview / BriefingPanel / BriefingToast
│   │       ├── BriefingPanel.tsx
│   │       ├── BriefingToast.tsx
│   │       ├── SlidePreview.tsx
│   │       └── SlidePreview/
│   │           ├── constants.ts
│   │           ├── tokens.ts
│   │           ├── shared/
│   │           │   └── SlideShell.tsx
│   │           └── index.tsx
│   └── index.ts
├── tests/
│   ├── generate.spec.ts
│   └── buildPptx.spec.ts
├── package.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                  "./src/index.ts",
    "./interface/server": "./src/interface/server/trpcRouter.ts",
    "./interface/ui":     "./src/interface/ui/index.ts",
    "./domain/slides":    "./src/domain/slides/index.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { dailyReportRouter } from './interface/server/trpcRouter';
export { generateDailyBriefing } from './interface/server/cron';  // 给 apps/cron
export { briefingSlides } from './domain/slides';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | DailyReport 模型 |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/observability` | `logger` / `withLock`（避免 cron 重入） |
| `@aihub/aiCore` | LLM 调用（生成大纲 / 文案） |
| `@aihub/news` | 采集当日新闻 |
| `@aihub/slideEngine` | PPT 排版引擎（仅 `domain` / `interface` 入口，不引内部） |
| `@aihub/rankings` | 采集当日模型排行（可选） |

**禁止依赖**：

- ❌ `chat`（chat 是用户对话，dailyBriefing 是早报生成，独立）
- ❌ `usage` / `projects` / `discovery`

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | `/briefing` 页（如果有）+ BriefingToast 全局组件 |
| `apps/cron` | `generateDailyBriefing()`（Vercel Cron） |

---

## 7. 边界规则

1. ✅ `slide-engine/templates/briefing/*` **必须迁到 dailyBriefing/domain/slides/**（ARCHITECTURE.md §3.3 强约束）
2. ✅ `cron` 用 `withLock` 避免并发（已有 `distributed-lock.ts`）
3. ✅ `BriefingToast` 是全局组件，必须在 AppShell 末尾挂载（详见 00-design.md §3.4）
4. ⚠️ `build-pptx.ts` 与 `SlidePreview.tsx` 当前 import `slide-engine` 内部文件——迁包后**必须**改为子路径入口
5. ❌ 禁止反向依赖：slideEngine 不得 import dailyBriefing 任何东西

---

## 8. 迁移步骤

```bash
# P3.3 第 3 周（最大风险：slidePreview 拆分）

mkdir -p packages/dailyBriefing/src/{domain/slides,infra/adapters,interface/server,interface/ui/SlidePreview/shared}
mkdir -p packages/dailyBriefing/tests

# 1. domain/slides 从 slide-engine 整体迁移
cp -r src/lib/slide-engine/templates/briefing/* packages/dailyBriefing/src/domain/slides/
# 内部 import 从 './plan' 改为相对路径

# 2. domain/themes / types
cp src/features/daily-briefing/lib/themes.ts packages/dailyBriefing/src/domain/themes.ts
cp src/features/daily-briefing/lib/types.ts packages/dailyBriefing/src/domain/types.ts

# 3. infra/adapters/v1-to-v4 保留（迁移期兼容）
cp src/features/daily-briefing/lib/adapters/v1-to-v4.ts packages/dailyBriefing/src/infra/adapters/v1ToV4.ts

# 4. interface/server 编排层
cp src/features/daily-briefing/lib/collect.ts packages/dailyBriefing/src/interface/server/collect.ts
cp src/features/daily-briefing/lib/generate.ts packages/dailyBriefing/src/interface/server/generate.ts
cp src/features/daily-briefing/lib/build-pptx.ts packages/dailyBriefing/src/interface/server/buildPptx.ts
cp src/features/daily-briefing/server/router.ts packages/dailyBriefing/src/interface/server/trpcRouter.ts
cp src/features/daily-briefing/server/cron.ts packages/dailyBriefing/src/interface/server/cron.ts

# 5. UI 组件（可选迁）
# cp -r src/features/daily-briefing/components/* packages/dailyBriefing/src/interface/ui/

# 6. 替换全局 import
# @/features/daily-briefing/* → @aihub/dailyBriefing/*
# @/lib/slide-engine/templates/briefing → @aihub/dailyBriefing/domain/slides

pnpm --filter @aihub/dailyBriefing typecheck
pnpm --filter @aihub/dailyBriefing test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| `templates/briefing/*` 拆分时 import 路径错乱 | 全量 grep 替换 |
| `SlidePreview.tsx` 当前 > 200 行（违反 04-no-bloat-refactor.mdc） | 拆为 SlideShell + 子组件 |
| cron 重入导致生成两份 | `withLock` + 锁 key 包含日期 |
| LLM 生成失败时 PPT 半成品 | DailyReport.status 字段做状态机（pending → success / failed） |
| `v1-to-v4.ts` 适配器死代码 | 设置 sunset date：1 个版本后删除 |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/dailyBriefing typecheck` 通过
- [ ] `pnpm --filter @aihub/dailyBriefing test` 通过
- [ ] `pnpm dev` 后 BriefingToast 全局可见
- [ ] `pnpm cron:generate-daily-report` 跑通
- [ ] `/api/trpc/dailyReport.today` 返回当日报告
- [ ] PPTX 下载文件可打开

---

## 11. 过期条件

- 切换早报模板引擎（slideEngine → Reveal.js / Marp）
- LLM 生成改用 Fine-tuned 模型
- 引入多语种早报（中英双语）
- 用户自定义早报频率
- `v1-to-v4.ts` 适配器 sunset

---

**创建时间**：2026-09-07
