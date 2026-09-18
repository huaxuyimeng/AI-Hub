# AIHub

> AIHub 是一个毕业设计 MVP 平台，把四类 AI 内容工作流收拢在一个工作台里。
> 骨架由 `d:\1Money\design\` 下的批次 A/S/P/B 设计文档直接生成（见下方"骨架来源"）。

## 项目简介

**AIHub = AI 工作台（Workbench） + AI 早报自动生成 + 多源 AI 信息聚合**

为独立开发者 / 内容创作者 / AI 行业从业者打造的「一站式 AI 信息中枢」：

- **AI 新闻聚合**：自动抓取 10+ 中英文 AI 资讯源（机器之心 / 量子位 / AIbase / Unite.AI / Hacker News / 36kr 等），按置信度 + 来源质量 + 厂商标签三维度评分；支持 RSS / HTML / API 三类解析器
- **AI 模型排行**：基于"能力 + 价格 + 上下文窗口"的加权算法 + Pareto 前沿筛选，每日更新；支持 50+ 模型横向对比
- **B 站 UP 主追踪**：WBI 签名 + 登录态 cookie 破解 + RSS 兜底，抓取指定 UP 主的视频 + 字幕，支持字幕语义分析
- **AI 早报（PPT）**：每日定时任务拉取最新新闻 → 大模型生成简报 JSON → 经过 lint 校验 → 渲染成可下载的 PPTX；用户可一键生成"今日 AI 行业 PPT"

**核心差异化**：
- 自研 slide-engine（基于 PPTX 模板 + IR 中间表示 + lint 规则），保证 PPT 生成质量
- 多租户架构 + 软删除 + RBAC，单实例支持多个团队
- 全量 TypeScript + tRPC 端到端类型安全 + Prisma 6 + Next.js 14 App Router

**定位**：毕业设计 MVP（已上线 https://github.com/huaxuyimeng/AI-Hub），可作为个人 AI 工具箱使用

## 四大模块

| 模块 | 状态 | 关键文件 |
|------|------|---------|
| **AI 新闻聚合** | ✅ | `src/lib/news/service.ts`、`src/server/routers/news.ts`、`src/app/(app)/news/page.tsx` |
| **AI 模型排行** | ✅ | `src/lib/rankings/`、`src/server/routers/rankings.ts`、`src/app/(app)/rankings/page.tsx` |
| **B 站 UP 主追踪** | ✅ | `src/lib/bilibili/`（wbi 签名 + 登录态 cookie + 字幕抓取） |
| **AI 早报 (PPT)** | ✅ | `src/features/daily-briefing/`（每日自动生成可下载 PPT） |

## 技术栈

- **前端**：Next.js 14 (App Router) + TypeScript 5
- **API**：tRPC 11（端到端类型安全）
- **数据库**：Prisma 6 + PostgreSQL（dev 退化为 SQLite）
- **存储**：Cloudflare R2（文件）+ Upstash Redis（缓存 / 速率限制）
- **AI 路由**：LiteLLM Proxy + 多 Provider 直连（DeepSeek / 智谱 / Anthropic / Kimi）
- **样式**：CSS 变量主题系统（6 套预设 + HSL DIY） + `@tabler/icons-react`
- **鉴权**：NextAuth.js（GitHub OAuth + 本地开发默认账号）

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 必填：DATABASE_URL、NEXTAUTH_SECRET、CRON_SECRET、至少一个 AI Provider Key
# 推荐：R2 存储、Upstash Redis、B 站 SESSDATA（爬虫）

# 3. 初始化数据库
pnpm prisma migrate dev

# 4. 启动开发服务
pnpm dev
# → http://localhost:3000
```

## 目录结构

```
aihub/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── (app)/           #   已登录工作台（/news、/rankings、/projects、/meeting）
│   │   ├── api/             #   REST 端点（cron / upload / news）
│   │   └── privacy/ terms/  #   合规页面
│   ├── components/          # 共享 UI（app-shell、theme-*、news/*、rankings/*、chat/*）
│   ├── features/            # 业务模块（daily-briefing PPT 引擎等）
│   ├── lib/                 # 核心库
│   │   ├── ai/              #   LiteLLM 路由、key 解析、模型发现
│   │   ├── news/            #   多源抓取、意图搜索、健康度
│   │   ├── bilibili/        #   wbi 签名 + cookie + 字幕
│   │   ├── slide-engine/    #   PPT 早报 IR
│   │   ├── rankings/        #   算法 + 抓取 + 调度
│   │   └── observability/   #   日志 + 监控
│   └── server/              # tRPC routers + 上下文
├── prisma/                  # schema / migrations / seed
├── landing/                 # 静态产品演示页
├── docs/                    # 设计文档 / 实施记录 / 架构图 / 评审清单
└── public/                  # 静态资源
```

## 关键设计

- **多租户**：`createTenantPrisma(ctx)` 强制注入 `tenantId`，缺失即拒绝
- **软删除**：白名单内 9 个模型（User / Project / ApiKey / Conversation / Score / InstalledPlugin / PluginAuditLog / UsageStat）含 `deletedAt`
- **AI Key 解析**：唯一入口 `src/lib/ai/key-resolver.ts`，组件禁止直接读 env
- **颜色系统**：所有色值走 `src/app/globals.css` 的 CSS 变量，禁止硬编码 `#xxx`
- **图标**：统一 `@tabler/icons-react`
- **Cron**：单一 `cleanupOrphanFiles()`，三处共用（API route / script / cron route）
- **B 站爬虫**：wbi 签名 + SESSDATA cookie + 节流；详见 `docs/实施记录/40-B站爬虫wbi签名cookie注入-修复报告.md`

## 骨架来源（批次 A/S/P/B）

| 文件 / 目录 | 设计文档 |
|------------|---------|
| `prisma/schema.prisma` | `数据库设计.md §三 + §十` |
| `src/lib/db.ts` | `数据库设计.md §4.2 + §10` |
| `src/lib/ai/*` | `AI集成.md §三 §四 §五 §七` |
| `src/server/routers/*` | `API设计.md §二` |
| `src/app/api/cron/cleanup/route.ts` | `部署运维.md §11.1` |
| `src/lib/bilibili/*` | `B站爬虫wbi签名cookie注入-修复报告.md` |

## 整合 v3 交付状态（2026-08-30）

| 模块 | 状态 | 备注 |
|------|------|------|
| 新闻聚合 + UI + 设置 | ✅ | 多源抓取 + 意图搜索 + 关注分类 |
| 模型排行 API + UI + 详情页 | ✅ | Top3 + 帕累托图 + 价格走势 |
| 混合爬虫（OFFICIAL + AA + MANUAL） | ✅ | `src/lib/rankings/scraper.ts` |
| 自动发现（从近 7 天新闻提取模型名） | ✅ | `scraper.discoverFromNews()` |
| 性价比算法 + 单测 | ✅ | `src/lib/rankings/algorithm.test.ts` 13/13 |
| 用量统计 + 价格表 | ✅ | `src/lib/usage.ts` + `PRICING_TABLE` |
| 数据互联（模型详情 → 相关新闻） | ✅ | `relatedModels` |

## 开发命令

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 启动开发服务 |
| `pnpm build` | 生产构建 |
| `pnpm typecheck` | 全量类型检查 |
| `pnpm test:rankings` | 模型排行算法单测 |
| `pnpm test:usage` | 用量计费单测 |
| `pnpm test:slides` | 早报 IR 单测 |
| `pnpm slide:lint` | 早报 IR lint |

## 边界（MVP 不包含）

- ❌ LiteLLM docker-compose 模板（见 `部署运维.md §6`）
- ❌ GitHub OAuth App 注册（需在 GitHub Developer Settings 自行创建）
- ❌ 完整 Vitest / Playwright 套件（仅含算法与早报单测）
- ❌ OpenTelemetry 接线（依赖已加，实施留待后续批次）
- ❌ 模型爬虫的厂商专用解析器（OpenAI / Anthropic / DeepSeek 仅占位）

## 安全说明

本仓库**绝不包含**真实凭据：

```bash
# 克隆后必须自行生成
openssl rand -base64 32   # → NEXTAUTH_SECRET
openssl rand -hex 32      # → CRON_SECRET
```

所有密钥、cookie、session token 必须放在本地 `.env`（已被 `.gitignore` 拦截）。

## 许可

[MIT](./LICENSE) © 2026 AIHub Authors
