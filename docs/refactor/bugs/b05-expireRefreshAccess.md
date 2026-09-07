# b05-expireRefreshAccess.md · BUG-05 高危：expensive refresh 端点无 admin 门禁

> 创建于 2026-09-07
> 严重性：🔴 高危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：任意登录用户可触发 `news.refresh` / `rankings.refresh` / `bilibili.refresh`
- **证据**：`src/server/routers/news.ts:141`、`rankings.ts`、`bilibili.ts:112` 均只用 `protectedProcedure`
- **为什么可能是它**：`protectedProcedure` 只要求"登录"，无 role 校验
- **如何验证**：用非 admin 账号调这三个 endpoint → 均返回 200（越权）
- **修复思路**：改为 `adminProcedure`（实时查 DB role）

---

## 候选根因 #2（可能性：中）

- **现象**：无请求限流——同一用户可秒发 100 次 refresh
- **证据**：三个 router 均无 `rateLimit` middleware
- **为什么可能是它**：即使加了 admin 门禁，admin 本人也能 DOS
- **如何验证**：压测：连续发 100 次 `news.refresh` → 观察响应时间和上游 API 调用量
- **修复思路**：加 Upstash Redis 限流（`/api/trpc/news.refresh` 限 1 次/分钟）

---

## 修复方案（选 #1）

```bash
# 1. news router
# src/server/routers/news.ts:141
# 改前：
  refresh: protectedProcedure.mutation(...)

# 改后：
  refresh: adminProcedure.mutation(...)   # adminProcedure = protectedProcedure + requireAdmin middleware

# 2. rankings router
# src/server/routers/rankings.ts 同理

# 3. bilibili router
# src/server/routers/bilibili.ts 同理

# 4. 验证
pnpm typecheck
# 用 admin 账号测试 refresh 成功
# 用 member 账号测试 → 403 Forbidden
```

---

## 风险

- adminProcedure 实时查库（`requireAdmin` middleware 已在 context.ts 实现）
- 现有 UI 需要处理 403 状态

---

## 回归测试

| 场景 | 预期 |
|---|---|
| member 调 `news.refresh` | 403 |
| admin 调 `news.refresh` | 200 |
| member 调 `rankings.refresh` | 403 |
| member 调 `bilibili.refresh` | 403 |
| 连续 3 次 admin 调 refresh | 正常（无 rate limit） |

---

**创建时间**：2026-09-07
