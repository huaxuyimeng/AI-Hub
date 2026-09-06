# testing-isolation · 测试隔离设计

> 创建于 2026-09-06。目标：**单元测试 + E2E + Problem Statement 三类测试互不污染**，dev 模式启动时间 +3s 以内。

---

## 1. 一句话目标

把单测、E2E、Problem Statement 三类测试放到独立 `tests/` 目录，**dev 模式完全感觉不到它们的存在**，只在显式调用 `pnpm test:*` 或 CI 流水线时启动。

---

## 2. 现状盘点

| 现状 | 位置 |
|---|---|
| 单测 1：`ranking 算法` | `src/lib/rankings/algorithm.test.ts`（直接 tsx 跑） |
| 单测 2：`usage 计费` | `src/lib/usage.test.ts`（直接 tsx 跑） |
| 单测 3：`slide-engine 渲染` | `src/lib/slide-engine/slide-engine.test.ts`（直接 tsx 跑） |
| E2E | ❌ 无（无 playwright/cypress/puppeteer） |
| Problem Statement | ❌ 无 |
| CI | ❌ 无（仓库根目录无 `.github/workflows/`） |

### 2.1 现状问题

1. 单测脚本混在源码内（`src/lib/*.test.ts`），与 `next build` 冲突风险
2. 无 E2E：UI 层 Bug 只能靠手动验证
3. 无 CI：每次 push 不自动验证

---

## 3. 技术选型

| 测试类型 | 工具 | 理由 |
|---|---|---|
| 单元测试 | **保持 tsx + assert** | 现有脚本已经跑通，**不强制升级 vitest**（避免破坏现有 import 路径） |
| E2E | **Playwright** | Next.js 一等公民支持；自包含 webServer；多浏览器；CI 友好 |
| Problem Statement | **md 文件 + checklist** | 不是自动化测试，是"问题场景的思考题 + 验证步骤" |

### 3.1 不引入的方案（理由）

- ❌ **Vitest**：升级会改动所有 import 路径（`*.ts` → `*.test.ts` + 显式 `import { describe }`），迁移成本远超收益
- ❌ **Jest**：慢（每次冷启 5+ 秒），与 Next.js 集成需要额外配置
- ❌ **Cypress**：体积大，需独立 runner；本地启动慢
- ❌ **Puppeteer**：API 底层，缺少等待/重试抽象
- ❌ **Storybook + interaction tests**：引入一整套组件库 runner，对当前阶段过重

---

## 4. 目录结构

```
AIHub/
├── tests/                              ← 测试根目录（git tracked，仅 devDeps 时拉取）
│   ├── unit/                           ← 单元测试（按 src/ 镜像）
│   │   ├── rankings/
│   │   │   └── algorithm.spec.ts       ← 从 src/lib/rankings/ 迁过来
│   │   ├── usage/
│   │   │   └── billing.spec.ts         ← 从 src/lib/usage.test.ts 迁过来
│   │   └── slide-engine/
│   │       └── layout.spec.ts          ← 从 src/lib/slide-engine/ 迁过来
│   ├── e2e/                            ← Playwright E2E（仅 devDeps 时存在）
│   │   ├── playwright.config.ts
│   │   ├── fixtures/
│   │   │   ├── auth.setup.ts           ← 登录态 fixture
│   │   │   └── seed.sql                ← 测试数据（dev only）
│   │   ├── 01-login.spec.ts
│   │   ├── 02-workbench.spec.ts
│   │   ├── 03-chat.spec.ts
│   │   ├── 04-news.spec.ts
│   │   └── 05-settings.spec.ts
│   └── problem-statement/              ← 问题场景（手动验证 + 思考题）
│       ├── README.md                   ← 总入口
│       ├── 01-auth.md
│       ├── 02-multi-tenant.md
│       ├── 03-chat-failure.md
│       ├── 04-bilibili-cookie.md
│       └── 99-regression.md
├── scripts/
│   └── legacy/                         ← 现有一次性脚本（已归档）
└── src/                                ← 源码（不含测试）
```

### 4.1 文件搬迁（手动一次性）

- `src/lib/rankings/algorithm.test.ts` → `tests/unit/rankings/algorithm.spec.ts`
- `src/lib/usage.test.ts` → `tests/unit/usage/billing.spec.ts`
- `src/lib/slide-engine/slide-engine.test.ts` → `tests/unit/slide-engine/layout.spec.ts`

**搬迁时机**：第 2 周 P2.3（rankings 包迁移）一起做；不必单独搬。

---

## 5. E2E 隔离设计（关键）

### 5.1 与 dev 完全解耦

- `tests/e2e/` 目录**不在** `tsconfig.json` 的 `include` 内（用单独的 `tsconfig.test.json`）
- `next.config.ts` 的 `pageExtensions` **不包含** `.spec.ts`
- `pnpm dev` / `pnpm build` **永不引用** `tests/` 任何文件

### 5.2 Playwright webServer 隔离

```ts
// tests/e2e/playwright.config.ts
export default defineConfig({
  testDir: '.',
  webServer: {
    command: 'pnpm start -- -p 3200',     // 用 prod build，跑在 3200（不抢 3000）
    url: 'http://localhost:3200',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
```

**关键点**：
- 用 `pnpm start`（prod build），**不用** `pnpm dev`——避免 HMR 干扰
- 端口 3200（dev 是 3000，CI 是 3100，互不冲突）
- `reuseExistingServer`：本地有 server 就不重启（节省 60s）

### 5.3 dev 模式性能保证

**预算**：dev 启动时间增加 ≤ 3s。

| 改动 | 影响 |
|---|---|
| 添加 `tests/` 目录 | 0（git 不感知） |
| 添加 `tsconfig.test.json` | 0（dev tsconfig 不引用） |
| 添加 `tests/e2e/playwright.config.ts` | 0（dev 不加载） |
| 安装 `@playwright/test`（仅 devDeps） | dev 启动 +1~2s（依赖加载），可接受 |

**唯一可能超预算**：误把 playwright 加进 `dependencies`。**强制 devDeps**。

---

## 6. Problem Statement 设计

> Problem Statement ≠ 测试用例。
> 测试用例是"自动化验证 A=B"。
> Problem Statement 是"**问题场景的描述 + 手动验证步骤 + 思考题**"，由人或半自动工具跑。

### 6.1 模板（每份 Problem Statement 文件）

```markdown
# PS-XX · <场景一句话>

## 背景
- **触发条件**：用户做 XX 时
- **当前行为**：...
- **期望行为**：...

## 手动验证步骤
1. 步骤 1
2. 步骤 2
3. 步骤 3
4. **预期结果**：...

## 思考题（可选）
- 这个场景的边界是什么？
- 如果 XX，会发生什么？
- 这个场景的修复需要改动几个文件？

## 关联代码
- `src/...`
- `src/...`
```

### 6.2 首批 Problem Statement 清单

| ID | 场景 | 验证时间 |
|---|---|---|
| PS-01 | 用户用错误密码登录 3 次 | 2 分钟 |
| PS-02 | 用户登录后访问其他租户的项目 URL | 3 分钟 |
| PS-03 | AI 服务 502 时用户消息是否回滚 | 5 分钟 |
| PS-04 | B 站 cookie 过期后爬虫静默失败 | 5 分钟 |
| PS-05 | 多标签页同时打开命令面板 | 2 分钟 |
| PS-99 | 关键 Bug 回归（BUG-01/02/04/10/11/15/28） | 10 分钟 |

---

## 7. 命令集成

### 7.1 package.json scripts（新增项）

```jsonc
{
  "scripts": {
    // 保留现有
    "test:rankings": "tsx src/lib/rankings/algorithm.test.ts",      // 第 2 周前兼容
    "test:usage": "tsx src/lib/usage.test.ts",                       // 第 2 周前兼容
    "test:slides": "tsx src/lib/slide-engine/slide-engine.test.ts",  // 第 2 周前兼容
    
    // 新增（仅在 devDeps 装了 playwright 后才能跑）
    "test": "tsx tests/unit/run-all.ts",                             // 统一单测入口
    "test:e2e": "playwright test --config=tests/e2e/playwright.config.ts",
    "test:problem": "echo '查看 tests/problem-statement/ 目录'"
  }
}
```

### 7.2 命令兼容性

- **现状不变**：`test:rankings` / `test:usage` / `test:slides` 继续可用
- **新增统一入口**：`pnpm test`（跑所有 unit，不含 e2e）
- **dev 模式零影响**：`pnpm dev` 不引用任何 `test:*` 脚本

---

## 8. CI 集成（GitHub Actions）

### 8.1 工作流设计

```yaml
# .github/workflows/test.yml（**草案，待你点头后落地**）
name: tests
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test    # 单测（必须通过）

  e2e:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          DATABASE_URL: postgresql://...  # CI 专用 DB
```

### 8.2 CI 触发条件

| 工作流 | PR | push main | schedule |
|---|---|---|---|
| `unit` | ✅ 必跑 | ✅ 必跑 | ❌ |
| `e2e` | ❌（节省 CI 资源） | ✅ 必跑 | ✅ 每周一跑（catch 漂移） |

### 8.3 CI 不影响本地的保证

- `e2e` 仅在 CI 上跑，本地 `pnpm test:e2e` 是**显式 opt-in**
- CI 失败不影响 dev 体验（dev 完全独立）

---

## 9. 风险清单

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| T1 | 把 `@playwright/test` 误装到 `dependencies` | 中 | 中 | 用 `pnpm add -D` 强约束；CI 检查 `package.json` |
| T2 | E2E 在 prod build 下能跑，但 dev 下跑不出来 | 中 | 中 | 重要场景在 dev 模式 + prod build 双跑一遍 |
| T3 | E2E 跑时间过长（>10 分钟）导致 CI 超时 | 低 | 低 | 仅 5 个核心 spec；不追求全覆盖 |
| T4 | Problem Statement 沦为文档垃圾（无人更新） | 高 | 低 | 季度归档检查（hook `archive-check.sh`） |
| T5 | 单测从 src/ 搬到 tests/ 后路径错乱 | 中 | 低 | 一次性 PR + 全量 grep 替换 |

---

## 10. 过期条件

下列任一情况发生，需更新本档案：

- 引入 vitest / jest（迁移路径需重写）
- 替换 Playwright 为其他 E2E 工具
- `pnpm dev` 启动时间变化（性能预算需重定）
- 新增 Problem Statement 类别（如 PS-Perf）
- CI 平台从 GitHub Actions 迁移到其他平台

---

## 11. 落地顺序（本周不动）

本档案**仅设计**，**不落地任何代码 / 依赖 / CI 配置**。落地节点：

| 周 | 动作 |
|---|---|
| 第 2 周 P2.3 | 搬迁单测脚本到 `tests/unit/`，新增 `tsconfig.test.json` |
| 第 2 周 P2.3 | 添加 `pnpm test` 统一入口脚本 |
| 第 3 周 P3.3 | 安装 `@playwright/test`（devDeps）+ 添加 5 个核心 spec |
| 第 3 周 P3.3 | 添加 `.github/workflows/test.yml` |
| 第 4 周 P4.3 | Problem Statement 首次启用（PS-01 ~ PS-05 + PS-99） |

任一动作需要**单独报告** + 用户点头才执行。
