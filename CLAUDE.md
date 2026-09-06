# AIHub — Claude Code 工作约定

> 本文件是 **Claude Code** 在 AIHub 仓库中工作的入口。
> **最重要的章节是第 5 节"绝对禁止的操作"**——任何破坏性动作前请先读。

---

## 1. 项目一句话

AIHub 是毕业设计 MVP 平台，集成 **AI 新闻聚合 / AI 模型排行 / B 站 UP 主追踪 / AI 早报（PPT 自动生成）** 四大模块。

技术栈：Next.js 14 (App Router) + Prisma 6 + tRPC 11 + TypeScript 5；存储 = Postgres(dev SQLite) + Cloudflare R2 + Upstash Redis。

## 2. 工作区规则文件（按优先级）

| 文件 | 用途 |
|---|---|
| `.cursor/rules/no-destructive-ops.mdc` | **禁止破坏性操作**（删除/重置/clean） |
| `.cursor/rules/backup-before-cleanup.mdc` | **删除前必须确认 + 备份** |
| `.cursor/rules/commit-threshold.mdc` | **24h 未 commit 警告** |
| `.cursor/rules/00-clarify-before-act.mdc` | 先问再做（≥95% 把握才动手） |
| `.cursor/rules/01-no-doc-spam.mdc` | 文档节制（不新建重复文档） |
| `.cursor/rules/02-strict-bug-fix.mdc` | Bug 修复六步流程 |
| `.cursor/rules/03-solid-code-style.mdc` | 代码规范与长度硬约束 |
| `.cursor/rules/04-no-bloat-refactor.mdc` | 过长代码强制重构 |

## 3. 关键约束（违反前先问）

- **多租户**：所有 DB 操作必须经 `createTenantPrisma(ctx)`，禁止直接 `new PrismaClient()`；缺失 `tenantId` 即拒绝。
- **软删除**：仅 9 个模型含 `deletedAt`，不在白名单的模型禁止加 `deletedAt`。
- **AI Key 解析**：`src/lib/ai/key-resolver.ts` 是唯一入口，禁止组件内直接读 env。
- **配色变量**：所有颜色用 `src/app/globals.css` 的 CSS 变量，禁止硬编码 `#xxx`。
- **图标**：统一 `@tabler/icons-react`，不引入 lucide/heroicons。

## 4. 命令速查

```bash
pnpm typecheck        # 全量类型检查
pnpm test:rankings    # 仅算法
pnpm test:usage       # 仅用量计费
pnpm test:slides      # 仅 slide-engine
pnpm slide:lint       # 仅 slide IR lint
```

> **禁止**用 `cat / head / tail / find` 等基础命令去读源码。用 `Read`/`Grep`/`Glob` 工具。

## 5. 绝对禁止的操作（违反即 P0 事故）

下列操作**未经用户明确确认前严禁执行**：

### 5.1 文件删除（最高风险）

- ❌ `rm -rf`（任何路径）
- ❌ `Remove-Item -Recurse`（PowerShell）
- ❌ `Delete` 工具删除非本次会话新建的文件
- ❌ 删除 `docs/`、`docs/archived/`、`docs/architecture/`、`docs/架构设计/`、`docs/refactor/` 下任何文件
- ❌ 删除 `src/lib/` 下任何模块目录（news、bilibili、slide-engine、rankings、observability 等）

**必须先做的事**：
1. 用 `Test-Path` 确认文件存在
2. 告诉用户"这个文件是 X，作用是 Y"
3. 询问"可以删除吗？建议备份到 Z 吗？"
4. 等到"是"才动手

### 5.2 Git 危险操作

- ❌ `git reset --hard`（未 commit 文件会丢）
- ❌ `git clean -fd`（会删所有 untracked）
- ❌ `git push --force` 到 main 分支
- ❌ `git checkout .` 或 `git restore .`（覆盖 working tree）
- ❌ `git commit --amend` 已 push 的 commit

**必须先做的事**：
1. 跑 `git status --porcelain` 看清楚
2. 列出"这个操作会影响哪些文件"
3. 询问"可以执行吗？"

### 5.3 文件覆盖

- ❌ `Write` 工具覆盖**非本次会话创建**的文件（除非用户明确说"重写 X"）
- ❌ 批量 `StrReplace` 多个文件前不告诉用户

### 5.4 不可逆迁移

- ❌ `prisma migrate dev --name X` 后直接 `prisma db push --force-reset`
- ❌ 直接 DROP TABLE
- ❌ 修改 `prisma/schema.prisma` 后不告诉用户就跑 `prisma generate`

## 6. Subagent 约定

| 任务类型 | 用谁 |
|---|---|
| 大范围探索代码 | `generalPurpose`（只读） |
| 单文件编辑 | main agent |
| Bug 审查 | `bugbot` |
| 安全审查（PR） | `security-review` |

**Subagent 也必须遵守第 5 节**——它执行破坏性操作前必须先告诉 main agent。

## 7. Stop hook（占位）

`.claude/hooks/stop.md` ——会话结束前自检是否需要追加新约束到 CLAUDE.md。

## 8. 维护者

本仓库所有 `CLAUDE.md` / `.cursor/rules/*` / `.claude/*` 的变更需 owner 确认。

---

## 过期条件

本文件在以下任一情况发生时应被审查：

- 项目技术栈变更（换数据库、换框架）
- 工作区规则文件被删除或重命名
- 出现新的破坏性操作类型（如新的部署工具）

审查周期：每 3 个月或重大模型升级后。
