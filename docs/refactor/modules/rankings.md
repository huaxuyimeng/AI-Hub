# rankings.md · rankings 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.7

---

## 1. 一句话职责

AI 模型性价比排行 + 爬虫 + 快照持久化 + 帕累托计算——`/rankings` 页面和 `refresh-models` cron。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/rankings/algorithm.ts` | ~250 | 性价比公式 + 帕累托计算 |
| `src/lib/rankings/algorithm.test.ts` | ~200 | 单测 |
| `src/lib/rankings/scraper.ts` | ~300 | 模型数据爬取（LITELLM / 公开 API） |
| `src/server/routers/rankings.ts` | ~150 | tRPC 入口 |
| `src/components/rankings/*` | 5 个文件 | UI 组件（Top3Podium / RankingsTable / PriceChart / ParetoChart / StatsOverview） |

**合计**：~1100 行。

---

## 3. 目标包结构

```
packages/rankings/
├── src/
│   ├── domain/
│   │   ├── pareto.ts                # 帕累托前沿计算
│   │   ├── scoreFormula.ts          # 性价比公式
│   │   └── types.ts                 # ModelRanking 类型
│   ├── infra/
│   │   ├── modelRankingRepo.ts      # Prisma 封装
│   │   └── scraper.ts               # 爬虫（含 fetchWithRetry 注入）
│   ├── interface/
│   │   ├── server/
│   │   │   ├── trpcRouter.ts        # routers/rankings.ts 迁移
│   │   │   └── refreshJob.ts        # cron job（apps/cron 调用）
│   │   └── ui/                      # (可选) UI 组件
│   │       ├── RankingsTable.tsx
│   │       ├── Top3Podium.tsx
│   │       ├── PriceChart.tsx
│   │       ├── ParetoChart.tsx
│   │       └── StatsOverview.tsx
│   └── index.ts
├── tests/
│   ├── algorithm.spec.ts
│   └── pareto.spec.ts
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
    "./interface/ui":     "./src/interface/ui/index.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { rankingsRouter } from './interface/server/trpcRouter';
export { refreshRankings } from './interface/server/refreshJob';  // 给 cron
export { computeParetoFrontier } from './domain/pareto';
export type { ModelRanking } from './domain/types';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | ModelRanking 模型 |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/observability` | `logger` / `withLock` |
| `@aihub/aiCore` | （可选）LLM 摘要模型 |

**禁止依赖**：

- ❌ `news`（rankings 不耦合 news，但 `multimodal` 包可双向联合查询）
- ❌ `chat` / `usage` / `projects`

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | `/rankings` 页 + `/rankings/[id]` 详情 |
| `apps/cron` | `refreshRankings()`（Vercel Cron） |
| `multimodal` | ModelRanking + NewsItem 联合 |
| `news/intentSearch` | （旧 import `@/lib/rankings/algorithm`，迁后改 `@aihub/rankings/domain`） |

---

## 7. 边界规则

1. ✅ `scraper.ts` 的 `fetch` 改为构造函数注入（**禁止**直接 import `@/lib/utils/fetch-with-retry`）
2. ✅ 算法 `computeParetoFrontier` 纯函数，无副作用，可独立单测
3. ✅ 快照表 `ModelSnapshot`（如有）写入是 append-only
4. ⚠️ 算法公式变更时必须跑 `tests/algorithm.spec.ts` 全部回归
5. ❌ 禁止算法里调用外部 API（必须纯计算）

---

## 8. 迁移步骤

```bash
# P2.3 第 2 周

mkdir -p packages/rankings/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/rankings/tests

cp src/lib/rankings/algorithm.ts packages/rankings/src/domain/scoreFormula.ts
cp src/lib/rankings/algorithm.test.ts packages/rankings/tests/algorithm.spec.ts
cp src/lib/rankings/scraper.ts packages/rankings/src/infra/scraper.ts
cp src/server/routers/rankings.ts packages/rankings/src/interface/server/trpcRouter.ts

# 抽取 pareto.ts（从 algorithm.ts 中拆出 computeParetoFrontier）
# 把 fetchWithRetry import 改为构造函数注入

# 替换全局 import
# @/lib/rankings/algorithm → @aihub/rankings/domain
# @/lib/rankings/scraper → @aihub/rankings/infra/scraper

pnpm --filter @aihub/rankings typecheck
pnpm --filter @aihub/rankings test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| 算法公式回归（迁移后结果不一致） | `tests/algorithm.spec.ts` 已有大量 fixture 对比 |
| `scraper.ts` 的 fetch 注入改造 | 保留 `scraper.run()` 顶层 wrapper，注入仅用于测试 |
| `news/intentSearch` 旧 import 路径断裂 | codemod 一次性替换 |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/rankings typecheck` 通过
- [ ] `pnpm --filter @aihub/rankings test` 通过（所有算法 fixture 一致）
- [ ] `/rankings` 页正常加载
- [ ] `pnpm cron:refresh-models` 跑通
- [ ] 删除 `src/lib/rankings/*` 后路由仍正常

---

## 11. 过期条件

- 算法公式变更（需更新 fixture 测试）
- 引入新数据源（如 HuggingFace leaderboard）
- 引入用户自定义权重（多 formula 切换）
- `ModelSnapshot` schema 扩展（加 userId 维度的个性化排行）

---

**创建时间**：2026-09-07
