# b06-newsByModelLimitUnbounded.md · BUG-06 高危：news.byModel limit 无界

> 创建于 2026-09-07
> 严重性：🔴 高危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：`limit: z.number().default(10)` 无 min/max
- **证据**：`src/server/routers/news.ts:158`
- **为什么可能是它**：zod 无界 input → Prisma take 任意大（1e9 拖垮 DB）
- **如何验证**：调 `news.byModel({ modelId: 'gpt-4o', limit: 1e9 })` → DB 全表扫描
- **修复思路**：`z.number().int().min(1).max(50)`

---

## 候选根因 #2（可能性：中）

- **现象**：负数 limit 时 Prisma take 语义反转（倒序取）
- **证据**：Prisma `take: -10` = 取最后 10 条（SQL `LIMIT -10` 被 DB 解释）
- **为什么可能是它**：未校验负数
- **如何验证**：调 `news.byModel({ limit: -1 })` → 看行为
- **修复思路**：`z.number().int().min(1)`（含 min 即自动排除负数）

---

## 修复方案（选 #1）

```ts
// src/server/routers/news.ts:158

// 改前：
limit: z.number().default(10),

// 改后：
limit: z.number().int().min(1).max(50).default(10),
```

---

## 风险

- 现有调用方若传 >50 的 limit → zod 报错（影响前端筛选逻辑）
- 需全量 grep 所有 `.limit(` 调用场景

---

## 回归测试

| 输入 | 预期 |
|---|---|
| `{ limit: 10 }` | 200，正常返回 |
| `{ limit: 50 }` | 200，正常返回 |
| `{ limit: 51 }` | 422 zod error |
| `{ limit: 0 }` | 422 zod error |
| `{ limit: -1 }` | 422 zod error |

---

**创建时间**：2026-09-07
