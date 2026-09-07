# settings.md · settings 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.12

---

## 1. 一句话职责

用户偏好 / API Key 管理 / 对话风格 / 登录方式——`/settings` 页面 + `preferences` tRPC router。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/server/routers/preferences.ts` | ~200 | tRPC `preferences.get/set` |
| `src/server/routers/ai-keys.ts` | ~150 | tRPC ApiKey CRUD |
| `src/components/settings/AiKeysPanel.tsx` | ~300 | API Key 管理面板 |
| `src/components/settings/ChatStylePanel.tsx` | ~250 | 对话风格设置 |
| `src/app/(app)/settings/page.tsx` | ~200 | 设置主页 |

**合计**：~1100 行。

---

## 3. 目标包结构

```
packages/settings/
├── src/
│   ├── domain/
│   │   ├── preferences.ts           # UserPreferences 类型
│   │   ├── apiKey.ts                # ApiKey 业务规则
│   │   └── chatStyle.ts             # 对话风格 preset
│   ├── infra/
│   │   ├── preferencesRepo.ts       # Prisma 封装
│   │   └── apiKeyRepo.ts            # ApiKey CRUD（含 keyResolver 注入）
│   ├── interface/
│   │   ├── server/
│   │   │   ├── preferencesRouter.ts
│   │   │   └── aiKeysRouter.ts
│   │   └── ui/
│   │       ├── AiKeysPanel.tsx
│   │       ├── ChatStylePanel.tsx
│   │       └── SettingsPage.tsx
│   └── index.ts
├── tests/
│   └── apiKey.spec.ts
├── package.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                  "./src/index.ts",
    "./interface/server": "./src/interface/server/index.ts",
    "./interface/ui":     "./src/interface/ui/index.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { preferencesRouter, aiKeysRouter } from './interface/server';
export type { UserPreferences, ChatStylePreset } from './domain';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | UserPreferences / ApiKey 模型 |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/observability` | `logger`（API Key 操作审计） |
| `@aihub/aiCore` | `resolveApiKey`（注入到 apiKeyRepo） |

**禁止依赖**：

- ❌ 业务包（news / rankings / chat 等）
- ❌ theme / discovery / cleanup（横向无关）

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | `/settings` 页面 |
| `apps/web` | AppShell 加载用户偏好 |

---

## 7. 边界规则

1. ✅ `ApiKey` 持久化字段必须加密（用 `@aihub/db` 暴露的 `encryptField`）
2. ✅ `resolveApiKey` 是 `keyResolver.ts` 的唯一入口（CLAUDE.md §3）—— 不得在 settings 包内重写
3. ✅ preferences.set 必须做 schema 校验（zod）
4. ⚠️ `ChatStylePreset` 是个枚举（4 种风格），新增需更新 schema 与 UI
5. ❌ 禁止 settings 包内 import 业务数据（仅操作 UserPreferences / ApiKey）
6. ❌ 禁止直接读 env 拿 API Key（必须经 keyResolver）

---

## 8. 迁移步骤

```bash
# P4.1 第 4 周

mkdir -p packages/settings/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/settings/tests

cp src/server/routers/preferences.ts packages/settings/src/interface/server/preferencesRouter.ts
cp src/server/routers/ai-keys.ts packages/settings/src/interface/server/aiKeysRouter.ts
cp src/components/settings/AiKeysPanel.tsx packages/settings/src/interface/ui/AiKeysPanel.tsx
cp src/components/settings/ChatStylePanel.tsx packages/settings/src/interface/ui/ChatStylePanel.tsx

# domain 类型拆分
# 现有 routers 内联类型抽到 domain/

# 替换全局 import
# @/server/routers/preferences → @aihub/settings/interface/server
# @/server/routers/ai-keys → @aihub/settings/interface/server

pnpm --filter @aihub/settings typecheck
pnpm --filter @aihub/settings test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| ApiKey 加密字段迁移（明文 → 密文） | 一次性脚本：解密旧字段 → 加密写入 → 删除旧字段 |
| `ChatStylePreset` 枚举扩展破坏兼容性 | 保留旧值；新增用新 enum value |
| preferences.set 并发覆盖 | `updatedAt` 时间戳校验（最后写入胜出） |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/settings typecheck` 通过
- [ ] `pnpm --filter @aihub/settings test` 通过
- [ ] `/settings` 页加载正常
- [ ] 添加 / 删除 ApiKey 后 `resolveApiKey` 立即生效
- [ ] 切换 ChatStyle 后 chat 风格变化

---

## 11. 过期条件

- ChatStylePreset 增加第 5 种风格
- 引入新的偏好维度（如新闻订阅源）
- 切换 OAuth 提供商（Google / GitLab）
- ApiKey 加密算法升级（AES-256 → AES-GCM）

---

**创建时间**：2026-09-07
