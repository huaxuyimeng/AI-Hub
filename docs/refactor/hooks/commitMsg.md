---
name: commitMsg
description: Commit 消息规范检查（commit-msg hook）。在用户提交代码时触发。绝不拒绝有效 commit——仅拒绝不符合规范的格式。
---

# Commit Message 规范

## 1. 格式

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

### 1.1 Type（必填）

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 重构（非功能变更） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具变更 |
| `ci` | CI 配置 |
| `revert` | 回滚 |

### 1.2 Scope（可选）

与 `docs/refactor/` 模块对应：

- `modules/<name>`：模块设计变更
- `infra/<name>`：基础设施设计变更
- `skills/`：skill 设计变更
- `hooks/`：hook 设计变更
- `bugs/`：Bug 修复方案变更
- `benchmark/`：标杆调研变更
- `env/`：环境变量模板变更

### 1.3 Summary（必填）

- ≤ 72 字符
- 动词开头（add / fix / update / remove / migrate）
- 不带句号

### 1.4 Body（可选）

- 解释 **Why** 而非 What
- 每行 ≤ 72 字符

### 1.5 Footer（可选）

- `BREAKING CHANGE:` 大破坏性变更
- `Closes: #123`：关联 issue

---

## 2. 拒绝规则

```bash
#!/usr/bin/env bash
# .husky/commit-msg

commit_msg=$(cat "$1")
first_line=$(echo "$commit_msg" | head -n1)

# 规则 1：必须有 type
if ! echo "$first_line" | grep -qE '^[a-z]+(\([a-z/]+\))?: '; then
  echo "❌ Commit message must start with type(scope): description"
  echo "   Example: docs(refactor): add monorepo topology design"
  exit 1
fi

# 规则 2：summary ≤ 72 字符
summary_len=${#first_line}
if [ "$summary_len" -gt 72 ]; then
  echo "❌ Summary is $summary_len chars (max 72)"
  exit 1
fi

# 规则 3：summary 不能以句号结尾
if echo "$first_line" | grep -qE '\.$'; then
  echo "❌ Summary must not end with a period"
  exit 1
fi

# 规则 4：body 每行 ≤ 72 字符
body=$(echo "$commit_msg" | tail -n +2)
while IFS= read -r line; do
  if [ ${#line} -gt 72 ]; then
    echo "❌ Body line exceeds 72 chars: $line"
    exit 1
  fi
done <<< "$body"

echo "✅ Commit message validated."
exit 0
```

---

## 3. 示例

### ✅ 有效

```
docs(refactor): add monorepo topology design

建立 apps/ + packages/ monorepo 顶层架构，
包括 pnpm-workspace.yaml、exports 字段约束、
包依赖图（ARCHITECTURE.md §3）。

关联: CLAUDE.md §4
```

### ❌ 无效

```
添加了一些文档                     # 缺 type
docs: 添加了一些文档。            # summary 以句号结尾
docs: a                          # summary 太短（<10 字符）
docs: this is a very long commit message that exceeds seventy two characters and is therefore invalid  # 超过 72 字符
```

---

## 4. 恢复预案

如果 commit 被 hook 拒绝，修正后重新提交：

```bash
# 修正后重新提交
git commit -v  # -v 显示 diff
```

---

**创建时间**：2026-09-07
