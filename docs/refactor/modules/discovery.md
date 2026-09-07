# discovery.md · discovery 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.13

---

## 1. 一句话职责

实体发现 / 关联推荐——跨 News + Rankings + Bilibili 的关键词事件聚合。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/components/discovery/discovery-panel.tsx` | ~250 | 主面板 UI |
| `src/components/discovery/discovery-store.ts` | ~100 | Zustand store |
| `src/server/routers/discovery.ts`（推测） | ~150 | tRPC 入口（如有） |

**合计**：~500 行（含 UI）。

**注意**：`discovery` 与 `multimodal` 在 ARCHITECTURE.md 中概念接近，本次设计以 `discovery` 为对外入口，`multimodal/fuse.ts` 仍保留在 src/lib/multimodal（迁到 packages/multimodal，见 P1.4）。

---

## 3. 目标包结构

```
packages/discovery/
├── src/
│   ├── domain/
│   │   ├── entity.ts                # Entity 类型
│   │   └── relation.ts              # EntityRelation 类型
│   ├── infra/
│   │   ├── entityRepo.ts            # Prisma 封装（如有 Entity 表）
│   │   └── fuse.ts                  # 从 src/lib/multimodal/fuse.ts 迁过来
│   ├── interface/
│   │   ├── server/
│   │   │   └── trpcRouter.ts        # routers/discovery.ts 迁移
│   │   └── ui/
│   │       ├── DiscoveryPanel.tsx
│   │       └── discoveryStore.ts
│   └── index.ts
├── tests/
│   └── fuse.spec.ts                 # 跨源融合逻辑
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
export { discoveryRouter } from './interface/server/trpcRouter';
export { fuseEntities } from './infra/fuse';
export type { Entity, EntityRelation } from './domain';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | Entity 模型（如有） |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/observability` | `logger` |
| `@aihub/news`（**弱依赖**） | 跨源融合时查 NewsItem |
| `@aihub/rankings`（**弱依赖**） | 跨源融合时查 ModelRanking |

**禁止依赖**：

- ❌ `chat` / `usage` / `projects` / `aiCore`

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | Discovery 面板 |
| `apps/web` | `discoveryStore` 在 settings / workbench 内消费 |

---

## 7. 边界规则

1. ✅ `fuseEntities` 是纯函数（输入 entity 列表，输出融合结果）
2. ✅ 跨源查询必须用 tenantId 过滤
3. ⚠️ Entity 表（若有）是 schema 的可选扩展——迁包前确认 schema 已有该模型
4. ❌ 禁止 discovery 反向依赖 news / rankings 的内部路径
5. ❌ 禁止 discovery 写操作（仅 read + 推荐）

---

## 8. 迁移步骤

```bash
# P1.4 第 1 周（极简单）

mkdir -p packages/discovery/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/discovery/tests

# 1. multimodal/fuse.ts 迁过来
cp src/lib/multimodal/fuse.ts packages/discovery/src/infra/fuse.ts

# 2. UI 组件
cp src/components/discovery/discovery-panel.tsx packages/discovery/src/interface/ui/DiscoveryPanel.tsx
cp src/components/discovery/discovery-store.ts packages/discovery/src/interface/ui/discoveryStore.ts

# 3. tRPC router（如有）
# cp src/server/routers/discovery.ts packages/discovery/src/interface/server/trpcRouter.ts

# 4. 替换全局 import
# @/lib/multimodal/fuse → @aihub/discovery
# @/components/discovery → @aihub/discovery/interface/ui

pnpm --filter @aihub/discovery typecheck
pnpm --filter @aihub/discovery test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| `multimodal/fuse.ts` 跨包被 news / rankings 引用 | 全量 grep 替换 |
| Entity 表 schema 缺失 | 暂时仅做内存级融合（不持久化） |
| discoveryStore 在多个页面被消费 | 保留 barrel export `interface/ui` |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/discovery typecheck` 通过
- [ ] `pnpm --filter @aihub/discovery test` 通过
- [ ] Discovery 面板正常渲染
- [ ] 跨源融合结果一致（迁移前后）

---

## 11. 过期条件

- 引入 Entity 表 schema 扩展
- 引入图数据库（Neo4j）替代内存融合
- 跨源融合算法变更

---

**创建时间**：2026-09-07
