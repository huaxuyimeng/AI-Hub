# 04 · AI Key 库 + 对话风格系统

> **最后更新**：2026-09-04
> **代码状态**：AI Key 库 + 对话风格已完成；清理缓存（PPT/快照/R2）是未实施功能（见 §五）
> **设计依据**：`docs/archived/P0_API、对话与设置_2026.09.02.md` + `docs/archived/41-P0施工方案_2026.09.02.md`

---

## 一、模块组成

本模块由两个独立子系统组成：

| 子系统 | 核心文件 | 功能 |
|--------|---------|------|
| **AI Key 库** | `providers.ts` + `key-resolver.ts` + `ai-keys.ts` | 12 个 Provider 的 API Key 管理 + 测试连接 |
| **对话风格** | `chat-style.ts` + `preferences.ts` 扩展 + `chat.ts` 改动 | system prompt 构建 + 6 字段注入 |

---

## 二、AI Key 库

### 2.1 架构决策

| 决策 | 选项 | 说明 |
|------|------|------|
| 协议 | proto-A 混合 | OpenAI 兼容 + Anthropic SDK + Gemini SDK |
| Key 解析 | keypool-A | DB 优先 → env 兜底 |
| 测试连接安全 | sec-A | rate limit + sanitize + logger redact |

### 2.2 Provider 适配器（`src/lib/ai/providers.ts`，228 行）

**12 个 Provider**：

| # | ID | displayName | 协议 | 状态 |
|---|----|-----------|------|------|
| 1 | `deepseek` | DeepSeek | OpenAI | ✅ 完整 |
| 2 | `zhipu` | 智谱 GLM | OpenAI | ✅ 完整 |
| 3 | `openai` | OpenAI | OpenAI | ✅ 完整 |
| 4 | `anthropic` | Anthropic | Anthropic SDK | ✅ 完整 |
| 5 | `gemini` | Google Gemini | Gemini SDK | ✅ 完整 |
| 6 | `ollama` | Ollama 本地 | OpenAI | ✅ 完整 |
| 7 | `xai` | xAI Grok | OpenAI | ⏳ stub |
| 8 | `mistral` | Mistral | OpenAI | ⏳ stub |
| 9 | `qwen` | 阿里 Qwen | OpenAI | ⏳ stub |
| 10 | `doubao` | 字节豆包 | OpenAI | ⏳ stub |
| 11 | `kimi` | 月之暗面 Kimi | OpenAI | ⏳ stub |
| 12 | `hunyuan` | 腾讯混元 | OpenAI | ⏳ stub |

**stub 策略**：6 个 stub 的 `testConnection` 抛出 `'暂未适配，留 TODO'`，UI 上标灰 + 徽标，不阻断。

**dev-mode mock**：开发环境无 key 时，`testConnection` 返回 `{ ok: true, latencyMs: 0 }`（不真正发请求）。

### 2.3 Key 解析（`src/lib/ai/key-resolver.ts`，97 行）

```ts
// 优先级：用户直接传入 > DB 加密存储 > env 环境变量
async function resolveApiKey(tenantId, provider, opts?):
  1. opts.userApiKey → 返回（优先级最高）
  2. DB ApiKey 表 → decrypt(encryptedKey) → 返回
  3. env DEEPSEEK_API_KEY / ZHIPU_API_KEY 等 → 返回（system 兜底）
```

**安全设计**：
- DB 只存 `encryptedKey`（AES-256-GCM 加密，密钥是 `APP_SECRET`）
- 即使 DB 被读，没有 `APP_SECRET` 也无法还原 key
- 同时存 `keyHash`（SHA-256）用于校验用户输入

### 2.4 tRPC 路由（`src/server/routers/ai-keys.ts`，192 行）

| Procedure | 类型 | 说明 |
|-----------|------|------|
| `list` | `protectedProcedure` | 列出本租户所有 key（不含明文） |
| `create` | `protectedProcedure` | 创建 key（明文只返回一次） |
| `revoke` | `protectedProcedure` | 软删除 key |
| `test` | `protectedProcedure` | 测试连接（真发请求，限 5 次/分钟） |
| `providers` | `protectedProcedure` | Provider 列表（不含密钥） |

**测试连接安全（sec-A）**：
- Rate limit：每 user 每分钟 5 次（用 Upstash Redis，fail-open）
- Error sanitize：`sanitizeError()` 移除 `sk-...`、`AIza...` 等 key 片段
- Logger redact：明文 key 不出现在结构化日志

---

## 三、对话风格系统

### 3.1 架构决策

| 决策 | 选项 | 说明 |
|------|------|------|
| 作用域 | style-A（仅 chat） | news / briefing / analysis 不注入 |
| 历史兼容 | hist-A | system prompt 仅在内存，不写 DB |
| 注入时机 | 每次 `sendMessage` 前 | 历史对话不重写 |

### 3.2 数据库字段（`prisma/schema.prisma`，`UserPreferences`）

```prisma
/// 预设风格: rigorous | humorous | friendly | concise | literary
chatPresetStyle     String   @default("friendly")
/// 自定义开场白
chatOpeningLine     String?
/// 角色设定
chatPersonaRole     String?
/// 用户自定义规则（每行一条）
chatCustomRules     String   @default("")
/// 回复语言: zh | en | auto
chatResponseLang    String   @default("auto")
/// 思考深度: normal | detailed | none
chatReasoningDepth  String   @default("normal")
```

### 3.3 System Prompt 构建（`src/lib/ai/chat-style.ts`，116 行）

```ts
buildSystemPrompt(prefs): string {
  // 1. 预设风格（默认 friendly）
  parts.push(PRESET_STYLE_PROMPTS[prefs.chatPresetStyle ?? 'friendly'])
  // 2. 自定义开场白（max 500 字）
  // 3. 角色设定（max 500 字）
  // 4. 语言偏好（zh/en/auto）
  // 5. 思考深度（normal/detailed/none）
  // 6. 自定义规则（max 2000 字，每行一条）
  return parts.join('\n\n')
}
```

**安全约束**：
- 所有字段有 max 长度限制（prompt 注入防御）
- `escapeForPrompt()` 转义用户输入中的特殊字符
- `MAX_TOTAL_PROMPT = 8000`（safety guard）

### 3.4 tRPC 路由（`preferences.ts` 扩展）

| Procedure | 类型 | 说明 |
|-----------|------|------|
| `getChatStyle` | `protectedProcedure` | 读取 6 字段 |
| `updateChatStyle` | `protectedProcedure` | 更新 6 字段（字段级更新） |

### 3.5 注入时机（`src/server/routers/chat.ts`）

```ts
// sendMessage mutation，每次发消息前注入
const prefs = await prisma.userPreferences.findUnique({
  where: { userId },
  select: { chatPresetStyle, chatOpeningLine, chatPersonaRole, chatCustomRules, chatResponseLang, chatReasoningDepth },
})
const systemPrompt = buildSystemPrompt(prefs)
const historyWithSystem = [
  { role: 'system', content: systemPrompt },
  ...history.slice(0, 49),  // MAX_HISTORY = 50
]
const resp = await chat(modelName, historyWithSystem, { temperature, maxTokens })
```

---

## 四、AI Client 架构（`src/lib/ai/router.ts`，230 行）

### 4.1 架构说明

**已替换 LiteLLM**：当前 `src/lib/ai/client.ts` 是占位兼容导出，实际调用走 `router.ts` 的多协议分发。

**支持的协议**：
- OpenAI 兼容（`openai` 包）：deepseek / zhipu / openai / ollama / xai / mistral / qwen / doubao / kimi / hunyuan
- Anthropic（`@anthropic-ai/sdk`）：claude 系列
- Gemini（`@google/generative-ai`）：gemini 系列

### 4.2 chat() 入口签名

```ts
// src/lib/ai/router.ts
export async function chat(
  model: string,              // e.g. 'deepseek-v4-flash'
  tenantId: string,           // 用于 resolveApiKey
  messages: ChatMessage[],
  options?: {
    temperature?: number
    maxTokens?: number
    /** dev mode 下没有 key 时是否走 mock（默认 true） */
    devMock?: boolean
  }
): Promise<ChatResult>

export interface ChatResult {
  content: string
  usage: { input: number; output: number }
}
```

**dev-mode mock**（关键安全策略）：开发环境无 key 时，调用 `resolveApiKey` 发现 `source = 'system'` 且 `apiKey` 不存在时，**返回占位 mock，不真正调用 provider**。生产环境必须配 key。

### 4.3 模型命名（model-A 决策）

| 旧名（已废弃） | 新名（统一） | Provider |
|---------------|------------|---------|
| `deepseek-chat` | `deepseek-v4-flash` | DeepSeek |
| `moonshot-v1-8k` | `glm-4-7-flash` | 智谱 |
| `claude-sonnet-4-20250514` | `claude-sonnet-4-5` | Anthropic |
| `gpt-4o-mini` | 保留（已是标准名）| OpenAI |

> ⚠️ 数据库里已有的 `Message.model` 字段是字符串（无外键），存量数据不会被破坏，但前端显示可能不一致。

---

## 五、清理缓存功能（未实施）

> ⚠️ 以下是设计文档（`docs/archived/41-P0施工方案_2026.09.02.md` §3）中描述的功能，**代码中尚未实现**。

### 5.1 设计目标

**只清理可重建的临时产物**，绝不删除用户内容（新闻、对话、收藏、早报正文）。

### 5.2 待建功能

| # | 功能 | 说明 |
|---|------|------|
| 1 | PPT 早报缓存清理 | `DailyReport.pptxBase64` 可重建，清理一周前 |
| 2 | 模型快照清理 | `ModelSnapshot` 每个模型保留最新 3 条 |
| 3 | R2 孤儿文件扫描 | 已上传但未被引用的 R2 文件 |
| 4 | 锁定机制 | `DailyReport.locked` 字段，锁定后永不清理 |
| 5 | 清理日志 | 记录最近 5 次清理操作 |

### 5.3 Schema 改动（未实施）

```prisma
// DailyReport 新增（未实施）
locked Boolean @default(false)

// 建议的 tRPC router（未实施，不是 Prisma model）
// src/server/routers/cache-clean.ts（建议命名）
cacheCleanRouter = router({
  stats:        // 各类缓存大小统计
  cleanPpt:     // 清理 PPT 缓存
  cleanSnapshots: // 清理旧快照
  scanOrphanR2: // 扫描孤儿文件
  setLocked:    // 切换锁定状态
})
```

### 5.4 实施依赖

- `src/features/daily-briefing/` 里已有 `pptxBase64` 字段
- 需要新建 `src/server/routers/cache-clean.ts`（当前 `cleanup.ts` 是磁盘清理，不是 AI 缓存）
- R2 孤儿文件扫描需要 R2 配置

---

## 六、文件索引

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/lib/ai/providers.ts` | 228 | 12 个 Provider 适配器工厂 |
| `src/lib/ai/key-resolver.ts` | 97 | API Key 解析（DB → env） |
| `src/lib/ai/chat-style.ts` | 116 | System prompt 构建 |
| `src/lib/ai/router.ts` | 230 | 多协议 chat() 分发（OpenAI / Anthropic / Gemini） |
| `src/lib/ai/client.ts` | 20 | 兼容占位导出（LiteLLM → Direct 迁移过渡） |
| `src/server/routers/ai-keys.ts` | 192 | AI Key 管理（list/create/revoke/test/providers） |
| `src/server/routers/chat.ts` | 181 | 对话（send/history）+ system prompt 注入 |
| `src/server/routers/preferences.ts` | 247 | 用户偏好（扩展 getChatStyle / updateChatStyle） |
| `src/server/routers/cleanup.ts` | 80 | ⚠️ 磁盘清理（非 AI 缓存）|

---

## 七、相关文档

| 文档 | 说明 |
|------|------|
| `docs/archived/P0_API、对话与设置_2026.09.02.md` | 原始需求 + 9 项决策记录 |
| `docs/archived/41-P0施工方案_2026.09.02.md` | 28 步施工方案（含清理缓存功能） |
| `docs/archived/实施记录复盘报告-2026-09-02.md` | Phase 2 复盘 + 未闭环事项 |
