# b14-softDeleteReadOps.md · BUG-14 中危：READ_OPS 含 update/delete，软删数据更新静默 0 命中

> 创建于 2026-09-07
> 严重性：🟡 中危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：`update`/`delete` 也被注入 `deletedAt: null`
- **证据**：`src/lib/db.ts:158-163`
- **为什么可能是它**：通过租户客户端去"恢复"一条已软删的记录（先 update 后 undelete）会静默 0 命中
- **如何验证**：创建 Project → 软删 → 通过 createTenantPrisma 执行 update → 预期失败但实际静默
- **修复思路**：拆分操作集：READ 注入 `deletedAt: null`；WRITE 不动 deletedAt；需要操作软删行的显式走 prismaRaw

---

## 候选根因 #2（可能性：中）

- **现象**：软删除中间件拦截了所有 update/delete，导致 hardDelete / restore 逻辑永远走 prismaRaw
- **证据**：调用方可能绕过中间件
- **为什么可能是它**：代码已有 prismaRaw 分支，中间件设计本身就有漏洞
- **如何验证**：grep `prismaRaw.project.update` — 看 restore 是否已有独立路径
- **修复思路**：统一通过 `prismaRaw` 操作软删/硬删

---

## 修复方案（选 #1）

```ts
// src/lib/db.ts — 中间件内部分类

// 改前：
const WRITE_OPS = ['create', 'update', 'upsert', 'delete', 'createMany', 'deleteMany', 'updateMany'];

// 改后：
// READ 注入 deletedAt: null
const READ_OPS = ['findUnique', 'findFirst', 'findMany', 'findUniqueOrThrow', 'findFirstOrThrow'];
// WRITE 不动 deletedAt（仅 inject tenantId）
const WRITE_OPS = ['create', 'upsert', 'createMany'];
// 需要显式操作的走 prismaRaw
```

---

## 风险

- 影响范围大：所有 update/delete 通过 createTenantPrisma 的行为都变了
- 需要全量回归测试

---

## 回归测试

| 场景 | 预期 |
|---|---|
| softDelete 后的 restore | prismaRaw 路径正常 |
| 普通 update | 不被 deletedAt 拦截 |

---

**创建时间**：2026-09-07
