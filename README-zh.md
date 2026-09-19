# AIHub

> **AI 工作台 + AI 早报自动生成 + 多源信息聚合** —— 把 AI 内容工作流收拢在一个界面里。

[简体中文](./README.md) · [English](./README-en.md)

---

## 一句话介绍

**让 AI 帮你追 AI 资讯、自动做早报、比价格、追 B 站**，不用在十几个工具之间切换。

---

## 效果预览

| 新闻聚合 | 模型排行 | 智能体会议 |
|---------|---------|-----------|
| 多源 AI 资讯按置信度排序 | 50+ 模型横向性价比对比 | 多角色 AI 同台讨论，输出结论 |

---

## 解决了什么问题

| 痛点 | AIHub 的解法 |
|------|------------|
| 每天刷十几个 AI 新闻源，浪费时间 | 聚合 10+ 中英文源，置信度排序，重点内容 5 分钟看完 |
| 想对比 Claude / GPT / DeepSeek 哪个性价比高 | 能力 × 价格 × 上下文三维加权算法，每日更新 |
| 想追踪喜欢的 B 站 UP 主更新了什么 | WBI 签名 + Cookie 登录态 + RSS 兜底，自动抓字幕 |
| 每周要花 2 小时做 AI 行业早报 PPT | cron 拉新闻 → LLM 生成 JSON → IR lint 校验 → 一键导出 PPTX |
| 需要多人协作但不想每人买账号 | 多租户 + RBAC + 软删除，单实例支持多团队 |

---

## 核心功能

### 🤖 AI 新闻聚合
自动抓取机器之心 / 量子位 / AIbase / Unite.AI / Hacker News / 36kr 等 10+ 资讯源，按**置信度 × 来源质量 × 厂商标签**三维度评分。RSS / HTML / API 三类解析器自适应，支持意图搜索和按分类关注。

### 📊 AI 模型排行
基于 Pareto 前沿筛选的加权算法（能力 40% + 价格 30% + 上下文窗口 30%），每日自动更新 50+ 模型数据。支持横向对比、价格走势、相关新闻关联。

### 📺 B 站 UP 主追踪
WBI 签名逆向工程 + SESSDATA Cookie 登录态 + RSS 兜底，抓取指定 UP 主的视频 + 字幕。字幕支持语义分析，帮你快速了解 UP 主近期都在聊什么。

### 📑 AI 早报（PPT）
每日定时任务 → 大模型生成简报 JSON → IR lint 校验 → 渲染 PPTX。自研 slide-engine（模板 + IR 中间表示 + lint 规则），保证每页格式统一、内容合规。可一键导出"今日 AI 行业 PPT"。

### 🗣️ 多角色 AI 会议
基于 LangChain / LangGraph 的多智能体会议系统，产品经理 / 工程师 / 投资者 / 评论家同台讨论，SSE 流式输出，原子状态机防并发重复执行。

---

## 技术亮点

| 亮点 | 说明 |
|------|------|
| **全量 TypeScript** | tRPC 端到端类型安全，前端→后端→数据库零隐式 any |
| **LangChain / LangGraph** | 流式批处理 + 状态机 + 缓存 token 计费（Prompt Cache 折扣自动计算） |
| **多租户 + 软删除** | `createTenantPrisma(ctx)` 强制注入 tenantId；白名单内 9 个模型含 `deletedAt` |
| **自研 PPT 引擎** | IR 中间表示 → lint 规则校验 → PPTX 模板渲染，格式零漂移 |
| **AI Key 智能路由** | 唯一入口 `key-resolver.ts`，多 Provider（DeepSeek / 智谱 / Anthropic / Kimi）自动降级 |
| **CSS 变量主题系统** | 6 套预设 + HSL DIY，强调色一键换肤 |

**技术栈**：Next.js 14 (App Router) · tRPC 11 · Prisma 6 · PostgreSQL / SQLite · Cloudflare R2 · Upstash Redis · NextAuth.js · `@tabler/icons-react`

---

## 快速开始

```bash
# 克隆
git clone https://github.com/huaxuyimeng/AI-Hub.git
cd AI-Hub

# 安装
pnpm install

# 环境配置
cp .env.example .env
# 必填：DATABASE_URL、NEXTAUTH_SECRET、CRON_SECRET
# 推荐：AI Provider Key、R2 存储、Upstash Redis、B 站 SESSDATA

# 数据库
pnpm prisma migrate dev

# 启动
pnpm dev
# → http://localhost:3000
```

---

## 测试覆盖

| 测试套件 | 用例数 |
|---------|-------|
| 模型排行算法 | ✅ |
| 用量计费 | ✅ |
| PPT 早报 IR | ✅ 59/59 |
| Meeting Graph 状态机 | ✅ 47/47 |
| LangChain 流式批处理 | ✅ 20/20 |
| Meeting Router 集成 | ✅ 28/28 |
| Chat Router | ✅ 19/19 |
| Server Context (P0 防护) | ✅ 4/4 |
| Briefing 后处理器 | ✅ 16/16 |
| **typecheck** | ✅ **零错误** |

---

## 目录结构

```
aihub/
├── src/
│   ├── app/                  # Next.js App Router 页面
│   │   └── (app)/           #   工作台 /news /rankings /meeting 等
│   ├── components/          # 共享 UI 组件
│   ├── features/           # daily-briefing 等业务模块
│   ├── lib/                # 核心库
│   │   ├── ai/              #   路由 / key 解析 / 模型 / LangChain 适配
│   │   ├── news/            #   多源抓取 / 意图搜索 / 健康度
│   │   ├── bilibili/        #   wbi 签名 / Cookie / 字幕
│   │   ├── rankings/         #   算法 / 爬虫 / 调度
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

## 安全说明

```bash
# 克隆后必须自行生成密钥
openssl rand -base64 32   # → NEXTAUTH_SECRET
openssl rand -hex 32      # → CRON_SECRET
```

所有凭据、Cookie、Session Token 仅存于本地 `.env`（已被 `.gitignore` 拦截，不会上传）。

---

## License

MIT © 2026 AIHub Authors
