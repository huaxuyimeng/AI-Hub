# b08-orphanCleanupLoop.md · BUG-08 高危：孤儿文件清理死循环

> 创建于 2026-09-07
> 严重性：🔴 高危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：R2 删除后不回写 DB，File 记录永远满足 `deletedAt < cutoff`
- **证据**：`src/lib/cleanup-db.ts:98-136` — 删除 R2 对象后无 `prisma.file.deleteMany`
- **为什么可能是它**：File 软删后 `deletedAt` 已写入，再次查询 `deletedAt < cutoff` 永远为 true
- **如何验证**：跑一次 cleanup → 查 `prisma.file.findMany({ deletedAt: { not: null } })` → 记录数不降
- **修复思路**：R2 删除成功后执行 `prisma.file.deleteMany({ where: { id: { in: removedIds } } })`

---

## 候选根因 #2（可能性：低）

- **现象**：`take: 1000` 每次只处理 1000 条，旧数据占满队列
- **证据**：`cleanup-db.ts` 的 `take: 1000`
- **为什么可能是它**：即使修了回写，若队列被旧数据占满，新孤儿仍排不进去
- **如何验证**：观察 `take: 1000` 的 queue 被哪类记录占满
- **修复思路**：先处理最老的孤儿（按 `deletedAt` 升序）

---

## 修复方案（选 #1）

```ts
// src/lib/cleanup-db.ts

// 在 R2 删除成功后追加：
// 改前：
  const removed = await r2Client.deleteObjects(keysToRemove);

// 改后：
  const removed = await r2Client.deleteObjects(keysToRemove);
  // BUG-08 修复：删除成功后回写 DB，永久移除孤儿记录
  if (removed.length > 0) {
    await prismaRaw.file.deleteMany({
      where: { id: { in: removed.map(r => r.id) } },
    });
  }
```

---

## 风险

- R2 删除成功但 DB 回写失败 → 孤儿重新出现（下次 cron 再删）
- 硬删 File（有 deletedAt 的记录）是不可逆操作——需确认没有业务逻辑依赖"软删 File"的恢复

---

## 回归测试

| 步骤 | 操作 | 预期 |
|---|---|---|
| 1 | 插入 10 条孤儿 File（r2Key 指向不存在的对象） | success |
| 2 | 跑 `pnpm cron:cleanup` | success |
| 3 | 查 `prisma.file.findMany({ deletedAt: { not: null } })` | 数量 -10 |
| 4 | 再跑 cron | 0 条被处理 |

---

**创建时间**：2026-09-07
