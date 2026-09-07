# chat.md · chat 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.2

---

## 1. 一句话职责

AI 对话流——管理 Conversation / Message 持久化、流式响应、用量埋点（`recordUsage`）。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/server/routers/chat.ts` | 165 | tRPC 入口（list / byId / create / send） |
| `src/app/(app)/chat/page.tsx` | （UI） | 对话页 |

**关键依赖**：

- `@aihub/aiCore`（via `@/lib/ai/router`）—— 调用 LLM
- `@/lib/usage` —— `recordUsage`
- `@/lib/db` —— Conversation / Message 模型

---

## 3. 目标包结构

```
packages/chat/
├── src/
│   ├── domain/
│   │   ├── conversation.ts          # Conversation 业务逻辑
│   │   └── message.ts               # Message 构造
│   ├── infra/
│   │   ├── conversationRepo.ts      # Prisma 封装（替代 prisma.conversation.* 直接调用）
│   │   └── messageRepo.ts
│   ├── interface/
│   │   ├── server/
│   │   │   └── trpcRouter.ts        # 现有 routers/chat.ts 迁移
│   │   └── ui/                      # (可选) 共享对话 UI 组件
│   │       ├── ChatStream.tsx
│   │       └── MessageList.tsx
│   └── index.ts
├── tests/
│   └── conversation.spec.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                 "./src/index.ts",
    "./interface/server":"./src/interface/server/trpcRouter.ts",
    "./interface/ui":    "./src/interface/ui/index.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { chatRouter } from './interface/server/trpcRouter';
export type { ChatSendInput, ChatSendOutput } from './domain/message';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | Conversation / Message / UsageStat 模型 |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/aiCore` | `chat()` 多 Provider 调用 |
| `@aihub/observability` | `logger` / `withLock` |
| `@aihub/usage` | `recordUsage` 埋点 |

**禁止依赖**：

- ❌ `news` / `rankings` / `bilibili`（chat 不感知其他业务数据）
- ❌ `slideEngine` / `dailyBriefing`（早报走自己的包）

---

## 6. 消费方清单

| 包 | 用途 |
|---|---|
| `apps/web` | 挂载 `chatRouter` 到 `/api/trpc` |
| `apps/web/src/app/(app)/chat/page.tsx` | 消费 `chat.send` / `chat.list` / `chat.byId` |

---

## 7. 边界规则

1. ✅ `chat.send` 调用 `aiCore.chat()` 时必须传入 `tenantId`（Q2 修复：埋点归属）
2. ✅ `recordUsage` 必须在 LLM 响应**完成后**调用（失败时不计费）
3. ✅ 流式响应通过 tRPC subscription 或 SSE，**不直接走 fetch**
4. ❌ chat 模块不持久化 prompt template（模板由 `apps/web` 的 chat-style 配置驱动）
5. ❌ chat 不直接 import `@/lib/ai/router` 内部（必须通过 `@aihub/aiCore`）

---

## 8. 迁移步骤

```bash
# P4.1 第 4 周

mkdir -p packages/chat/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/chat/tests

cp src/server/routers/chat.ts packages/chat/src/interface/server/trpcRouter.ts

# 提取 conversationRepo / messageRepo
# 把 router 内的 prisma.conversation.findMany 抽到 infra/conversationRepo.ts

# 替换全局 import
# @/lib/db → @aihub/db
# @/server/context → @aihub/auth/interface/trpc
# @/lib/ai/router → @aihub/aiCore
# @/lib/usage → @aihub/usage

pnpm --filter @aihub/chat typecheck
pnpm --filter @aihub/chat test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| 流式响应（SSE）在 Next.js App Router 下断 | 单独跑 e2e：发送消息 → 看到流式返回 |
| `recordUsage` 在并发场景下 P2002 竞态 | 已用 retry-on-P2002 兜底（usage.ts C20 修复），无需额外处理 |
| `chat.send` 类型缺失 `tenantId`（已发现 BUG） | 迁移时强制检查 `chat.ts:108` 调用 `chat()` 必须传 tenantId |
| 历史对话的 Message.role 历史值（`assistant` vs `model`）混乱 | 不改 schema，做数据迁移注释；UI 层做兼容 |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/chat typecheck` 通过
- [ ] `pnpm --filter @aihub/chat test` 通过
- [ ] `pnpm dev` 后发消息 → 流式返回 → usage 计数 +1
- [ ] `usage.recent` 显示刚才的对话已计入
- [ ] 删除 `src/server/routers/chat.ts` 后页面仍正常

---

## 11. 过期条件

- 引入 conversation branching（多分支对话）
- 引入 system prompt 模板化
- 切换流式协议（tRPC subscription ↔ SSE）
- 引入 multimodal message（image / audio）

---

**创建时间**：2026-09-07
**下次更新**：P4.1 迁移前
