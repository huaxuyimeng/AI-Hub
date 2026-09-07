# auth.md · auth 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.1 + [`infra/monorepoTopology.md`](../infra/monorepoTopology.md)

---

## 1. 一句话职责

登录 / session 管理 / 租户隔离——为整个应用提供"当前用户是谁、属于哪个租户、什么角色"的统一答案。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/auth.ts` | 211 | NextAuth 配置 + JWT callback + 跨租户防护 |
| `src/server/context.ts` | 100 | tRPC context 注入 session/tenantId |

**合计**：~310 行。

---

## 3. 目标包结构

```
packages/auth/
├── src/
│   ├── domain/
│   │   ├── role.ts                 # enum ADMIN | MEMBER
│   │   └── session.ts              # Session 类型扩展
│   ├── infra/
│   │   ├── nextAuthOptions.ts      # 现有 authOptions 主体
│   │   ├── callbacks/
│   │   │   ├── signIn.ts           # 拆出 signIn callback（C-1 修复）
│   │   │   ├── jwt.ts              # 拆出 jwt callback（C22 修复）
│   │   │   └── session.ts          # 拆出 session callback
│   │   └── providers/
│   │       ├── github.ts
│   │       └── credentials.ts      # 含 bcrypt（C13）
│   ├── interface/
│   │   └── trpcContext.ts          # 现有 context.ts 迁移
│   └── index.ts
├── tests/
│   └── signIn.spec.ts              # 跨租户防护单元测试
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":               "./src/index.ts",
    "./domain":        "./src/domain/index.ts",
    "./interface/trpc": "./src/interface/trpcContext.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { authOptions } from './infra/nextAuthOptions';
export { createContext, protectedProcedure, adminProcedure, requireAdmin } from './interface/trpcContext';
export type { Session } from 'next-auth';
export type { Role } from './domain/role';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | `prismaBase` 单例（OAuth Account/Session/User） |
| `next-auth` | NextAuth Options 类型 |
| `@auth/prisma-adapter` | OAuth 持久化 |
| `bcryptjs` | 凭证密码校验（C13） |
| `@trpc/server` | protectedProcedure / adminProcedure 类型 |

**禁止依赖**：

- ❌ 任何业务包（`news` / `rankings` / `chat` 等）
- ❌ `aiCore`（auth 不感知模型存在）

---

## 6. 消费方清单（consumer list）

| 包 | 引用方式 |
|---|---|
| `apps/web` | `import { authOptions } from '@aihub/auth'` + `import { createContext } from '@aihub/auth/interface/trpc'` |
| 未来所有业务包 | `import { protectedProcedure, adminProcedure } from '@aihub/auth/interface/trpc'` |

**约束**：业务包**不直接** import `auth.ts` 任何内部路径，必须通过 `@aihub/auth/interface/trpc` 子入口。

---

## 7. 边界规则

1. ✅ `auth` 包**单向**被业务包引用
2. ✅ `auth` 包**不感知**任何业务模型（`Project` / `Conversation` / `NewsItem` 等）
3. ⚠️ `signIn` callback 涉及 OAuth 多租户防护（C-1 修复）—— **任何重构必须保留"多候选邮箱全部为 OAuth-only 才放行"逻辑**
4. ⚠️ `jwt` callback 仅在 `user.id` 存在时查 DB（C22 修复）—— **绝不能在 token 刷新场景查 DB**
5. ❌ 禁止把 `tenantId` 写死为单租户常量（必须从 DB 读取）

---

## 8. 迁移步骤

```bash
# P4.1 第 4 周迁移（auth 是 UI 包，最后迁）

# 1. 创建包
mkdir -p packages/auth/src/{domain,infra/callbacks,infra/providers,interface}
mkdir -p packages/auth/tests

# 2. 复制 + 拆分
cp src/lib/auth.ts packages/auth/src/infra/nextAuthOptions.ts
# 拆 callbacks 目录（按职责切 3 个文件）

# 3. context.ts 迁移
cp src/server/context.ts packages/auth/src/interface/trpcContext.ts

# 4. 入口
cat > packages/auth/src/index.ts << EOF
export { authOptions } from './infra/nextAuthOptions'
export { createContext, protectedProcedure, adminProcedure, requireAdmin } from './interface/trpcContext'
export type { Role } from './domain/role'
EOF

# 5. package.json
cat > packages/auth/package.json << EOF
{
  "name": "@aihub/auth",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./domain": "./src/domain/index.ts",
    "./interface/trpc": "./src/interface/trpcContext.ts"
  }
}
EOF

# 6. 全局 import 替换
# @/lib/auth → @aihub/auth
# @/server/context → @aihub/auth/interface/trpc

# 7. 验证
pnpm --filter @aihub/auth typecheck
pnpm --filter @aihub/auth test
pnpm dev  # 测 OAuth + Credentials 登录
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| 跨包 import 路径爆炸 | TypeScript path alias + codemod |
| signIn callback 拆分漏掉 C-1 防护逻辑 | 迁移前补 `tests/signIn.spec.ts` 覆盖多候选邮箱场景 |
| next-auth 类型扩展断 | `declare module 'next-auth'` 与 `next-auth/jwt` 必须保留 |
| Context 注入的 `tenantId` 为 null 时业务包崩 | `protectedProcedure` 已 throw UNAUTHORIZED，验证已有 |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/auth typecheck` 通过
- [ ] `pnpm --filter @aihub/auth test` 通过（含跨租户防护测试）
- [ ] `pnpm dev` 启动后，GitHub OAuth 登录 + Credentials 登录**两种**方式均成功
- [ ] 跨租户访问 `/projects/<id>` 收到 404（不泄露存在性）
- [ ] 删除 `src/lib/auth.ts` 后（保留 1 周后），所有路由仍正常

---

## 11. 过期条件

下列任一情况发生，需更新本设计：

- 引入新的 Provider（如 Google / GitLab）
- 改 session 策略（JWT ↔ Database）
- 加入 OAuth scope 校验或 token refresh 流程
- `tenantId` 多值场景（用户多租户身份）
- 加入 MFA / 2FA

---

**创建时间**：2026-09-07
**下次更新**：P4.1 迁移前
