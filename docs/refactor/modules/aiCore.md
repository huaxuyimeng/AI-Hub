# aiCore.md · aiCore 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.5

---

## 1. 一句话职责

多 Provider LLM 路由（OpenAI / Anthropic / Gemini / DeepSeek）+ Key 解析 + 模型白名单 + 定价表。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/ai/router.ts` | 272 | `chat()` 多协议分发 + `chooseModel()` |
| `src/lib/ai/providers.ts` | ~200 | Provider adapter 注册表 |
| `src/lib/ai/models.ts` | ~150 | 模型白名单 + 别名解析 |
| `src/lib/ai/pricing.ts` | ~120 | 定价表 |
| `src/lib/ai/key-resolver.ts` | ~100 | ApiKey 解析（CLAUDE.md §3 强约束：唯一入口） |
| `src/lib/ai/chat-style.ts` | ~80 | 用户对话风格 |
| `src/lib/ai/client.ts` | ~50 | 兼容占位（待删除） |

**合计**：~970 行。

**关键决策**：

- route-A：所有任务默认 `deepseek-v4-flash`
- hist-A：调用方传 history，system prompt 在调用方注入（router 不感知）
- scope-C：替换 LiteLLM，自研多协议分发

---

## 3. 目标包结构

```
packages/aiCore/
├── src/
│   ├── domain/
│   │   ├── chatMessage.ts           # ChatMessage 类型
│   │   ├── chatOptions.ts           # ChatOptions 类型
│   │   └── taskType.ts              # TaskType enum
│   ├── infra/
│   │   ├── providers/
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   ├── gemini.ts
│   │   │   ├── deepseek.ts
│   │   │   └── providerRegistry.ts  # getProviderAdapter
│   │   ├── models/
│   │   │   ├── supportedModels.ts
│   │   │   ├── aliases.ts           # resolveModelAlias
│   │   │   └── pricing.ts
│   │   └── keyResolver.ts           # resolveApiKey（CLAUDE.md §3 强约束）
│   ├── interface/
│   │   └── server/
│   │       └── router.ts            # chooseModel + chat 多协议分发
│   └── index.ts
├── tests/
│   ├── router.spec.ts               # 多 Provider 协议分发测试
│   ├── keyResolver.spec.ts          # Key 解析降级测试
│   └── pricing.spec.ts
├── package.json
└── README.md
```

**client.ts 删除**：作为兼容占位已弃用，迁包时直接删除。

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                 "./src/index.ts",
    "./interface/server":"./src/interface/server/router.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { chat, chooseModel } from './interface/server/router';
export { resolveApiKey } from './infra/keyResolver';
export { calculateCost } from './infra/models/pricing';
export { SUPPORTED_MODEL_NAMES, resolveModelAlias, getModel } from './infra/models/supportedModels';
export type { ChatMessage, ChatOptions, ChatResult } from './domain/chatMessage';
export type { RouteDecision, TaskType } from './domain/taskType';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | ApiKey 模型（多租户 Key 隔离） |
| `@aihub/observability` | `logger` |
| `openai` | OpenAI 协议 |
| `@anthropic-ai/sdk` | Anthropic 协议 |
| `@google/generative-ai` | Gemini 协议 |

**禁止依赖**：

- ❌ `chat` / `usage` / `projects`（aiCore 是底座）
- ❌ `news` / `rankings` / `bilibili`（业务感知在调用方）

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `chat` | `import { chat, calculateCost } from '@aihub/aiCore'` |
| `dailyBriefing` | `import { chat, chooseModel } from '@aihub/aiCore'` |
| `usage` | `import { calculateCost } from '@aihub/aiCore'` |
| `apps/web` | 直接消费（chat-style 配置驱动） |

---

## 7. 边界规则

1. ✅ `keyResolver` 是**唯一** ApiKey 解析入口（CLAUDE.md §3 强约束）—— 业务包不得直接读 env
2. ✅ dev 模式无 key 时走 mock，由 `devMock: true` 显式触发，**不依赖 NODE_ENV**
3. ✅ 模型白名单 `SUPPORTED_MODELS` 拒绝未注册模型（router.ts:68 已有 throw）
4. ⚠️ `chat()` 必须传 `tenantId`（用于 key 解析）—— BUG-002（chat.ts:108 缺 tenantId）
5. ❌ 禁止 Provider adapter 互相调用（依赖单向：router → provider）
6. ❌ 禁止在 aiCore 内 import `@/lib/news` 或 `@/lib/rankings`

---

## 8. 迁移步骤

```bash
# P2.2 第 2 周

mkdir -p packages/aiCore/src/{domain,infra/providers,infra/models,interface/server}
mkdir -p packages/aiCore/tests

# 拆分 providers.ts → providers/{openai,anthropic,gemini,deepseek,providerRegistry}.ts
cp src/lib/ai/router.ts packages/aiCore/src/interface/server/router.ts
cp src/lib/ai/key-resolver.ts packages/aiCore/src/infra/keyResolver.ts
cp src/lib/ai/pricing.ts packages/aiCore/src/infra/models/pricing.ts
cp src/lib/ai/models.ts packages/aiCore/src/infra/models/supportedModels.ts
cp src/lib/ai/chat-style.ts packages/aiCore/src/domain/chatStyle.ts

# 删除 client.ts（兼容占位已弃用）

# 替换全局 import
# @/lib/ai/router → @aihub/aiCore
# @/lib/ai/key-resolver → @aihub/aiCore
# @/lib/ai/pricing → @aihub/aiCore
# @/lib/ai/models → @aihub/aiCore
# @/lib/ai/chat-style → @aihub/aiCore

pnpm --filter @aihub/aiCore typecheck
pnpm --filter @aihub/aiCore test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| providers.ts 拆分后某 Provider 协议字段不一致 | 测试覆盖 4 个 Provider 的 chat 调用 |
| `client.ts` 删除被引用导致崩 | 迁前 grep 全部 import（应为空） |
| `keyResolver` 跨租户越权 | 强制 `tenantId` 入参；测试覆盖 |
| mock 路径在生产触发 | 把 `process.env.NODE_ENV` 判断改为显式 `AIHUB_AI_MOCK` |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/aiCore typecheck` 通过
- [ ] `pnpm --filter @aihub/aiCore test` 通过（4 Provider × mock/real）
- [ ] `pnpm dev` 后 chat 调用 → 走 mock（无 key）→ 日志可见
- [ ] 配置 ANTHROPIC_API_KEY 后 → 走 Anthropic 真协议
- [ ] 删除 `src/lib/ai/*` 后 chat 仍正常

---

## 11. 过期条件

- 引入新 Provider（如 Mistral / Cohere）
- 切换 LiteLLM 代理（scope-C 决策可能反转）
- 模型白名单变 schema-driven（从 DB 读取）
- 引入 token bucket 限流
- 加入 prompt caching

---

**创建时间**：2026-09-07
