# 04 · 垃圾清理清单（保守版）

> 本文件给出**逐项标注**的清理建议。**所有操作需人工确认**，本文档**不直接执行任何删除**。
> 判定原则：能"用 git reflog 找回"的可以删，找不回的移入 `legacy/`。

---

## 1. `scripts/` 目录（33 个脚本）

### 1.1 🔴 明确删除（一次性/调试用途，零保留价值）

| 文件 | 用途 | 理由 |
|---|---|---|
| `backfill-briefing-toast.ts` | 一次性 schema 默认值回填 | 2026-08-31 用过一次，今后 schema 变更不会再有此类迁移 |
| `backfill-cover-images.ts` | 一次性封面图回填 | 已无更多无图新闻 |
| `backfill-news-fields.ts` | 一次性分类回填 | schema 已稳定 |
| `backfill-null-publish-dates.ts` | 一次性 epoch 时间戳清洗 | 数据已清洗 |
| `check-bili-cache.js` | 调试：查最新一条记录 | 硬编码 SQLite 路径，仅本地 |
| `check-empty.ts` | 调试：2026-09-02 空字段快照 | 一次性诊断 |
| `check-summary.ts` | 调试：summary 质量诊断 | 一次性诊断 |
| `cleanup-dirty-models.ts` | 一次性脏数据清理 | 模型发现逻辑已稳定 |
| `cleanup-pending-models.ts` | 一次性 7 个占位模型清理 | 已无同类数据 |
| `fix-daily-report-state.ts` | 一次性 phase/error 不一致修复 | 逻辑已稳定 |
| `fix-discovered-models.ts` | 一次性补官方 URL | scraper 已自动发现 |
| `render-real-pptx.ts` | 端到端演示工具 | 已完成使命 |
| `review-terms.ts` | 交互式审核脚本 | 一次性使用 |
| `smoke-v5-detail-pages.ts` | 一次性 smoke test | 详情页已上线 |
| `study-wechat-format.mjs` | 分析微信 HTML 结构 | wechat-mp.ts 已稳定 |
| `test-bili-api.cjs` | B 站 API 调试 | 硬编码 URL，无维护价值 |
| `test-bili-api.js` | B 站 API 调试 | 与 .cjs 版几乎相同，**重复** |
| `test-content-noencode.mjs` | 微信 content_noencode 调试 | 一次性脚本 |
| `test-is-ai-related.mjs` | AI 关键词过滤单元测试 | 逻辑已定 |
| `test-rsshub.mjs` | RSSHub 代理可用性测试 | 一次性脚本 |
| `test-wechat-e2e.mjs` | 微信全链路测试 | wechat-mp.ts 已稳定 |
| `test-wechat-parse.mjs` | wechat-mp.ts 单元测试 | 一次性 |
| `verify-models.ts` | 查 SQLite 模型快照 | 硬编码路径，仅本地 |
| `_check-bili-news.js` | 调试：查 NewsItem 字段 | 下划线开头，调试用 |
| `_check-db.ts` | 调试：查 TermDictionary | 下划线开头，调试用 |
| `_debug-render.ts` | 调试：slide-engine 渲染 | 下划线开头，调试用 |
| `eval-news-intent.ts` | 内嵌 Gold Set 评估 | 无 CI 集成，手动跑成本高 |
| `evaluate-terms.ts` | 周 cron 术语评估 | 若 cron 稳定可删 |
| `expand-synonyms.ts` | 同义词展开脚本 | 若 cron 稳定可删 |
| `extract-terms.ts` | 术语抽取脚本 | 若 cron 稳定可删 |

**小计：30 个脚本建议删除**

### 1.2 🟡 移入 `scripts/legacy/`（保留可追溯）

| 文件 | 用途 | 理由 |
|---|---|---|
| `diagnose-pptx-cache.ts` | PPTX 缓存诊断 | 功能仍在，但已属于"老诊断工具"，保留以便未来回看 |

**小计：1 个脚本建议归档**

### 1.3 🟢 必须保留（长期维护脚本）

| 文件 | 用途 | 理由 |
|---|---|---|
| `backfill-model-snapshots.ts` | 模型定价兜底刷新 | API 价格变动需要兜底，已在 `package.json` 注册 |
| `sync-news-sources.ts` | 同步 sources 配置到 DB | `NewsSource` 表变更时有用 |

**小计：2 个脚本保留**

---

## 2. 项目根目录非代码文件

### 2.1 🔴 明确删除（与项目无关或可重建）

| 文件 | 类型 | 处理 |
|---|---|---|
| `briefing-2026-09-02.pptx` | 旧版 PPT 产物 | 已存档到 R2，本地可删 |
| `briefing-2026-09-02-v2.pptx` | 新版 PPT 产物 | 已存档到 R2，本地可删 |
| `C盘清理/` | Windows 清理工具 | 与项目完全无关 |

### 2.2 🟡 移入 `docs/archived/` 或 `docs/legacy/`

| 文件 | 类型 | 目标位置 |
|---|---|---|
| `AIHub现阶段开发文档_2026_09_03.md` | 开发文档 | `docs/archived/` |
| `AIHub-Bug清单_2026_09_03.md` | Bug 清单 | `docs/archived/` |
| `AIHub现阶段问题.md` | 问题清单 | `docs/archived/` |
| `_doc_1630277866.md` | AI 生成评审报告 | `docs/archived/` |
| `_doc_46501878.md` | AI 生成文档 | `docs/archived/` |
| `_review_0901.md` | 质检报告 | `docs/archived/` |
| `_status.md` | 状态文档 | `docs/archived/` |

### 2.3 🟢 保留并合并

| 文件 | 处理 |
|---|---|
| `_overview.md` | 内容合并到 `docs/README-当前状态.md` |
| `_status_now.md` | 内容合并到 `docs/README-当前状态.md` |

---

## 3. 重复文件（Windows 路径大小写问题）

git status 中显示的以下重复项，**实际上是同一文件的不同大小写路径写法**（Windows 下 `scripts/` 与 `scripts\` 等价）：

| 重复对 | 实际状态 |
|---|---|
| `scripts/_check-bili-news.js` ≡ `scripts\_check-bili-news.js` | 同一文件 |
| `scripts/_debug-render.ts` ≡ `scripts\_debug-render.ts` | 同一文件 |
| `scripts/check-bili-cache.js` ≡ `scripts\check-bili-cache.js` | 同一文件 |
| `scripts/test-bili-api.cjs` ≡ `scripts\test-bili-api.cjs` | 同一文件 |
| `scripts/test-bili-api.js` ≡ `scripts\test-bili-api.js` | 同一文件 |

**处理**：
- 这不是"垃圾"，但 `git add` 时会重复索引
- 解决方案：在 `.gitattributes` 中加入 `* binary` 或 `git config core.ignorecase false`（不推荐，会破坏其他场景）
- 推荐：**直接在 .gitignore 中忽略反斜杠路径**

```gitignore
# .gitignore 追加
scripts\*
```

---

## 4. `docs/archived/` 下文档（50+ 个）

**判定**：**全部保留**，不动。

**理由**：
- 这些是项目演进的历史记录，删除不可逆
- 加一个 `docs/archived/INDEX.md` 做索引即可（按日期倒序 + 标签分类）
- 配合 `ARCHITECTURE.md` 作为"决策追溯"

**建议新增文件**：
```markdown
<!-- docs/archived/INDEX.md -->
# Archived Documents Index

> 此目录下存放项目历史文档，按日期倒序排列，仅供参考，不反映当前架构。
> 当前架构请参阅 [ARCHITECTURE.md](../../ARCHITECTURE.md)

## 2026-09
- `45-全面回扫与安全修复报告_2026.09.03.md` —— 安全审计
- `46-第二轮回扫与深层漏洞修复_2026.09.03.md` —— 安全审计
- ...
```

---

## 5. `prisma/dev.db`

**判定**：**保留本地**，但加进 `.gitignore`。

```gitignore
# .gitignore 追加
prisma/dev.db
prisma/dev.db-journal
```

**理由**：本地 SQLite 调试文件，不应进版本控制。

---

## 6. `snapshots/` 目录

**判定**：**保留**。

**理由**：`briefing-2026-09-02.json` 是 PPT 生成快照，用于回归测试。

---

## 7. 汇总操作清单

### 7.1 可安全执行的删除（合计 ~33 项）

```bash
# 一次性删除 30 个调试脚本
rm scripts/backfill-briefing-toast.ts \
   scripts/backfill-cover-images.ts \
   scripts/backfill-news-fields.ts \
   scripts/backfill-null-publish-dates.ts \
   scripts/check-bili-cache.js \
   scripts/check-empty.ts \
   scripts/check-summary.ts \
   scripts/cleanup-dirty-models.ts \
   scripts/cleanup-pending-models.ts \
   scripts/fix-daily-report-state.ts \
   scripts/fix-discovered-models.ts \
   scripts/render-real-pptx.ts \
   scripts/review-terms.ts \
   scripts/smoke-v5-detail-pages.ts \
   scripts/study-wechat-format.mjs \
   scripts/test-bili-api.cjs \
   scripts/test-bili-api.js \
   scripts/test-content-noencode.mjs \
   scripts/test-is-ai-related.mjs \
   scripts/test-rsshub.mjs \
   scripts/test-wechat-e2e.mjs \
   scripts/test-wechat-parse.mjs \
   scripts/verify-models.ts \
   scripts/_check-bili-news.js \
   scripts/_check-db.ts \
   scripts/_debug-render.ts \
   scripts/eval-news-intent.ts \
   scripts/evaluate-terms.ts \
   scripts/expand-synonyms.ts \
   scripts/extract-terms.ts

# 删除根目录 PPT 与无关目录
rm briefing-2026-09-02.pptx briefing-2026-09-02-v2.pptx
rm -rf "C盘清理"
```

### 7.2 建议移入归档的操作（合计 ~7 项）

```bash
# 创建归档目录
mkdir -p docs/archived/2026-09-root-docs

# 移动根目录散落文档
mv AIHub现阶段开发文档_2026_09_03.md docs/archived/2026-09-root-docs/
mv AIHub-Bug清单_2026_09_03.md docs/archived/2026-09-root-docs/
mv AIHub现阶段问题.md docs/archived/2026-09-root-docs/
mv _doc_1630277866.md docs/archived/2026-09-root-docs/
mv _doc_46501878.md docs/archived/2026-09-root-docs/
mv _review_0901.md docs/archived/2026-09-root-docs/
mv _status.md docs/archived/2026-09-root-docs/

# 移动 legacy 脚本
mv scripts/diagnose-pptx-cache.ts scripts/legacy/
mkdir -p scripts/legacy
mv scripts/diagnose-pptx-cache.ts scripts/legacy/

# 合并到 README-当前状态.md（手动操作）
# 把 _overview.md 和 _status_now.md 的内容合并到 docs/README-当前状态.md
# 然后删除 _overview.md 和 _status_now.md
```

### 7.3 `.gitignore` 追加项

```gitignore
# 本地 SQLite
prisma/dev.db
prisma/dev.db-journal

# Windows 反斜杠路径
scripts\*

# 临时调试文件
*.tmp
*.swp
.DS_Store
```

---

## 8. 清理后的预期效果

| 维度 | 清理前 | 清理后 | 减少 |
|---|---|---|---|
| `scripts/` 文件数 | 33 | 3（+1 legacy） | -29 |
| 根目录散落文档 | 10 | 0 | -10 |
| 根目录 PPT | 2 | 0 | -2 |
| 无关目录 | 1（C盘清理） | 0 | -1 |
| **总计** | | | **~42 项清理** |

---

## 9. ⚠️ 执行前的最后检查

- [ ] 已 `git add -A` + `git commit` 当前所有改动（确保可回滚）
- [ ] 已确认没有 CI 在跑
- [ ] 已通知所有协作者本次清理的范围
- [ ] 已在 Slack/微信同步"清理窗口"
- [ ] 已准备好 `git reflog` / `git fsck --lost-found` 找回预案

---

> 最后修订：2026-09-04
