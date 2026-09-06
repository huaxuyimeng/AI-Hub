# 05 · 依赖方向规则

> 本文件定义**包之间的依赖方向**，并给出**强制执行机制**。一旦违规，CI 立即阻断 merge。

---

## 1. 核心规则

### 1.1 依赖方向总图

```
apps/web ─┐
apps/cron ┤
          ├──→ 业务包 ──→ 基础设施包 ──→ db
                       ↘
                        → ai-core
                        → observability
                        → utils
```

**严格禁止**：
- `db` 引用任何 `observability/ai-core/业务包`
- `observability` 引用 `db/ai-core/业务包`
- `ai-core` 引用 `业务包`
- 业务包之间**互相横向** import 内部实现（仅允许通过子路径暴露的 API）

---

## 2. 完整依赖矩阵

✅ = 允许；❌ = 禁止；⚠️ = 仅允许子路径暴露的接口

| 调用方 ↓ \ 被调用方 → | db | observability | ai-core | news | rankings | bilibili | multimodal | slide-engine | daily-briefing | ui | utils | config |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **db** | - | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **observability** | ✅ | - | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **config** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | - |
| **utils** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | - | ✅ |
| **ui** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | - | ❌ | ✅ |
| **ai-core** | ✅ | ✅ | - | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **slide-engine** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | - | ❌ | ❌ | ❌ | ✅ |
| **multimodal** | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | - | ❌ | ❌ | ❌ | ✅ | ✅ |
| **rankings** | ✅ | ✅ | ❌ | ❌ | - | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **news** | ✅ | ✅ | ⚠️ | - | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **bilibili** | ✅ | ✅ | ❌ | ⚠️ | ❌ | - | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **daily-briefing** | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ⚠️ | - | ❌ | ✅ | ✅ |
| **apps/web** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **apps/cron** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |

### 2.1 矩阵的"⚠️"项详细说明

| 调用方 | 被调用方 | 允许范围 | 示例 |
|---|---|---|---|
| `multimodal` | `news` | 仅 `domain` 子路径 | `import { type NewsSourceName } from '@aihub/news/domain'` |
| `multimodal` | `rankings` | 仅 `domain` 子路径 | `import { type ScoringResult } from '@aihub/rankings/domain'` |
| `news` | `ai-core` | 仅 `interface`（router） | `import { chat } from '@aihub/ai-core'` |
| `news` | `rankings` | 仅 `domain`（算法） | `import { calculateValueScore } from '@aihub/rankings/domain'` |
| `bilibili` | `news` | 仅 `domain` + `parsers` 子路径 | `import { NEWS_SOURCES } from '@aihub/news/domain'` |
| `daily-briefing` | `ai-core` | 仅 `interface` | `import { chat } from '@aihub/ai-core'` |
| `daily-briefing` | `news` | 仅 `infra/service` 子路径 | `import { beijingDayStart } from '@aihub/news/infra'` |
| `daily-briefing` | `rankings` | 仅 `domain` | `import { calculateValueScore } from '@aihub/rankings/domain'` |
| `daily-briefing` | `slide-engine` | 仅 `domain`（注册 API） | `import { registerPageType } from '@aihub/slide-engine/domain'` |

---

## 3. 强制执行机制

### 3.1 工具链

| 工具 | 配置文件 | 检查时机 |
|---|---|---|
| `dependency-cruiser` | `.dependency-cruiser.cjs` | CI + Pre-commit |
| `eslint-plugin-import` | `eslint.config.mjs` 的 `no-restricted-imports` | IDE + CI |
| `package.json#exports` | 各包的 `package.json` | Node 解析期 |
| `tsc --noEmit` | 各包的 `tsconfig.json` 的 `paths` | CI |

### 3.2 `dependency-cruiser` 配置示例

```javascript
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '禁止循环依赖',
      from: { path: '^packages/([^/]+)/src/' },
      to:   { path: '^packages/([^/]+)/src/', dependencyTypes: ['es6'] },
    },
    {
      name: 'db-must-be-leaf',
      severity: 'error',
      from: { path: '^packages/db/src/' },
      to:   { path: '^packages/(?!db|config)([^/]+)/src/' },
    },
    {
      name: 'no-cross-package-internal',
      severity: 'error',
      from: { path: '^packages/([^/]+)/src/' },
      to:   { path: '^packages/([^/]+)/src/(?!index\\.ts$)' },
    },
    {
      name: 'observability-must-be-leaf',
      severity: 'error',
      from: { path: '^packages/observability/src/' },
      to:   { path: '^packages/(?!observability|db|config)([^/]+)/src/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { file: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
```

### 3.3 ESLint `no-restricted-imports` 配置示例

```javascript
// eslint.config.mjs（每包独立配置）
export default [
  {
    files: ['packages/news/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@aihub/bilibili/*', '@aihub/daily-briefing/*'],
            message: '禁止 news 包依赖 bilibili 或 daily-briefing',
          },
          {
            group: ['@aihub/rankings/src/*'],
            message: '只能通过 @aihub/rankings/domain 子路径访问 rankings',
          },
        ],
      }],
    },
  },
  // ... 其他包
]
```

### 3.4 `package.json#exports` 强制入口

```json
// packages/news/package.json
{
  "exports": {
    ".":          "./src/index.ts",
    "./domain":   "./src/domain/index.ts",
    "./infra":    "./src/infra/index.ts",
    "./parsers":  "./src/infra/parsers/index.ts",
    "./ui":       "./src/interface/ui/index.ts"
  }
}
```

任何 `import '@aihub/news/src/infra/parsers/wechat-mp'` 都会在 **Node 模块解析期** 失败。

---

## 4. 违规处理流程

### 4.1 检测时机

```
代码写完 → Pre-commit Hook → depcruise + eslint
                                    ↓ 失败
                            阻断 commit
                                    ↓ 通过
                            CI 复检
                                    ↓ 失败
                            阻断 PR merge
```

### 4.2 例外申请

如确实需要"打破规则"（极少见，例如 shared schema），需：

1. 在 PR 中显式写 `## Exception: <理由>`
2. ARCHITECTURE maintainer 两人 APPROVE
3. 更新本文件，添加新例外项

### 4.3 违规类型分级

| 级别 | 类型 | 处理 |
|---|---|---|
| 🔴 Error | 循环依赖 | 直接阻断，零容忍 |
| 🔴 Error | `db`/`observability` 越界 | 直接阻断 |
| 🔴 Error | 深路径穿透（绕过 exports） | 直接阻断 |
| 🟡 Warning | 业务包横向依赖（非子路径） | 阻断 + 必须重构 |
| 🟢 Info | 同包内未走 index.ts | 仅 IDE 警告 |

---

## 5. 依赖图可视化

### 5.1 自动生成

```bash
# 每月一次自动生成依赖图（CI artifact）
pnpm depcruise --output-type dot --output .artifacts/dep-graph.dot packages/*/src apps/*/src
# 用 Graphviz 渲染
dot -Tsvg .artifacts/dep-graph.dot -o docs/architecture/assets/dep-graph.svg
```

### 5.2 当前依赖图（重构前）

```
src/lib/news/service.ts ──→ src/lib/ai/router.ts ⚠️
src/lib/news/intent-search.ts ──→ src/lib/ai/router.ts ⚠️
src/lib/news/intent-search.ts ──→ src/lib/rankings/algorithm.ts ⚠️
src/lib/bilibili/scraper.ts ──→ src/lib/news/parsers/wechat-mp.ts ⚠️
src/lib/bilibili/scraper.ts ──→ src/lib/news/sources.ts ⚠️
src/features/daily-briefing/lib/generate.ts ──→ src/lib/{ai,news,rankings,observability}/* ⚠️
src/features/daily-briefing/lib/build-pptx.ts ──→ src/lib/slide-engine/*（深路径）❗
src/features/daily-briefing/components/SlidePreview.tsx ──→ src/lib/slide-engine/*（深路径）❗
```

### 5.3 目标依赖图（重构后）

```
packages/daily-briefing/interface/server/router.ts ──→ @aihub/ai-core（interface）
packages/daily-briefing/interface/server/cron.ts ──→ @aihub/observability
packages/daily-briefing/infra/generate.ts ──→ @aihub/ai-core
                                          ──→ @aihub/news/infra
                                          ──→ @aihub/rankings/domain
packages/daily-briefing/infra/build-pptx.ts ──→ @aihub/slide-engine/domain
packages/bilibili/interface/server/scraper.ts ──→ @aihub/news/parsers
                                              ──→ @aihub/news/domain
```

---

## 6. 工具安装与初始化脚本

```bash
# 安装依赖
pnpm add -Dw dependency-cruiser eslint-plugin-import @typescript-eslint/parser

# 在根目录创建配置文件
touch .dependency-cruiser.cjs

# 在 CI 配置中加入
echo "  - run: pnpm depcruise --validate" >> .github/workflows/ci.yml
```

---

> 最后修订：2026-09-04
