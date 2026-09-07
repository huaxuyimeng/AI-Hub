# b28-toPublicProjectLeak.md · BUG-28 低危：toPublicProject 反而暴露 tenantId

> 创建于 2026-09-07
> 严重性：🟢 低危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：`toPublicProject` 在返回前映射了 `tenantId`
- **证据**：`src/lib/sanitize.ts:92-93`
- **为什么可能是它**："对外脱敏形态"反而暴露了内部租户标识
- **如何验证**：调 `project.list` → 看返回的 JSON 中 tenantId 字段
- **修复思路**：删除 `tenantId` 字段映射

---

## 候选根因 #2（可能性：中）

- **现象**：其他 `toPublic*` 函数是否也有同样问题
- **证据**：grep 所有 `toPublic` 函数
- **为什么可能是它**：统一模板可能复制了同类问题
- **如何验证**：grep 检查其他 toPublic 函数

---

## 修复方案（选 #1）

```ts
// src/lib/sanitize.ts

// 改前：
export function toPublicProject(p: Project) {
  return {
    ...p,
    tenantId: p.tenantId,  // ← 暴露了内部租户标识
    latestScore: p.latestScore ?? null,
  };
}

// 改后：
export function toPublicProject(p: Project) {
  const { tenantId, ...rest } = p;  // ← 排除 tenantId
  return {
    ...rest,
    latestScore: p.latestScore ?? null,
  };
}
```

---

## 风险

- 现有调用方若依赖 tenantId 字段（应无）
- 需全量 grep 确认无依赖

---

## 回归测试

| 场景 | 预期 |
|---|---|
| `project.list` 返回 | tenantId 字段不存在 |
| 内部逻辑 | tenantId 不受影响 |

---

**创建时间**：2026-09-07
