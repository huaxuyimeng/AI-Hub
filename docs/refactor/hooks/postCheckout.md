---
name: postCheckout
description: 切换分支后自动重装依赖。在用户提到「切换分支」「post-checkout」「自动 pnpm install」时触发。避免"在我电脑上能跑"的经典问题。
---

# Post-Checkout Hook

## 1. 触发条件

- `.git/hooks/post-checkout`（git 自身）
- 或 Husky 配置

## 2. 检查逻辑

```bash
#!/usr/bin/env bash
# .husky/post-checkout

# 只在分支切换时触发（参数：prev_head, new_head, branch_checkout）
prev_head=$1
new_head=$2
branch_checkout=$3

# 0 = file checkout, 1 = branch checkout
if [ "$branch_checkout" != "1" ]; then
  exit 0
fi

echo "🔄 Branch changed. Syncing dependencies..."

# 检查 pnpm-lock.yaml 是否变了
changed_files=$(git diff-tree -r --name-only --no-commit-id $prev_head $new_head 2>/dev/null || true)

if echo "$changed_files" | grep -q "pnpm-lock.yaml"; then
  echo "📦 pnpm-lock.yaml changed. Running pnpm install..."
  pnpm install --frozen-lockfile
else
  echo "✅ No dep changes."
fi
```

## 3. 边界规则

- ✅ 切换到新分支 → 自动 pnpm install
- ❌ 禁止在 file checkout 触发（性能浪费）
- ❌ 禁止 pnpm install 失败时阻塞 checkout

## 4. 配置位置

- `.husky/post-checkout`（monorepo 阶段）
- 或 `package.json#husky` 字段

## 5. 验收清单

- [ ] 切换分支后 → pnpm install 自动跑
- [ ] 单文件 checkout → 不触发
- [ ] pnpm install 失败时给清晰提示

## 6. 过期条件

- 切换到 pnpm 9 的 `pnpm fetch` 缓存策略
- 切换 monorepo 工具（turborepo 的远程缓存）

---

**创建时间**：2026-09-07
