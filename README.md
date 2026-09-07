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
- **B 站爬虫**：wbi 签名 + 登录态 cookie + 间隔节流，详见 [40-B站爬虫wbi签名cookie注入-修复报告.md](./docs/实施记录/40-B站爬虫wbi签名cookie注入-修复报告.md)

## 整合 v3 已交付（2026-08-30）

| 模块 | 状态 | 关键文件 |
|------|------|---------|
| 新闻聚合 | ✅ | `src/lib/news/service.ts`、`src/server/routers/news.ts` |
| 新闻 UI | ✅ | `src/app/(app)/news/page.tsx` |
| 新闻设置 | ✅ | `src/app/(app)/settings/page.tsx`（新闻频率 + 关注分类 + 关注源） |
| 模型排行 API | ✅ | `src/server/routers/rankings.ts` |
| 混合爬虫 | ✅ | `src/lib/rankings/scraper.ts`（OFFICIAL + AA + MANUAL） |
| 排行 UI | ✅ | `src/app/(app)/rankings/page.tsx`（Top3 + 帕累托图 + 表格） |
| 模型详情页 | ✅ | `src/app/(app)/rankings/[id]/page.tsx`（价格走势 + 相关新闻） |
| 侧边栏入口 | ✅ | `src/components/app-shell.tsx`（新闻 / 排行） |
| 性价比算法 | ✅ | `src/lib/rankings/algorithm.ts` |
| 算法单测 | ✅ | `src/lib/rankings/algorithm.test.ts`（13 个用例） |

### 验收结果

- ✅ `npx tsc --noEmit` 通过
- ✅ `npx prisma validate` 通过
- ✅ `npx tsx src/lib/rankings/algorithm.test.ts` 13/13 通过
- ✅ 数据互联：模型详情页通过 `relatedModels` 拉取相关新闻
- ✅ 自动发现：`scraper.discoverFromNews()` 从近 7 天新闻提取模型名
- ⚠️ 用量统计价格表当前来自 `PRICING_TABLE`（lib/ai/pricing.ts），未来可改为聚合 `rankings.list` 数据（见设计 §5.2）

## 边界

本骨架是 MVP，不包含：

- ❌ 实际 LiteLLM docker-compose（见 `部署运维.md §6`）
- ❌ 完整的 OAuth 回调 URL 注册（`.env.example` 留 placeholder，需在 GitHub Developer Settings 创建 OAuth App）
- ❌ Vitest / Playwright 完整测试套件（仅含算法单测）
- ❌ OpenTelemetry instrumentation 接线（依赖已加，实施留批次 C12）
- ❌ 模型爬虫的厂商专用解析器（OpenAI/Anthropic/DeepSeek 仅占位，生产需定制）

后续批次任务见 `design/批次C修复报告.md`。

