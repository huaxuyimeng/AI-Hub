# b23-aihubRestKeyDead.md · BUG-23 低危：aihub-rest API Key 是死功能

> 创建于 2026-09-07
> 严重性：🟢 低危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：`key-resolver` 只按 provider 匹配，`aihub-rest` 永不命中
- **证据**：`src/lib/ai/key-resolver.ts` 的匹配逻辑
- **为什么可能是它**：`aihub-rest` provider 不存在于匹配表
- **如何验证**：创建 aihub-rest key → 调用 `/api/v1/*` → key 永远不生效
- **修复思路**：选择 A（实现）：在 `/api/v1/*` 实现 Bearer key 校验；选择 B（下线）：删除 UI 入口

---

## 候选根因 #2（可能性：中）

- **现象**：`project.ts:155-183` 创建 REST key 后无调用方
- **证据**：grep 所有 import `aihub-rest`
- **为什么可能是它**：从未真正接入
- **如何验证**：grep 确认无引用
- **修复思路**：确认无引用后删除

---

## 修复方案（选 B：下线）

```bash
# 1. 确认无调用方
grep -r "aihub-rest" src/

# 2. 删除相关代码
# src/server/routers/project.ts — 删除 createRestKey mutation
# src/components/settings/ — 删除 REST Key 相关 UI
# src/app/api/v1/* — 删除或保留（无调用方）

# 3. schema 评估
# ApiKey.provider = 'aihub-rest' 的行需不需要迁移（可保留，不影响功能）
```

---

## 风险

- 下线后已有 aihub-rest key 的用户会困惑（key 还在但不起作用）
- 如果有文档引用了 REST API 功能，需同步更新

---

## 回归测试

| 场景 | 预期 |
|---|---|
| 创建 aihub-rest key | 成功（schema 保留） |
| 用 aihub-rest key 调 `/api/v1/*` | 401（无调用方，视为正常下线） |
| 页面无 REST Key 入口 | - |

---

**创建时间**：2026-09-07
