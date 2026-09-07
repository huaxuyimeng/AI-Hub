---
name: monorepoBoundary
description: Monorepo 跨包导入边界检查（dependency-cruiser 包装）。在用户提到「跨包 import」「包边界」「boundary check」时触发。是 preCommit hook 的子集，但可单独跑。
---

# Monorepo Boundary Hook

## 1. 触发条件

- `preCommit` 自动调用
- 或手动：`pnpm depcruise --validate`

## 2. 规则配置

```js
// .dependency-cruiser.cjs

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-package-deep-import',
      severity: 'error',
      comment: '禁止深路径导入其他包内部文件',
      from: { path: '^packages/[^/]+/' },
      to: {
        path: '^packages/[^/]+/src/',
        pathNot: '^packages/[^/]+/src/index\\.ts$',
      },
    },
    {
      name: 'no-circular-in-packages',
      severity: 'error',
      comment: '包内禁止循环依赖',
      from: { path: '^packages/[^/]+/' },
      to: { path: '^packages/[^/]+/', circular: true },
    },
    {
      name: 'no-apps-import-internals',
      severity: 'error',
      comment: 'apps 不允许被包引用',
      from: { path: '^packages/' },
      to: { path: '^apps/.*/src/' },
    },
    {
      name: 'no-db-import-from-ui',
      severity: 'error',
      comment: 'UI 包不直接 import db（必须经 service 层）',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/db/src/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
```

## 3. 边界规则（业务层）

| 规则 | 说明 |
|---|---|
| `dailyBriefing` 可依赖 `news` / `aiCore` / `slideEngine` | 编排层 |
| `news` 不可依赖 `dailyBriefing` | 反向禁止 |
| `slideEngine` 不可被业务包 import `templates/briefing/*` | 这是 dailyBriefing 的 |
| `apps/web` 不允许被任何包 import | 顶层入口 |
| `db` 不允许 import 任何业务包 | 基础设施最底 |

## 4. 验收清单

- [ ] `pnpm depcruise --validate` 通过（0 violation）
- [ ] 故意 import `@aihub/news/src/parsers/wechat-mp` → 被拒绝
- [ ] 故意 `dailyBriefing → news` 反向 → 被拒绝

## 5. 过期条件

- 切换到 turborepo / nx 的内置 boundary 检查
- 引入 codegen 自动生成依赖图

---

**创建时间**：2026-09-07
