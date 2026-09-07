# 00 · AIHub 重构迁移文档索引

> 本目录是 **monorepo + 模块化重构期间的施工设计**。
> 入口设计：[`00-总体迁移设计.md`](./00-总体迁移设计.md)（总设计）
> 入口状态：[`git-现状盘点-2026-09-07.md`](./git-现状盘点-2026-09-07.md)（重构前快照）

---

## 目录结构

```
docs/refactor/
├── 00-总体迁移设计.md          ← 总设计（4 周路线图 + 模块清单）
├── 00-design.md                ← 当前 UI 现状档案（防退化基线）
├── git-现状盘点-2026-09-07.md   ← 重构前 Git 快照
│
├── infra/                       ← 基础设施层设计（驼峰命名）
│   ├── monorepoTopology.md      ← pnpm workspace 顶层架构
│   ├── envLayering.md           ← 环境 5 层分层设计
│   ├── dbMultiProvider.md       ← 数据库多 provider 配置
│   ├── packageContract.md       ← 包契约规范（占位：infra/.gitkeep）
│   ├── depCruiser.md            ← dependency-cruiser 规则（占位）
│   ├── riskRegister.md          ← 风险登记表（占位）
│   ├── observability.md         ← 日志/告警/锁统一规范（占位）
│   └── testing-isolation.md     ← 测试隔离设计（已写）
│
├── modules/                     ← 14 个业务模块设计（驼峰）
│   ├── auth.md
│   ├── chat.md
│   ├── projects.md
│   ├── usage.md
│   ├── aiCore.md
│   ├── news.md
│   ├── rankings.md
│   ├── bilibili.md
│   ├── dailyBriefing.md
│   ├── slideEngine.md
│   ├── theme.md
│   ├── settings.md
│   ├── discovery.md
│   └── cleanup.md
│
├── benchmark/                   ← 标杆项目调研（驼峰）
│   ├── calCom.md
│   ├── plausible.md
│   ├── outline.md
│   └── calDotCom.md
│
├── skills/                      ← 7 个新 skill 设计（驼峰）
│   ├── addProvider.md
│   ├── addParser.md
│   ├── addCron.md
│   ├── fixBug.md
│   ├── addModule.md
│   ├── updateSnapshot.md
│   └── reviewTerms.md
│
├── hooks/                       ← 4 个新 hook 设计（驼峰）
│   ├── preCommit.md
│   ├── postCheckout.md
│   ├── archiveCheck.md
│   ├── monorepoBoundary.md
│   └── commitMsg.md              ← commit 消息规范检查
│
├── bugs/                        ← 12 条剩余 Bug 修复方案（驼峰）
│   ├── b05-expireRefreshAccess.md   ← 🔴 高危
│   ├── b06-newsByModelLimitUnbounded.md
│   ├── b08-orphanCleanupLoop.md
│   ├── b09-pseudoTenantSystem.md
│   ├── b12-appSecretWeak.md
│   ├── b13-injectTenantIdDeepStub.md ← 🟡 中危
│   ├── b14-softDeleteReadOps.md
│   ├── b16-sidebarCollapseRace.md
│   ├── b17-chatPrefillDead.md
│   ├── b18-settingsMutationOnChange.md ← 🟢 低危
│   ├── b19-chatOptimisticUpdate.md
│   ├── b23-aihubRestKeyDead.md
│   └── b28-toPublicProjectLeak.md
│
└── env/                         ← 5 层环境变量模板
    ├── .env.base.example
    ├── .env.development.example
    ├── .env.local.example
    ├── .env.production.example
    ├── .env.secret.example
    └── pnpm-workspace.yaml.example
```

---

## 命名约定

- **目录名**：全部 **驼峰（camelCase）**——按用户 2026-09-07 约定
- **文件名**：同驼峰（不带编号前缀也可带 `00-` 前缀）
- ❌ **禁止**：中划线 `-`、下划线 `_`、点 `.`
- 例外：`infra/` `modules/` `benchmark/` 等根目录名是约定俗成的复数名词（保留）

---

## 阅读顺序建议

| 角色 | 推荐阅读路径 |
|---|---|
| **新加入工程师** | `00-总体迁移设计.md` → `infra/monorepoTopology.md` → `infra/envLayering.md` → `infra/testing-isolation.md` → 各 `modules/<name>.md` |
| **做迁移的工程师** | `00-总体迁移设计.md` §5 4 周路线图 → 当前周的 `modules/<name>.md` |
| **做架构评审** | `00-总体迁移设计.md` → `infra/*` → `benchmark/*` |
| **新模块作者** | `00-总体迁移设计.md` §3 模块清单 → 对应 `modules/<name>.md` → `infra/packageContract.md`（占位） |

---

## 与其他文档目录的关系

| 现有目录 | 关系 |
|---|---|
| `docs/architecture/` | **被替代**——重构完成后归档到 `docs/archived/architecture/` |
| `docs/架构设计/` | **保留为历史档案**——本次不动 |
| `docs/archived/` | 本次完成后清理过期项 |
| `docs/AI新闻/` / `docs/AI模型排行/` | 业务文档，**与重构正交** |

---

## 状态图例

- ✅ 已完成（实现 + 文档齐）
- 🟡 进行中（设计完成，实现中）
- ⚪ 设计稿（仅文档）
- ❌ 占位（仅占位文件，待补内容）

> **2026-09-07 更新**：本轮新增 59 份文档（modules 14 + infra 3 + skills 7 + hooks 5 + bugs 12 + benchmark 4 + env 6 + commitMsg 1 + index 1 + 索引更新 5）。
> 所有新建文档均遵守驼峰命名、无删除、含"过期条件"段落。

---

**最后更新**：2026-09-07
