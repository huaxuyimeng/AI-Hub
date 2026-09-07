# b09-pseudoTenantSystem.md · BUG-09 高危：伪租户 'system' 把字符串当 tenantId

> 创建于 2026-09-07
> 严重性：🔴 高危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：`chat('gpt-4o-mini', 'system', ...)` 硬编码 `'system'` 作为 tenantId
- **证据**：`src/lib/news/intent-search.ts:184-187`、`src/lib/news/news-intent.ts:237-239`
- **为什么可能是它**：`resolveApiKey(tenantId, provider, opts)` 里按 tenantId 查 `ApiKey` 表，`'system'` 字符串不是任何有效 tenantId → 查不到 key → fall through 到 env → 无 env 时直接报"未配置 API Key"
- **如何验证**：无 env key 时跑意图搜索 → 看是否抛出"未配置 API Key"
- **修复思路**：chat() 增加 `tenantId: null` 系统级调用通道（直接走 env key）

---

## 候选根因 #2（可能性：中）

- **现象**：意图搜索失败时降级路径未生效
- **证据**：同文件，检查降级 try-catch
- **为什么可能是它**：即使修好了 key 解析，降级失败时整个搜索崩
- **如何验证**：mock API key 为空 → 看意图搜索行为
- **修复思路**：确保 `chat()` throw 后 intent-search 捕获并回退到字面搜索

---

## 修复方案（选 #1）

```ts
// src/lib/ai/router.ts — chat() 函数签名
// 改前：
export async function chat(
  model: string,
  tenantId: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
)

// 改后：tenantId 可为 null（系统级调用）
export async function chat(
  model: string,
  tenantId: string | null,   // null = 系统调用，走 env key
  messages: ChatMessage[],
  options: ChatOptions = {}
)

// 内部逻辑调整：
// if (tenantId === null) {
//   // 系统级调用：仅用 env key，不查 DB
//   resolvedKey = process.env.DEEPSEEK_API_KEY;
// } else {
//   resolvedKey = await resolveApiKey(tenantId, ...);
// }

// 调用方调整（intent-search.ts / news-intent.ts）：
// chat(model, null, ...)   // 不要 chat(model, 'system', ...)
```

---

## 风险

- 意图搜索调用方（2 个文件）需同步改
- 降级路径需验证（确保 chat 失败时走字面搜索）

---

## 回归测试

| 场景 | 预期 |
|---|---|
| 无 env key 时意图搜索 | 回退到字面搜索，不报错 |
| 有 env key 时意图搜索 | 走真实 LLM 调用 |
| 有 DB key 时意图搜索 | 走 DB key（tenantId 有值） |

---

**创建时间**：2026-09-07
