# AIHub

> **AI 工作台 + AI 早报自动生成 + 多源信息聚合** —— 把 AI 内容工作流收拢在一个界面里。

[简体中文](./README-zh.md) · [English](./README.md)

---

## 一句话介绍

**让 AI 帮你追 AI 资讯、自动做早报、比价格、追 B 站**，不用在十几个工具之间切换。

---

## 项目特色

- **一站式工作台** — 新闻聚合、模型排行、B 站追踪、AI 早报、多智能体会议，五大功能统一界面
- **多源新闻聚合** — 自动抓取 10+ 中英文 AI 资讯源，按置信度 × 来源质量 × 厂商标签三维度评分
- **性价比算法模型排行** — Pareto 前沿加权（能力 40% + 价格 30% + 上下文窗口 30%），每日更新，50+ 模型
- **B 站 UP 主追踪** — WBI 签名逆向 + SESSDATA Cookie 登录 + RSS 兜底，支持字幕语义分析
- **PPT 早报流水线** — 每日 cron → LLM 生成 JSON → IR lint 校验 → PPTX 导出，自研 slide-engine
- **多角色 AI 会议** — 基于 LangChain / LangGraph，多智能体（产品经理 / 工程师 / 投资者 / 评论家）讨论，SSE 流式输出
- **多租户 + RBAC** — `createTenantPrisma(ctx)` 强制注入 tenantId；白名单内 9 个模型含软删除
- **全量 TypeScript** — tRPC 端到端类型安全，前端→后端→数据库零隐式 any
- **AI Key 智能路由** — 单一入口 `key-resolver.ts`，多 Provider（DeepSeek / 智谱 / Anthropic / Kimi）自动降级
- **生产级工程化** — 180+ 测试用例，typecheck 零错误，文档完备

---

## 技术栈

### 前端
| 技术 | 版本 | 说明 |
|------|------|------|
| Next.js | 14 | App Router |
| TypeScript | 5 | 全量类型 |
| React | 18 | Server + Client Components |
| tRPC | 11 | 端到端类型安全 API |
| Tailwind / CSS 变量 | - | 6 套预设主题 + HSL DIY |
| @tabler/icons-react | - | 统一图标库 |

### 后端
| 技术 | 版本 | 说明 |
|------|------|------|
| tRPC | 11 | 类型安全 RPC |
| Prisma | 6 | ORM + 多租户 |
| NextAuth.js | 5 | GitHub OAuth + 本地开发默认账号 |
| LangChain | - | 流式批处理 |
| LangGraph | - | 多智能体状态机 |
| LiteLLM | - | AI 路由 + 多 Provider |

### 存储 / 基础设施
| 技术 | 说明 |
|------|------|
| PostgreSQL | 生产环境 |
| SQLite | 开发环境 |
| Cloudflare R2 | 文件存储（PPTX、头像） |
| Upstash Redis | 缓存 + 速率限制 |
| Cron Jobs | 每日早报 + 清理 |

---

## 一句话简介

AIHub 是一个个人级 AI 信息平台，把 **新闻聚合 / 模型排行 / B 站 UP 主追踪 / PPT 自动早报 / 多智能体会议** 五件事收拢在一个工作台里。

**全量技术栈**：前端 Next.js 14 (App Router) + React 18 + TypeScript 5；后端 tRPC 11（端到端类型安全）+ Prisma 6 ORM；存储 PostgreSQL（开发退化为 SQLite）+ Cloudflare R2（文件）+ Upstash Redis（缓存/速率限制）；AI 路由走 LiteLLM Proxy，同时直连 DeepSeek / 智谱 / Anthropic / Kimi 多 Provider；鉴权用 NextAuth.js（GitHub OAuth + 本地开发默认账号）；UI 用基于 CSS 变量的主题系统（6 套预设 + HSL DIY）+ `@tabler/icons-react` 图标库。

**定位**：毕业设计 MVP（已上线 https://github.com/huaxuyimeng/AI-Hub），可作为个人 AI 工具箱使用。

---

## 项目结构

```
aihub/
├── src/
│   ├── app/                  # Next.js App Router 页面
│   │   ├── (app)/           #   工作台：/news /rankings /meeting /projects
│   │   ├── api/             #   REST 端点（cron / upload / news）
│   │   └── privacy/ terms/  #   合规页面
│   ├── components/          # 共享 UI（app-shell、theme-*、news/*、rankings/*）
│   ├── features/            # 业务模块（daily-briefing PPT 引擎等）
│   ├── lib/                 # 核心库
│   │   ├── ai/              #   LiteLLM 路由 / key 解析 / 模型发现 / LangChain
│   │   ├── news/            #   多源抓取 / 意图搜索 / 健康度
│   │   ├── bilibili/        #   WBI 签名 / Cookie / 字幕
│   │   ├── rankings/        #   算法 / 爬虫 / 调度
│   │   ├── slide-engine/    #   PPT IR / lint / 渲染
│   │   ├── meeting/         #   LangGraph 状态机 / 节点 / 流式
│   │   └── observability/   #   日志 / 监控
│   └── server/              # tRPC routers + 上下文（多租户 / RBAC）
├── prisma/                  # schema / migrations / seed
├── landing/                 # 静态产品演示页
├── docs/                    # 设计文档 / 实施记录
└── public/                  # 静态资源
```

---

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+（或开发环境用 SQLite）
- （可选）Cloudflare R2 账号
- （可选）Upstash Redis 账号
- （可选）B 站 SESSDATA Cookie

### 一、初始化数据库

```bash
# 选项 A：开发环境使用 SQLite
# .env.example 中的默认 DATABASE_URL 指向本地 SQLite

# 选项 B：使用 PostgreSQL
createdb aihub
psql -d aihub -f prisma/seed.sql
```

### 二、安装依赖

```bash
pnpm install
```

### 三、配置环境变量

```bash
cp .env.example .env
```

必填变量：
- `DATABASE_URL` — 数据库连接
- `NEXTAUTH_SECRET` — NextAuth session 加密
- `CRON_SECRET` — Cron 端点鉴权

推荐变量：
- 至少一个 AI Provider Key（DeepSeek / 智谱 / Anthropic / Kimi）
- `R2_*` — Cloudflare R2 文件存储
- `UPSTASH_*` — Upstash Redis 缓存
- `BILIBILI_SESSDATA` — B 站爬虫登录态

### 四、运行数据库迁移

```bash
pnpm prisma migrate dev
```

### 五、启动开发服务

```bash
pnpm dev
# → http://localhost:3000
```

---

## 测试账号

| 用户名 | 密码 | 角色 | 说明 |
|--------|------|------|------|
| `admin@local` | `admin123` | 管理员 | 全部权限 |
| `user@local` | `user123` | 普通用户 | 工作台权限 |

运行 `pnpm seed` 填充演示数据（见 `prisma/seed.ts`）。

---

## API 接口概览

### 新闻
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/news.list` | 新闻列表（支持来源、分类、置信度筛选） |
| GET | `/api/news.byId` | 新闻详情 |
| POST | `/api/news.refresh` | 手动触发抓取 |

### 模型排行
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/rankings.list` | 按加权分数返回 Top 模型 |
| GET | `/api/rankings.byModel` | 模型详情 + 价格走势 |
| POST | `/api/rankings.refresh` | 每日爬虫触发 |

### 早报
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/briefing.generate` | 生成今日 PPT |
| GET | `/api/briefing.history` | 历史早报 |

### 会议（多智能体）
| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/meeting.create` | 创建会议并指定参与者 |
| GET | `/api/meeting.stream` | SSE 流式输出 |
| POST | `/api/meeting.conclude` | 结束会议 |

### B 站
| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/bilibili.followed` | 已关注 UP 主列表 |
| POST | `/api/bilibili.refresh` | 刷新视频 + 字幕 |

完整接口文档见 `docs/API.md`。

---

## 安全机制

- **多租户隔离** — 所有 DB 调用经 `createTenantPrisma(ctx)` 强制注入 `tenantId`，缺失即拒绝
- **RBAC 权限控制** — 前端路由守卫 + 后端拦截器，三类角色（USER / 类商家 / ADMIN）
- **软删除** — 白名单内 9 个模型含 `deletedAt`（User / Project / ApiKey / Conversation / Score / InstalledPlugin / PluginAuditLog / UsageStat）
- **AI Key 解析** — 单一入口 `src/lib/ai/key-resolver.ts`，组件禁止直接读 env
- **Cron 鉴权** — 所有 cron 端点要求 `CRON_SECRET` 请求头
- **统一错误处理** — tRPC error formatter 把内部错误映射为安全消息
- **CORS 白名单** — 仅放行明确的前端源，生产环境不开通通配符

---

## 生产部署必读

部署到生产前，**必须**修改：

**环境变量：**
- `NEXTAUTH_SECRET` — 至少 32 位随机字符串
- `CRON_SECRET` — 至少 32 位随机字符串
- `DATABASE_URL` — 使用强密码
- AI Provider Keys — 定期轮换

**安全加固：**
- 启用 HTTPS，关闭 HTTP
- 删除演示账号（`admin@local`、`user@local`）
- 配置 CORS 白名单为你的真实前端域名
- 复查 `.env.example` 是否泄露了任何真实密钥（理论上不应有）

生成密钥：
```bash
openssl rand -base64 32   # → NEXTAUTH_SECRET
openssl rand -hex 32      # → CRON_SECRET
```

---

## 二次开发指南

### 新增一个模块（示例：AI 工具目录）

**1. 数据库**
- 在 `prisma/schema.prisma` 添加 model
- 运行 `pnpm prisma migrate dev --name add-tool-directory`

**2. 后端（tRPC）**
- 在 `src/server/routers/tools.ts` 创建 router
- 在 `src/server/router.ts` 注册

**3. 前端（App Router）**
- 在 `src/app/(app)/tools/page.tsx` 创建页面
- 在 `src/components/app-shell/nav-config.ts` 添加导航条目

**4. 测试**
- 在 `src/lib/tools/__tests__/` 添加单元测试
- 在 `src/server/routers/tools.test.ts` 添加集成测试

### 调试技巧

- 后端日志：`src/lib/observability/logger.ts` — AI 调用 debug 级别
- 类型检查：`pnpm typecheck`
- 单文件测试：`npx tsx src/path/to/file.test.ts`

---

## 测试覆盖

| 测试套件 | 用例数 |
|---------|-------|
| typecheck | 0 错误 |
| 模型排行算法 | 全部通过 |
| 用量计费 | 全部通过 |
| PPT 早报 IR | 59/59 |
| Meeting Graph 状态机 | 47/47 |
| LangChain 流式批处理 | 20/20 |
| Meeting Router 集成 | 28/28 |
| Chat Router | 19/19 |
| Server Context（P0 防护） | 4/4 |
| Briefing 后处理器 | 16/16 |

运行全部测试：
```bash
pnpm typecheck
npx tsx src/lib/rankings/algorithm.test.ts
npx tsx src/lib/meeting/__tests__/meeting-graph.test.ts
npx tsx src/lib/ai/__tests__/langchain-stream.test.ts
npx tsx src/server/context.test.ts
```

---

## 构建部署

### 前端构建
```bash
pnpm build
# 产物：.next/ 目录
```

### Docker（可选）
```bash
docker build -t aihub .
docker run -p 3000:3000 aihub
```

### Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 常见问题

**Q1：后端启动报 "Communications link failure"？**
A：检查 PostgreSQL/SQLite 是否启动；核实 `.env` 中的 `DATABASE_URL`。

**Q2：AI Provider 返回 401？**
A：API Key 无效或过期。检查 `src/lib/ai/key-resolver.ts` 并轮换 Key。

**Q3：B 站爬虫返回 403？**
A：`BILIBILI_SESSDATA` Cookie 过期。重新登录并更新。

**Q4：PPT 生成 lint 失败？**
A：查看 `src/lib/slide-engine/lint-rules/` 中失败的规则。通常表示 LLM 生成的 JSON 不符合 IR schema。

**Q5：如何添加新的 AI Provider？**
A：在 `src/lib/ai/router.ts` 实现适配器，在 Provider 列表中注册，并添加对应 env 变量。

---

## 许可

MIT © 2026 AIHub Authors
