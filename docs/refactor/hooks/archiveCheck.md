---
name: archiveCheck
description: 文档过期检查（每季度跑一次）。在用户提到「文档清理」「归档过期 doc」「archive check」时触发。避免 docs/ 目录堆积过期文档。
---

# Archive Check Hook

## 1. 触发条件

- GitHub Actions 每月 1 号自动跑
- 或手动：`pnpm archive:check`

## 2. 检查逻辑

```bash
#!/usr/bin/env bash
# scripts/archive-check.sh

set -e

echo "📋 Checking docs for expiration..."

# 1. 超过 90 天未修改的 docs/archived/ 下的文件 → 提示物理删除
find docs/archived -name "*.md" -mtime +90 -print | while read f; do
  echo "⚠️  Stale archive (>90 days): $f"
done

# 2. docs/refactor/ 下的文件 → 检查是否标注"过期条件"
for f in $(find docs/refactor -name "*.md"); do
  if ! grep -q "过期条件" "$f"; then
    echo "❌ Missing '过期条件' section: $f"
  fi
done

# 3. docs/AI新闻 / docs/AI模型排行 / docs/前端UI / docs/参考资料 / docs/实施记录
# → 提醒作者评估是否需要合并 / 归档
find docs -maxdepth 1 -type d | while read d; do
  count=$(find "$d" -maxdepth 1 -name "*.md" | wc -l)
  if [ "$count" -gt 20 ]; then
    echo "💡 $d has $count files. Consider splitting."
  fi
done

echo "✅ Archive check done."
```

## 3. 边界规则

- ✅ 归档检查仅警告，不强制删除（删除走 PR）
- ❌ 禁止自动 git rm 任何文件
- ❌ 禁止修改 docs/ 内容（仅生成报告）

## 4. 验收清单

- [ ] 跑一次后输出清晰的归档建议清单
- [ ] 无任何文件被自动删除
- [ ] 报告可贴入 issue / PR 描述

## 5. 过期条件

- 引入 AI 文档质量评分（自动评估 freshness）
- 切换到 GitHub Issues 替代 docs 跟踪

---

**创建时间**：2026-09-07
