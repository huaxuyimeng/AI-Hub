# usage.md · usage 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.4

---

## 1. 一句话职责

token 计费 / 用量统计 / 账单展示——`/usage` 页和 `recordUsage` 埋点的归属。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/usage.ts` | 92 | `recordUsage` 核心埋点 |
| `src/lib/usage.test.ts` | ~150 | 单测 |
| `src/server/routers/usage.ts` | ~80 | tRPC recent / pricing / byModel |

**关键修复历史**：

- C19：messageCount / analysisCount 各自 increment
- C20：retry-on-P2002 兜底并发竞态
- Q2：加 `kind` 参数区分 chat / analysis
- H-2：去掉冗余 `$transaction` 包装

---

## 3. 目标包结构

```
packages/usage/
├── src/
│   ├── domain/
│   │   ├── aggregation.ts           # recordUsage 业务逻辑
│   │   └── kind.ts                  # 'chat' | 'analysis' enum
│   ├── infra/
│   │   └── usageStatRepo.ts         # Prisma 封装（重试逻辑封装在此）
│   ├── interface/
│   │   └── server/
│   │       └── trpcRouter.ts        # routers/usage.ts 迁移
│   └── index.ts
├── tests/
│   └── recordUsage.spec.ts          # 并发竞态回归测试
├── package.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                 "./src/index.ts",
    "./domain":          "./src/domain/index.ts",
    "./interface/server":"./src/interface/server/trpcRouter.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { recordUsage, UNKNOWN_MODEL_ID } from './domain/aggregation';
export type { UsageKind } from './domain/kind';
export { usageRouter } from './interface/server/trpcRouter';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | UsageStat 模型 |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/aiCore` | `calculateCost` 模型定价 |

**禁止依赖**：

- ❌ `chat` / `projects`（usage 是底层）
- ❌ `news` / `rankings`（usage 不感知业务来源）

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `chat` 包 | `import { recordUsage, UNKNOWN_MODEL_ID } from '@aihub/usage'` |
| `analysis` 包（待独立） | 同上 |
| `apps/web` | `/usage` 页消费 `usageRouter` |

---

## 7. 边界规则

1. ✅ `recordUsage` 必须传入 `tenantId`——**禁止**省略
2. ✅ `modelId` 为 null 时落到独立行（`__unknown_model__`）避免 SQLite NULL 歧义
3. ✅ 重试逻辑封装在 `usageStatRepo`——调用方**不感知** P2002
4. ⚠️ `cost` 字段是"元"（float），存储时 `*100` 转 `costCents`（整数）
5. ❌ 禁止聚合到分钟级（仅日聚合，避免写入放大）

---

## 8. 迁移步骤

```bash
# P2.3 第 2 周

mkdir -p packages/usage/src/{domain,infra,interface/server}
mkdir -p packages/usage/tests

cp src/lib/usage.ts packages/usage/src/domain/aggregation.ts
cp src/server/routers/usage.ts packages/usage/src/interface/server/trpcRouter.ts
cp src/lib/usage.test.ts packages/usage/tests/recordUsage.spec.ts

# 抽取 prisma.usageStat.* 调用到 infra/usageStatRepo.ts
# 把重试逻辑（P2002）封装在 repo 内

# 替换全局 import
# @/lib/usage → @aihub/usage
# @/lib/ai/pricing → @aihub/aiCore

pnpm --filter @aihub/usage typecheck
pnpm --filter @aihub/usage test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| 并发 upsert 仍触发 P2002 超 3 次 | 抛错给上层；监控告警 |
| 模型定价变更导致历史数据"金额漂移" | `costCents` 是历史写入时的快照，**不重算** |
| 测试数据库隔离 | 复用 `tests/unit/usage/billing.spec.ts` 模式（见 testing-isolation.md） |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/usage typecheck` 通过
- [ ] `pnpm --filter @aihub/usage test` 通过（含并发竞态测试）
- [ ] 发 10 条消息 → `usage.recent` 显示 +10 messageCount
- [ ] 跑 1 个 analysis → analysisCount +1（不污染 messageCount）

---

## 11. 过期条件

- 引入月结账 / 历史重算（需要 UsageEvent + UsageSnapshot 两表）
- 改聚合粒度（分钟级 / 小时级）
- 多币种（USD / CNY 切换）

---

**创建时间**：2026-09-07
