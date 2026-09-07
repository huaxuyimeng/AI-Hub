# slideEngine.md · slideEngine 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.10
> 重要约束：**templates/briefing/* 不属于本包，迁到 dailyBriefing**

---

## 1. 一句话职责

PPT 排版引擎（纯函数库）——页型注册 / 布局测量 / 容量校验 / 降级 / QA 门禁 / PPTX 与 Web 渲染。

---

## 2. 当前代码位置

```
src/lib/slide-engine/
├── index.ts                         # 主入口
├── cli.ts                           # CLI（slide:lint / slide:render / slide:snapshot）
├── slide-engine.test.ts             # 单测
├── contracts/
│   ├── slide-ir.ts                  # SlideIR 类型
│   ├── page-type.ts                 # 页型枚举
│   ├── geometry.ts                  # 几何尺寸
│   ├── capacity.ts                  # 容量规则
│   ├── theme.ts                     # 主题 token
│   └── lint.ts                      # Lint 规则
├── layout/
│   ├── measure.ts                   # 测量
│   ├── capacity.ts                  # 容量校验
│   └── degrade.ts                   # 降级策略
├── qa/
│   ├── gate.ts                      # QA 门禁
│   ├── lint.ts                      # Lint 执行
│   └── index.ts
├── registry/
│   └── registry.ts                  # 页型注册表
├── render/
│   ├── index.ts
│   ├── pptx/
│   │   ├── index.ts
│   │   └── renderer.ts              # pptxgenjs 渲染
│   └── web/
│       ├── index.ts
│       └── SlideCanvas.tsx          # Web 渲染
└── templates/
    └── briefing/                    # ⚠️ 必须迁到 dailyBriefing
        └── ...（11 个文件）
```

**合计**：约 55 个文件。

---

## 3. 目标包结构

```
packages/slideEngine/
├── src/
│   ├── contracts/                   # 全部迁过来（无依赖）
│   │   ├── slideIr.ts
│   │   ├── pageType.ts
│   │   ├── geometry.ts
│   │   ├── capacity.ts
│   │   ├── theme.ts
│   │   └── lint.ts
│   ├── layout/                      # 纯函数
│   │   ├── measure.ts
│   │   ├── capacity.ts
│   │   └── degrade.ts
│   ├── qa/
│   │   ├── gate.ts
│   │   ├── lint.ts
│   │   └── index.ts
│   ├── registry/
│   │   └── registry.ts
│   ├── render/
│   │   ├── pptx/
│   │   │   └── renderer.ts
│   │   └── web/
│   │       └── SlideCanvas.tsx
│   ├── cli.ts                       # CLI（保留供 monorepo 跑）
│   ├── index.ts                     # 主入口
│   └── README-types.md              # SlideIR / 主题 token / 页型枚举说明
├── tests/
│   └── slideEngine.spec.ts
├── package.json
└── README.md
```

**严禁迁入**：`templates/briefing/*` —— 这是 dailyBriefing 的 domain/slides/

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                  "./src/index.ts",
    "./contracts":        "./src/contracts/index.ts",
    "./layout":           "./src/layout/index.ts",
    "./qa":               "./src/qa/index.ts",
    "./render/pptx":      "./src/render/pptx/index.ts",
    "./render/web":       "./src/render/web/index.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { runLayout } from './layout/measure';
export { runCapacity } from './layout/capacity';
export { runDegrade } from './layout/degrade';
export { runQaGate } from './qa/gate';
export { runLint } from './qa/lint';
export { renderPptx } from './render/pptx';
export { SlideCanvas } from './render/web';
export { registerPageType, getPageType } from './registry/registry';
export type { SlideIR, PageType, ThemeToken } from './contracts';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `pptxgenjs` | PPTX 渲染 |
| `react` | SlideCanvas |
| `zod` | SlideIR 校验 |

**禁止依赖**：

- ❌ `@aihub/db`（slideEngine 纯函数，不读 DB）
- ❌ `@aihub/news` / `@aihub/aiCore`（业务无关）
- ❌ **任何业务包**

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `dailyBriefing` | `import { renderPptx, runLayout } from '@aihub/slideEngine'` |
| `apps/web` | CLI（`pnpm slide:lint` / `slide:render`） |
| `apps/cron` | CLI（同上） |

**严禁被引用**：

- ❌ `dailyBriefing` 不得 import slideEngine 内部文件，必须通过 exports 字段

---

## 7. 边界规则

1. ✅ slideEngine 是**纯函数库**，零业务依赖
2. ✅ `templates/briefing/*` 全部迁到 dailyBriefing
3. ✅ 每个 `contracts/*` 类型都被 `domain/slides`（在 dailyBriefing）消费
4. ⚠️ `SlideCanvas.tsx` 是 React 组件但不带业务逻辑（仅几何 + token）
5. ❌ 禁止 slideEngine 知道"早报"或"幻灯片主题"任何业务概念
6. ❌ 禁止 slideEngine import `dailyBriefing`（单向依赖）

---

## 8. 迁移步骤

```bash
# P1.3 第 1 周（最干净的迁移）

mkdir -p packages/slideEngine/src/{contracts,layout,qa,registry,render/pptx,render/web}
mkdir -p packages/slideEngine/tests

# 1. contracts（无依赖，先迁）
cp -r src/lib/slide-engine/contracts/* packages/slideEngine/src/contracts/

# 2. layout
cp -r src/lib/slide-engine/layout/* packages/slideEngine/src/layout/

# 3. qa
cp -r src/lib/slide-engine/qa/* packages/slideEngine/src/qa/

# 4. registry
cp src/lib/slide-engine/registry/registry.ts packages/slideEngine/src/registry/registry.ts

# 5. render
cp -r src/lib/slide-engine/render/pptx/* packages/slideEngine/src/render/pptx/
cp -r src/lib/slide-engine/render/web/* packages/slideEngine/src/render/web/
cp src/lib/slide-engine/render/index.ts packages/slideEngine/src/render/index.ts

# 6. cli + index + tests
cp src/lib/slide-engine/cli.ts packages/slideEngine/src/cli.ts
cp src/lib/slide-engine/index.ts packages/slideEngine/src/index.ts
cp src/lib/slide-engine/slide-engine.test.ts packages/slideEngine/tests/slideEngine.spec.ts

# ⚠️ 不迁 templates/briefing/*（归 dailyBriefing）

# 7. 替换全局 import
# @/lib/slide-engine → @aihub/slideEngine
# @/lib/slide-engine/templates/briefing → @aihub/dailyBriefing/domain/slides

pnpm --filter @aihub/slideEngine typecheck
pnpm --filter @aihub/slideEngine test
pnpm slide:lint    # 验证 CLI 仍工作
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| `templates/briefing/*` 误迁入 slideEngine | 强制 grep 验证：迁完 slideEngine 内不含 `templates/` 目录 |
| `SlideCanvas.tsx` React 19 兼容 | 检查 peerDeps |
| CLI 找不到 | 保留 `slideEngine/src/cli.ts`，通过 `pnpm slide:*` 触发 |
| 单测 `slide-engine.test.ts` 跑通率 | 单测覆盖 layout / qa / degrade 全部分支 |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/slideEngine typecheck` 通过
- [ ] `pnpm --filter @aihub/slideEngine test` 通过
- [ ] `pnpm slide:lint` 跑通（CLI 仍可用）
- [ ] `pnpm slide:render` 输出示例 PPTX
- [ ] **slideEngine 包内不含 templates/ 目录**

---

## 11. 过期条件

- 切换排版引擎（slideEngine → Reveal.js / Marp）
- 引入 Web 渲染框架（Canvas → SVG）
- 引入模板热加载

---

**创建时间**：2026-09-07
