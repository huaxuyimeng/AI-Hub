---
name: preCommit
description: 提交前自动检查（lint + typecheck）。在用户提到「commit 前检查」「提交规范」「pre-commit hook」时触发。绝不绕过 — 必须所有检查通过才能 commit。
---

# Pre-Commit Hook

## 1. 触发条件

- `.git/hooks/pre-commit`（git 自身）
- 或 Husky 配置（推荐 monorepo 阶段启用）

## 2. 检查项（顺序）

```bash
#!/usr/bin/env bash
# .husky/pre-commit

set -e

echo "🔍 [1/4] lint..."
pnpm lint

echo "🔍 [2/4] typecheck..."
pnpm typecheck

echo "🔍 [3/4] monorepo boundary..."
pnpm depcruise --validate .dependency-cruiser.cjs || {
  echo "❌ Cross-package import violation. Run 'pnpm depcruise' for details."
  exit 1
}

echo "🔍 [4/4] unit tests (changed packages)..."
pnpm -r --filter '[origin/main]' test 2>/dev/null || pnpm test

echo "✅ All pre-commit checks passed."
```

## 3. 性能预算

| 检查 | 目标时长 |
|---|---|
| lint | ≤ 30s |
| typecheck | ≤ 60s |
| depcruise | ≤ 10s |
| unit tests | ≤ 60s |
| **总计** | ≤ 160s |

## 4. 边界规则

- ✅ 任何检查失败 → 中止 commit（exit 1）
- ✅ 提供 `git commit --no-verify` 绕过（仅紧急情况）
- ❌ 禁止修改业务代码绕过 hook

## 5. 配置位置

- 单体阶段：`package.json#husky` 字段
- monorepo 阶段：`.husky/pre-commit`（根目录）

## 6. 验收清单

- [ ] 故意触发 lint 错误 → commit 被拒绝
- [ ] 故意触发 typecheck 错误 → commit 被拒绝
- [ ] 故意引入深路径 import → depcruise 拒绝
- [ ] 所有检查通过 → commit 成功

## 7. 过期条件

- 切换到 lefthook / simple-git-hooks
- 切换到 trunk-based 开发（commit 不再关键）

---

**创建时间**：2026-09-07
