# AIHub —— 毕业设计 MVP 骨架

## 来源

本骨架由 `d:\1Money\design\` 下的批次 A/S/P/B 设计文档直接生成：

| 文件 / 目录 | 来源文档 |
|------------|---------|
| `prisma/schema.prisma` | `数据库设计.md §三 + §十` |
| `src/lib/db.ts` | `数据库设计.md §4.2 + §10` |
| `src/lib/crypto.ts` | `API设计.md §4.4.1`（B7 补全） |
| `src/lib/sanitize.ts` | `数据库设计.md §10.4` |
| `src/lib/lifecycle.ts` | `数据库设计.md §10.7` |
| `src/lib/cleanup.ts` | `部署运维.md §11.1` |
| `src/lib/usage.ts` | `AI集成.md §10.1`（Fix-1 修复后） |
| `src/lib/ai/*` | `AI集成.md §三 §四 §五 §七`（B8 / B9） |
| `src/server/routers/*` | `API设计.md §二`（B6 软删除） |
| `src/app/api/cron/cleanup/route.ts` | `部署运维.md §11.1`（B13） |

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（复制 .env.example 为 .env 并填值）
cp .env.example .env

# 3. 初始化数据库
pnpm db:migrate

# 4. 启动开发
pnpm dev
```

## 关键设计

- **多租户**：`createTenantPrisma(ctx)` 强制注入 `tenantId` + `deletedAt: null`
- **软删除**：白名单内 9 个模型（User / Project / ApiKey / Conversation / Score / InstalledPlugin / PluginAuditLog / UsageStat）含 `deletedAt`
- **AI 路由**：LiteLLM 统一暴露，路由策略见 `src/lib/ai/router.ts`
- **Cron**：单一 `cleanupOrphanFiles()`，三处共用（API / script / cron route）

## 边界

本骨架是 MVP，不包含：

- ❌ 真正的项目页 / 分析页 / 对话页 UI（仅 Dashboard 占位）
- ❌ 实际 LiteLLM docker-compose（见 `部署运维.md §6`）
- ❌ 完整的 OAuth 回调 URL 注册（`.env.example` 留 placeholder，需在 GitHub Developer Settings 创建 OAuth App）
- ❌ Vitest / Playwright 测试（批次 C5 引入）
- ❌ OpenTelemetry instrumentation 接线（依赖已加，实施留批次 C12）

后续批次任务见 `design/批次C修复报告.md`。

