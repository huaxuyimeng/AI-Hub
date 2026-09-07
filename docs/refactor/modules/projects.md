# projects.md · projects 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.3

---

## 1. 一句话职责

项目 CRUD + 软删除 + 租户归属校验——`/projects/*` 路由全部数据的拥有者。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/server/routers/project.ts` | 195 | tRPC 入口（list / byId / create / update / softDelete / trash / restore / hardDelete） |
| `src/lib/lifecycle.ts` | ~120 | `softDeleteProject` / `restoreProject` / `hardDeleteProject`（跨模型复用的软删除工具） |
| `src/lib/sanitize.ts` | ~50 | `toPublicProject`（去掉内部字段） |

**关键修复历史**：

- B6：软删除 / 硬删除
- C14：trash/restore/hardDelete 加租户归属校验（`assertProjectOwned` helper）

---

## 3. 目标包结构

```
packages/projects/
├── src/
│   ├── domain/
│   │   ├── project.ts               # Project 业务规则
│   │   └── ownership.ts             # assertProjectOwned（来自 C14）
│   ├── infra/
│   │   ├── projectRepo.ts           # Prisma 封装
│   │   └── lifecycle.ts             # 软删 / 恢复 / 硬删（来自 src/lib/lifecycle.ts，仅 project 相关部分）
│   ├── interface/
│   │   └── server/
│   │       └── trpcRouter.ts        # routers/project.ts 迁移
│   └── index.ts
├── tests/
│   └── ownership.spec.ts            # 跨租户硬删阻断
├── package.json
└── README.md
```

**注意**：`lifecycle.ts` 当前是跨模型复用——仅 `softDeleteProject` 等 project 部分迁移到 packages/projects。其他模型（File / Analysis）的生命周期留在 packages/db 或独立 packages/lifecycle（视需求而定）。

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                 "./src/index.ts",
    "./interface/server":"./src/interface/server/trpcRouter.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { projectRouter } from './interface/server/trpcRouter';
export { assertProjectOwned } from './domain/ownership';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | Project 模型 + 多租户 prisma |
| `@aihub/auth` | `protectedProcedure` / `adminProcedure`（hardDelete 需 admin） |
| `@aihub/observability` | `logger`（跨租户访问尝试告警） |

**禁止依赖**：

- ❌ `chat` / `usage` / `aiCore`（projects 是底座）
- ❌ `news` / `rankings`（projects 不感知其他业务）

---

## 6. 消费方清单

| 包 | 用途 |
|---|---|
| `apps/web` | `/projects` 页面、`/projects/[id]` 详情页 |
| `chat` 包 | 间接引用 Project 作为 Conversation 的关联（FK） |

---

## 7. 边界规则

1. ✅ 所有 router 必须用 `createTenantPrisma({ tenantId })`——**禁止**直接 `new PrismaClient()`
2. ✅ `hardDelete` 仅 `adminProcedure` 可调用（C14 强化）
3. ✅ 跨租户访问用 `assertProjectOwned` helper，**返回 NOT_FOUND 而非 FORBIDDEN**（不泄露存在性）
4. ✅ `toPublicProject` 必须在返回前端前脱敏（删内部字段如 `internalNotes`）
5. ❌ 禁止给非白名单模型加 `deletedAt`（CLAUDE.md §3 强约束）

---

## 8. 迁移步骤

```bash
# P4.1 第 4 周

mkdir -p packages/projects/src/{domain,infra,interface/server}
mkdir -p packages/projects/tests

cp src/server/routers/project.ts packages/projects/src/interface/server/trpcRouter.ts

# 抽取 assertProjectOwned → domain/ownership.ts
# 把 prisma.project.* 调用抽到 infra/projectRepo.ts

# lifecycle.ts 拆分：只迁 project 相关部分
# 其他模型（File/Analysis）的 lifecycle 函数保留在 src/lib/lifecycle.ts
# 或迁到 packages/db/src/lifecycle.ts（待评估）

# 替换全局 import
# @/lib/db → @aihub/db
# @/lib/lifecycle → @aihub/projects
# @/lib/sanitize → @aihub/projects/interface/server 或保留

pnpm --filter @aihub/projects typecheck
pnpm --filter @aihub/projects test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| `lifecycle.ts` 拆分时漏迁某个模型 | 一次性 grep 全部 import，列清单后再迁 |
| `adminProcedure` 实时查库（`requireAdmin` middleware）性能 | 已优化为单次 query，索引加在 `User.role` |
| 软删除的 Project 在 list 中"复活" | `deletedAt: null` 强过滤在 `createTenantPrisma` 中间件统一处理 |
| 跨租户硬删绕过 `assertProjectOwned` | 测试覆盖：尝试硬删他租户项目 → 收 NOT_FOUND |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/projects typecheck` 通过
- [ ] `pnpm --filter @aihub/projects test` 通过（含跨租户硬删测试）
- [ ] `/projects` 列表只显示当前租户项目
- [ ] `/projects/<他人租户项目id>` 返回 404（不泄露）
- [ ] admin 硬删 → 文件清理脚本联动（cleanup 包）

---

## 11. 过期条件

- Project 字段扩展（如新增 `tags` / `archived` 字段）
- 引入 Project 模板 / 复制功能
- 切换 RBAC 模型（admin/member → 细粒度 role）

---

**创建时间**：2026-09-07
