# 03 · 迁移路线图

> 本文件回答：**如何把现在 `src/` 下的代码，平滑、安全、可回滚地迁移到 `packages/*`？**
> 预计总耗时：2-4 周（一人全职 / 多人协作 1-2 周）。

---

## 1. 总原则

1. **渐进迁移** —— 一次只迁一个包，**绝不**一次性把所有模块搬到 `packages/`
2. **新旧共存期 ≥ 1 周** —— 每个包迁完后保留 `src/` 旧路径至少 1 周作为兜底
3. **每个阶段必须可回滚** —— 用 git tag 标记每个阶段完成点
4. **先迁"叶子"，再迁"上层"** —— 依赖图最底层的先迁（`db`、`observability`、`slide-engine`）
5. **测试先行** —— 迁之前先补单测，迁之后跑测试必须全绿

---

## 2. 阶段划分

```
P0 ──→ P1 ──→ P2 ──→ P3 ──→ P4
基础设施  纯函数库   业务模块     跨模块编排   收尾与文档
1-2天    2-3天     3-5天        3-5天        1-2天
```

| 阶段 | 内容 | 预计 | 风险 |
|---|---|---|---|
| **P0** | 初始化 monorepo（pnpm workspace、目录骨架、共享 config、依赖图校验工具） | 1-2 天 | 低 |
| **P0.5** | 清理垃圾文件/脚本（按 `04-cleanup-checklist.md`） | 0.5 天 | 低 |
| **P1** | 迁 `db` + `observability` + `slide-engine` + `multimodal` | 2-3 天 | 低 |
| **P2** | 迁 `ai-core` + `rankings` + `news` | 3-5 天 | 中 |
| **P3** | 迁 `bilibili` + `daily-briefing` | 3-5 天 | 高 |
| **P4** | 迁 `cleanup` UI 模块（如决定独立） + `discovery` + `theme` + `settings`，统一 `apps/web` 与 `apps/cron` | 1-2 天 | 中 |
| **P5** | 删除 `src/lib/*` 旧路径，全量回归 | 1-2 天 | 低 |

---

## 3. 阶段详细步骤

### 3.1 P0：初始化 monorepo

**Day 1：workspace 配置**

```bash
# 1. 创建 pnpm workspace 配置
cat > pnpm-workspace.yaml << EOF
packages:
  - 'apps/*'
  - 'packages/*'
EOF

# 2. 在 package.json 中加入
{
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "depcruise": "depcruise --validate .dependency-cruiser.cjs"
  }
}

# 3. 创建目录骨架
mkdir -p apps/web packages/{db,observability,slide-engine,multimodal,ai-core,rankings,news,bilibili,daily-briefing,ui,utils,config}
```

**Day 2：工具链配置**

```bash
# 1. 安装工具
pnpm add -Dw dependency-cruiser eslint-plugin-import @typescript-eslint/parser

# 2. 创建 .dependency-cruiser.cjs（参考 05-dependency-rules.md）
# 3. 创建共享 tsconfig
cat > packages/config/tsconfig.base.json << EOF
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
EOF

# 4. 在根 .eslintrc.json 配置 import 规则
```

**Git tag**：`v0.5-monorepo-p0`

---

### 3.2 P0.5：垃圾清理

**参考 `04-cleanup-checklist.md`**，按"可安全执行删除 → 归档 → 合并"顺序操作。

每个删除步骤前先 `git add -A && git commit`，便于单步回滚。

---

### 3.3 P1：迁基础设施包

#### P1.1 `@aihub/observability`

```bash
# 1. 创建包
mkdir -p packages/observability/src/{infra,domain,interface}

# 2. 复制文件
cp src/lib/observability/logger.ts              packages/observability/src/infra/logger.ts
cp src/lib/observability/alert.ts               packages/observability/src/infra/alert.ts
cp src/lib/observability/distributed-lock.ts    packages/observability/src/infra/distributed-lock.ts

# 3. 创建入口
cat > packages/observability/src/index.ts << EOF
export { logger, log, type LogContext, type LogLevel } from './infra/logger'
export { alert, type Alert, type AlertSeverity } from './infra/alert'
export { withLock, isLockSkipped, type LockOptions, type LockResult } from './infra/distributed-lock'
EOF

# 4. 创建 package.json
cat > packages/observability/package.json << EOF
{
  "name": "@aihub/observability",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "workspace:*"
  }
}
EOF

# 5. 替换 import 路径
# 全局：@/lib/observability/logger → @aihub/observability
# （用 sed 或 IDE 全局重构）

# 6. 验证
pnpm --filter @aihub/observability typecheck
pnpm --filter @aihub/observability test
pnpm dev  # 启动 web，确认日志输出正常
```

**回滚预案**：保留 `src/lib/observability/` 至少 1 周，1 周后删除。

---

#### P1.2 `@aihub/db`

```bash
# 类似 P1.1，但需要：
# 1. 把 prisma/schema.prisma 软链到 packages/db/prisma/
# 2. 修改 prisma generate 命令指向 packages/db/prisma/schema.prisma
# 3. 把 src/lib/db.ts 和 src/lib/crypto.ts 合并到 packages/db/src/infra/
```

⚠️ **特别提醒**：
- `prisma generate` 需要在 `packages/db/package.json` 的 `postinstall` 中执行
- 其他包的 `package.json` 中 `dependencies` 需加 `"@aihub/db": "workspace:*"`
- `src/lib/db.ts` 与 `src/lib/crypto.ts` 合并为一个包内的 `infra/client.ts` + `infra/encryption.ts`

---

#### P1.3 `@aihub/slide-engine`

```bash
# 这是最干净的迁移：纯函数库，无内部依赖
mkdir -p packages/slide-engine/src/{domain,interface}
cp -r src/lib/slide-engine/* packages/slide-engine/src/

# 注意：
# 1. templates/briefing/ 移到 packages/daily-briefing/src/domain/slides/
# 2. cli.ts 保留在 packages/slide-engine/src/interface/cli.ts
# 3. slide-engine.test.ts 改为 Vitest 测试，写在 packages/slide-engine/tests/
```

⚠️ **`templates/briefing/*` 是业务页型，不是引擎本身**——必须迁移到 `daily-briefing`

---

#### P1.4 `@aihub/multimodal`

```bash
# 极简单，直接复制
mkdir -p packages/multimodal/src/{domain,infra,interface}
cp src/lib/multimodal/fuse.ts packages/multimodal/src/infra/fuse.ts
```

---

### 3.4 P2：迁业务包

#### P2.1 `@aihub/ai-core`

```bash
# 1. 拆分 client.ts → 删除（兼容占位已弃用）
# 2. providers.ts → 拆为 providers/{openai,anthropic,gemini,...}.ts + provider-registry.ts
# 3. router.ts → interface/router.ts
# 4. 其余按 domain/infra 拆分
```

⚠️ **关键改动**：
- 删除 `client.ts` 的 `deepseek` / `litellm` 兼容导出
- `router.ts` 中 `if (process.env.NODE_ENV === 'development') mock` 改为显式 `if (process.env.AIHUB_AI_MOCK === '1')`
- `key-resolver.ts` 改为通过构造函数注入 prisma（便于测试）

---

#### P2.2 `@aihub/rankings`

```bash
# 1. algorithm.ts → domain/algorithm.ts
# 2. scraper.ts → infra/scraper.ts（构造函数注入 fetch）
# 3. algorithm.test.ts → tests/algorithm.test.ts（Vitest）
# 4. src/components/rankings/* → interface/ui/*
```

---

#### P2.3 `@aihub/news`

```bash
# 这是最复杂的迁移
mkdir -p packages/news/src/{domain,infra,infra/parsers,interface,interface/ui,interface/server}
cp -r src/lib/news/* packages/news/src/
cp -r src/components/news/* packages/news/src/interface/ui/

# 关键改动：
# 1. parsers/index.ts 严禁 import ../service（避免循环）
# 2. parsers/types.ts 改为引用 domain/types.ts
# 3. service.ts 中所有 parsers/* import 改为 './parsers'
# 4. intent-search.ts 中 @/lib/rankings/algorithm 改为 @aihub/rankings/domain
```

---

### 3.5 P3：迁跨模块编排包

#### P3.1 `@aihub/bilibili`

```bash
# 1. 拆 api.ts / wbi.ts / rss.ts / storage.ts / merge.ts → infra/*
# 2. scraper.ts 改为 interface/server/scraper.ts（编排层）
# 3. 所有 @/lib/news/parsers/* import 改为 @aihub/news/parsers
# 4. api.ts 的 fetchWithRetry 改为构造函数注入
```

---

#### P3.2 `@aihub/daily-briefing`

```bash
# 1. templates/briefing/* 从 slide-engine 移过来 → domain/slides/*
# 2. 所有内部 import 改为子路径（@aihub/slide-engine/domain）
# 3. SlidePreview.tsx 检查 'use client' 边界
# 4. server/cron.ts 中 withLock 改为 @aihub/observability
```

⚠️ **最大风险点**：`build-pptx.ts` 与 `SlidePreview.tsx` 当前 import `slide-engine` 内部文件，迁包后必须改为子路径入口。

---

### 3.6 P4：UI 模块与 apps

```bash
# 1. src/components/cleanup/ → apps/web/src/features/cleanup/
# 2. src/components/discovery/ → apps/web/src/features/discovery/
# 3. src/components/theme/ → apps/web/src/features/theme/
# 4. src/components/settings/ → apps/web/src/features/settings/
# 5. src/components/ui/ → packages/ui/src/
# 6. apps/web = 现有 src/app/ + src/components/ 中未迁出的部分
# 7. apps/cron = src/app/api/cron/* 的服务端执行体（去掉 API route 包装）
```

---

### 3.7 P5：清理与全量回归

```bash
# 1. 删除 src/lib/* 旧路径
# 2. 删除 src/components/{bilibili,cleanup,discovery,layout,news,rankings,settings,theme,ui}/* 中已迁出的
# 3. 删除 src/features/daily-briefing/（已迁到 packages/daily-briefing）
# 4. 全量 typecheck + test + e2e
# 5. 更新 ARCHITECTURE.md 的"当前状态"章节
```

---

## 4. 每日工作流模板

```bash
# 1. 早会前
git pull
pnpm install

# 2. 选一个 P 阶段中的一个包
# 例如：今天迁 @aihub/observability

# 3. 按"创建包 → 复制代码 → 调整 imports → 测试"的步骤
# 每个步骤完成后 commit

git add -A
git commit -m "refactor(observability): 迁移到 packages/observability"

# 4. 跑全量检查
pnpm typecheck
pnpm test
pnpm lint
pnpm depcruise --validate

# 5. 启动 dev 模式手测
pnpm --filter @aihub/observability typecheck
pnpm dev  # 启动 web 应用，目测功能
```

---

## 5. 回滚预案

每个 P 阶段完成后：

```bash
git tag -a v0.5-monorepo-p1 -m "P1: 基础设施包迁移完成"
git push origin v0.5-monorepo-p1
```

如发现 P1 后整个项目崩了：

```bash
git revert --no-commit v0.5-monorepo-p1..HEAD
# 或：
git reset --hard v0.5-monorepo-p0
```

---

## 6. 监控指标

每次合并后，在 Slack/CI 中观察：

| 指标 | 健康值 | 异常处理 |
|---|---|---|
| `pnpm typecheck` 时长 | < 60s | > 120s 提示有循环依赖 |
| `pnpm install` 警告数 | 0 | > 0 必有 peer dep 漏声明 |
| `depcruise` 违规数 | 0 | > 0 必须修，不能 merge |
| 测试覆盖率 | > 60% | < 60% 必须补单测 |
| Web 启动时间 | < 5s | > 10s 提示有顶层副作用 |

---

## 7. 完成后的最终目录

```
aihub/
├── ARCHITECTURE.md                    ← 入口文档
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
├── .dependency-cruiser.cjs
├── .eslintrc.json
├── apps/
│   ├── web/                           ← Next.js 14 主站
│   │   ├── src/
│   │   │   ├── app/                   ← 页面（路由）
│   │   │   ├── features/              ← 仅 web 特有的 UI 模块（cleanup/discovery/theme/settings）
│   │   │   └── server/                ← tRPC mount + auth + cron trigger
│   │   ├── package.json
│   │   └── next.config.mjs
│   └── cron/                          ← 定时任务
│       ├── src/
│       │   ├── jobs/                  ← fetch-news / refresh-models / generate-daily-report ...
│       │   └── index.ts
│       └── package.json
├── packages/
│   ├── db/                            ← Prisma + 加密 + Redis
│   ├── observability/                 ← 日志 + 告警 + 锁
│   ├── slide-engine/                  ← PPT 排版引擎（纯）
│   ├── multimodal/                    ← 跨源事件融合
│   ├── ai-core/                       ← 多 Provider LLM 路由
│   ├── rankings/                      ← 模型排行
│   ├── news/                          ← 新闻聚合
│   ├── bilibili/                      ← B 站爬虫
│   ├── daily-briefing/                ← AI 早报（编排层）
│   ├── ui/                            ← 通用展示组件
│   ├── utils/                         ← 通用工具
│   └── config/                        ← 共享配置
├── docs/
│   ├── architecture/                  ← 本目录
│   ├── archived/                      ← 历史文档（不动）
│   └── README-当前状态.md
├── scripts/                           ← 仅保留长期维护脚本
│   ├── backfill-model-snapshots.ts
│   ├── sync-news-sources.ts
│   └── legacy/                        ← 已归档但保留
└── prisma/
    └── schema.prisma                  ← 软链到 packages/db/prisma/
```

---

## 8. 时间盒（一人全职估算）

| 周次 | 工作 |
|---|---|
| W1 | P0 (1-2 天) + P0.5 (0.5 天) + P1 (2-3 天) |
| W2 | P2 (3-5 天) + P3 部分 (1-2 天) |
| W3 | P3 续 (2-3 天) + P4 (1-2 天) |
| W4 | P5 收尾 + 文档 + 监控 |

总计 **3-4 周** 一人全职；多人协作可压缩到 **1.5-2 周**。

---

> 最后修订：2026-09-04
