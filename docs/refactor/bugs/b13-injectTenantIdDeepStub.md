# b13-injectTenantIdDeepStub.md · BUG-13 中危：injectTenantIdDeep 是空壳

> 创建于 2026-09-07
> 严重性：🟡 中危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：77-81 行条件块内只有注释，零逻辑
- **证据**：`src/lib/db.ts:66-108`
- **为什么可能是它**：函数注释宣称"递归注入嵌套 data.tenantId"，但从未实现——嵌套 create 漏传 tenantId 时靠数据库 NotNull 约束兜底报错
- **如何验证**：调用 `prisma.analysis.create({ data: { projectId: 'xxx', content: {} } })`（嵌套 data 无 tenantId）→ 预期 Prisma 报错（NotNull）
- **修复思路**：真正实现递归注入，或删除函数 + 注释，明示"嵌套写必须手动传 tenantId"

---

## 候选根因 #2（可能性：中）

- **现象**：软删除中间件的 `deletedAt` 注入在所有操作上，掩盖了更深的问题
- **证据**：`src/lib/db.ts` 中间件
- **为什么可能是它**：中间件的存在让问题更难发现
- **如何验证**：grep 所有 `prisma.*.create` 调用，看嵌套 create 是否显式传 tenantId
- **修复思路**：标准化：所有嵌套 create 必须显式传 tenantId

---

## 修复方案（选 #1：删除空壳 + 显式要求）

```ts
// src/lib/db.ts

// 删除 injectTenantIdDeep 函数及其注释

// 改前：
/**
 * 递归注入嵌套 data.tenantId
 * ...
 */
export async function injectTenantIdDeep(...) { ... }  // 空壳

// 改后：
/**
 * 注意：嵌套 create 必须手动传 tenantId！
 * 本函数已删除（原为注释声明，实际不执行注入）。
 * 如需注入，请使用 Prisma middleware 或在调用方显式传入。
 */

// 同时在 db.ts 顶部加注释：
// ⚠️ 嵌套 create 必须显式传入 tenantId，不依赖自动注入
```

---

## 风险

- 依赖空壳函数的调用方会 break（应为空）
- 文档需同步更新

---

## 回归测试

| 场景 | 预期 |
|---|---|
| 嵌套 create 无 tenantId | Prisma NotNull 报错（行为不变，与修复前相同） |
| 嵌套 create 有 tenantId | 正常写入 |
| grep injectTenantIdDeep | 0 结果 |

---

**创建时间**：2026-09-07
