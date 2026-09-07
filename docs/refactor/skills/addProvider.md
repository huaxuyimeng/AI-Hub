---
name: addProvider
description: 新增 AI Provider（OpenAI / Anthropic / Gemini / DeepSeek / ...）到 @aihub/aiCore 包。在用户提到「加个 AI 提供商」「支持 Mistral」「接入 Cohere」时必须触发。绝不直接改 router.ts——必须先按 §1 流程产出改动报告让用户拍板。
---

# Add Provider Skill

## 1. 调用流程（严格顺序）

### Phase 1：调研（必做）

1. 读 `src/lib/ai/router.ts`、`providers.ts`、`models.ts`、`pricing.ts`、`key-resolver.ts`
2. 列出当前支持的 4 个 Provider 的实现模式
3. 列出新 Provider 的协议差异（OpenAI 兼容 / Anthropic 原生 / Gemini 原生）

### Phase 2：方案产出

输出 4 段式报告：

1. **Provider 元信息**：name / baseUrl / auth 方式 / 协议类型 / SDK 包名
2. **协议适配策略**：复用 OpenAI 兼容 vs 自研 adapter
3. **定价表占位**：从 Provider 官方文档摘 input/output 价格
4. **风险**：SDK 包依赖、协议差异、限流

### Phase 3：实施

- 抽 adapter 到 `packages/aiCore/src/infra/providers/<name>.ts`
- 注册到 `providerRegistry.ts`
- 加模型到 `supportedModels.ts`
- 加定价到 `pricing.ts`

## 2. 命名规范

- 文件名：`<providerName>.ts`（驼峰）
- adapter 名：`getProviderAdapter('<name>')`
- 模型白名单 key：`<provider>/<model>`（如 `anthropic/claude-4-sonnet`）

## 3. 验收清单

- [ ] adapter 单测覆盖 happy path + 4xx + 5xx
- [ ] pricing 与官方文档一致（带链接注释）
- [ ] 在 SUPPORTED_MODELS 注册新模型
- [ ] `pnpm test:rankings` 跑通

## 4. 过期条件

- Provider 协议变更
- 定价表 schema 变更（迁到 DB 驱动）
- 引入 LiteLLM 代理（scope-C 决策反转）

---

**创建时间**：2026-09-07
