# monorepoTopology · pnpm workspace 顶层架构设计

> 创建于 2026-09-07
> 配套文档：[`00-总体迁移设计.md`](./00-总体迁移设计.md) §5 4 周迁移路线图
> 状态：**设计稿，未落地**

---

## 1. 一句话目标

把当前单仓 `src/` 单体 Next.js 应用，拆为 **pnpm workspace** monorepo：

- `apps/` = 可独立部署的应用（web、cron）
- `packages/` = 业务模块 + 基础设施库

---

## 2. 顶层目录（最终态）

```
aihub/
├── apps/
│   ├── web/                        ← Next.js 14 主站（唯一部署单元）
│   └── cron/                       ← 定时任务（Vercel Cron 或独立 Worker）
├── packages/
│   ├── aiCore/                     ← LLM 多 Provider 路由
│   ├── auth/                       ← 登录 / session / 租户隔离
│   ├── bilibili/                   ← B 站 UP 主监控
│   ├── chat/                       ← AI 对话流
│   ├── cleanup/                    ← 孤儿文件清理
│   ├── config/                     ← 共享 tsconfig / eslint / prettier
│   ├── dailyBriefing/              ← AI 早报（编排层）
│   ├── db/                         ← Prisma + 加密 + 单例
│   ├── discovery/                  ← 实体发现 / 关联推荐
│   ├── multimodal/                 ← 跨 News + Rankings 联合查询
│   ├── news/                       ← 新闻聚合 / 解析 / 去重
│   ├── observability/              ← logger / alert / distributed-lock
│   ├── projects/                   ← 项目 CRUD / 软删除
│   ├── rankings/                   ← AI 模型排行 + 算法
│   ├── settings/                   ← 用户偏好 / API Key / 对话风格
│   ├── slideEngine/                ← PPT 排版引擎（纯函数库）
│   ├── theme/                      ← 主题切换 / 强调色 / 背景图
│   ├── ui/                         ← 跨业务复用组件
│   └── usage/                      ← token 计费 / 用量统计
├── docs/                           ← 文档
├── prisma/                         ← schema 源（软链到 packages/db）
├── scripts/                        ← 仅保留长期维护脚本
├── pnpm-workspace.yaml
├── package.json                    ← workspace 根
├── tsconfig.json                   ← 根 tsconfig（extends packages/config）
└── ARCHITECTURE.md
```

**目录命名规则**（用户约定）：

- 全部 **驼峰（camelCase）**
- ❌ 禁止：中划线 `-`、下划线 `_`、点 `.`
- 例外：`apps/` `packages/` `docs/` `prisma/` `scripts/` 是约定俗成的根目录（保留）

---

## 3. `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

> `pnpm 9+` 自动识别，无需额外配置。

---

## 4. 每个 `packages/<name>` 的标准结构

```
packages/<name>/
├── src/
│   ├── domain/        # 纯业务逻辑（无外部依赖，可独立单测）
│   ├── infra/         # 数据访问（Prisma / HTTP / 第三方 API）
│   ├── interface/     # 对外接口（tRPC router / React 组件 / CLI）
│   └── index.ts       # 唯一对外入口
├── tests/             # Vitest 单元测试
├── package.json       # name: "@aihub/<name>" + exports 字段
├── tsconfig.json      # extends packages/config/tsconfig.base.json
├── README.md          # "我能依赖谁、我能被谁依赖"
└── .gitignore         # 仅忽略 dist/
```

### 4.1 `package.json#exports` 强制约束

```json
{
  "name": "@aihub/news",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./domain": "./src/domain/index.ts",
    "./infra": "./src/infra/index.ts",
    "./interface": "./src/interface/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "vitest run"
  },
  "dependencies": {
    "@aihub/db": "workspace:*",
    "@aihub/observability": "workspace:*"
  }
}
```

**关键点**：

- `exports` 字段精确控制谁能 `import` 什么路径
- `import '@aihub/news/src/parsers/wechat-mp'` 会被 Node 解析失败 → **编译期阻断深路径穿透**
- 任何反向依赖消费方都会被 ESLint `no-restricted-imports` 拦截

---

## 5. 包依赖图（架构目标态）

```
                          ┌──────────────────────────┐
                          │      apps/web            │
                          │    (Next.js 14)          │
                          └────────────┬─────────────┘
                                       │
        ┌──────────────────────────────┼─────────────────────────────┐
        │                              │                              │
   ┌────▼────┐                ┌────────▼────────┐          ┌──────────▼────────┐
   │  chat   │                │ dailyBriefing   │          │   其他页面         │
   └────┬────┘                └────────┬────────┘          └──────────┬─────────┘
        │                             │                              │
        │         ┌───────────────────┼───────────────────┐          │
        │         │                   │                   │          │
        │    ┌────▼───┐        ┌──────▼──────┐      ┌─────▼─────┐    │
        │    │ aiCore │        │ slideEngine │      │   theme   │    │
        │    └────┬───┘        └─────────────┘      └───────────┘    │
        │         │                                                 │
        │    ┌────▼────────────────────────────────────┐            │
        └────┤  news / rankings / bilibili / discovery ├────────────┘
             └────┬────────────────────────────────────┘
                  │
        ┌─────────▼────────────────────────────────────┐
        │  db  +  observability                         │  ← 基础设施
        └──────────────────────────────────────────────┘
                  │
        ┌─────────▼─────────────────────────────────────┐
        │  auth / settings / projects / usage / cleanup │  ← 跨切
        └──────────────────────────────────────────────┘
```

### 5.1 依赖规则（强约束）

1. ✅ 单向：上层 → 下层
2. ❌ 反向禁止：`db` 绝不能 import 任何业务模块
3. ⚠️ `dailyBriefing` 是"编排层"，可依赖一切下层
4. ⚠️ `slideEngine` 是"纯工具"，**不被任何业务包 import 内部的 `templates/briefing/*`**
5. ❌ 任何包不得跨过 `slideEngine` 直接依赖 `dailyBriefing` 的内部（必须通过 `dailyBriefing` 暴露的 `@aihub/dailyBriefing/contracts`）

---

## 6. 工具链配置

### 6.1 根 `package.json` 新增脚本

```jsonc
{
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "depcruise": "depcruise --validate .dependency-cruiser.cjs"
  },
  "devDependencies": {
    "dependency-cruiser": "^16.0.0",
    "eslint-plugin-import": "^2.30.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

### 6.2 根 `.eslintrc.json` 边界规则

```jsonc
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        {
          "group": ["@aihub/*/src/*"],
          "message": "禁止深路径导入其他包内部文件，必须通过 @aihub/<name> 入口"
        }
      ]
    }]
  }
}
```

### 6.3 根 `.dependency-cruiser.cjs`

详见 [`depCruiser.md`](./depCruiser.md)（占位文件，后续单独写）

---

## 7. 迁移阶段映射

| 阶段 | 内容 | 涉及包 |
|---|---|---|
| P0 | 初始化 workspace + 工具链 | （无业务包） |
| P0.5 | 清理垃圾脚本 | scripts/legacy/ |
| P1 | 迁基础设施 + 纯函数 | observability / db / slideEngine / multimodal |
| P2 | 迁业务核心 | aiCore / rankings / news / usage |
| P3 | 迁跨模块编排 | bilibili / dailyBriefing |
| P4 | 迁 UI 与 apps | theme / settings / discovery / cleanup + apps/web |
| P5 | 收尾 + 回归 | 所有 |

每个包迁完后保留 `src/` 旧路径至少 **1 周**作兜底，1 周后删除。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 跨包 import 路径爆炸 | TypeScript path alias + codemod 自动化 |
| Prisma migration 期间数据丢失 | 灰度切换；dev → prod 验证 → 切读 |
| Vercel 构建超时（多包构建） | 缓存层 + 并行构建；超时调至 60s |
| 业务功能在迁移中被"顺手优化"导致行为变化 | 严守"不改业务逻辑"原则；每步 e2e 冒烟 |
| 新人 onboarding 难度上升 | `CLAUDE.md` + `README.md` 双入口；skill 化高频任务 |

---

## 9. 过期条件

- 拆分完成后归档本文件 → `docs/archived/refactor/`
- 任何架构调整需先改 `ARCHITECTURE.md`（根目录）再改本文档
- 引入新包时必须在 §2 顶层目录追加条目

---

**创建时间**：2026-09-07
**下次更新**：P0 完成后
