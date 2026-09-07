---
name: codeReviewAndMigrate
description: 代码审查与迁移专项 SKILL，专为 AIHub 项目从 d:\1Money\aihub 迁移到 D:\AI Hub 设计。涵盖 8 大类 AI 编码常见问题（安全、CRUD 完整性、并发、错误处理、边界、资源、测试、架构一致性），识别非必要功能 / 代码以决定是否迁移。在用户提到「代码审查」「迁移项目」「AI 编码问题」「扫描 src」「review code」「迁移到 D:\AI Hub」时必须触发。绝不直接修改代码——必须先按 §1 流程产出审查报告 + 迁移决策清单（迁移 / 修复后迁移 / 不迁移），让用户拍板。
---

# Code Review & Migrate Skill

## 1. 调用流程（严格六步，禁止跳步）

### Phase 1：识别任务边界

**问用户 3 个关键问题**：

1. **审查范围**（哪些目录 / 文件）
   - 全部 src/
   - 仅 src/lib/
   - 仅 src/server/
   - 自定义清单
2. **严重度阈值**（哪个级别触发阻断）
   - 致命（必须修复才能迁移）
   - 严重（建议修复）
   - 一般（记录但不阻断）
3. **执行方式**
   - 仅本 skill 自己跑
   - 本 skill + 后台 subagent 并行

**输出**：边界声明（如"审查 src/lib/ 与 src/server/，致命问题阻断迁移"）。

### Phase 2：8 大类逐项扫描

按 [`docs/AI编码常见问题诊断清单.md`](../../../docs/AI编码常见问题诊断清单.md) 的 8 大类 + 子项，**逐项扫描**。

**输出**：每个文件 / 模块的审查结果矩阵：

| 文件 | 安全 | CRUD | 并发 | 错误 | 边界 | 资源 | 测试 | 架构 | 总分 |
|---|---|---|---|---|---|---|---|---|---|
| src/lib/auth.ts | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | ❌ | ✅ | 6/8 |
| ... | | | | | | | | | |

### Phase 3：迁移决策

按 [`docs/refactor/migrationChecklist.md`](../../../docs/refactor/migrationChecklist.md) §2 三类处理：

| 决策 | 标准 | 动作 |
|---|---|---|
| ✅ 迁移 | 通过审查且核心业务价值 | 复制 |
| ⚠️ 修复后迁移 | 有问题但修复成本低 | 标记 + 修复 + 复制 |
| ❌ 不迁移 | 一次性脚本 / 弃用 / 死代码 / 调试产物 | 移到 deprecated/ 或丢弃 |

**输出**：迁移清单（每文件标注决策）。

### Phase 4：风险评估

| 风险 | 缓解 |
|---|---|
| 误删核心代码 | 迁移前 7 天双仓并行 + git tag |
| 修复引入新 Bug | 单 PR 一修复 + 单测覆盖 |
| 路径引用错乱 | 全量 grep 替换相对路径 |
| 配置文件覆盖 | 优先保留 D:\AI Hub 版本（不覆盖） |

### Phase 5：用户确认

**用 AskQuestion 让用户拍板**：

```
Q1: 扫描结果是否正确？
Q2: 不迁移清单是否同意？
Q3: 修复后迁移的优先级？
Q4: 是否立刻开始迁移？
```

### Phase 6：执行迁移

按 [`migrationChecklist.md`](../../../docs/refactor/migrationChecklist.md) §6 4 批次执行：

- **M1**：配置文件（30 min）
- **M2**：业务核心 lib/ + server/（4-6 h）
- **M3**：UI（4-6 h）
- **M4**：运维 / 文档 / 测试（2-4 h）

每批完成后 `git commit` + 打 tag。

---

## 2. 8 大类扫描要点

### 2.1 安全漏洞（致命，阻断）

| 检查项 | 工具 |
|---|---|
| 硬编码 API Key | `grep -r "sk-\|sk-ant-\|AIza" src/` |
| SQL 注入 | 查 Prisma 是否全用参数化 |
| 命令注入 | grep `exec/spawn` 入参处理 |
| 鉴权遗漏 | grep `publicProcedure` 排除已知 |
| 错误堆栈泄露 | grep `catch.*err.*throw err` |

### 2.2 CRUD 完整性

| 检查项 | 工具 |
|---|---|
| 事务缺失 | grep `$transaction` 缺失处 |
| 幂等键缺失 | grep POST/PUT/DELETE handler |
| 乐观锁缺失 | grep `version` `updatedAt` |
| N+1 查询 | grep `findMany` 内嵌套 `findFirst` |

### 2.3 并发与竞态

| 检查项 | 工具 |
|---|---|
| 分布式锁无 ID | grep `withLock` 调用 |
| TOCTOU 漏洞 | grep `findFirst` 后 `update` 模式 |
| 异步遗漏 await | tsc 已能检测 |

### 2.4 错误处理

| 检查项 | 工具 |
|---|---|
| 空 catch | grep `catch.*\{\s*\}` |
| 错误吞掉 | grep `catch.*console.log` 无 throw |

### 2.5 边界条件

| 检查项 | 工具 |
|---|---|
| 除零 | grep `/ count\|/ total` 模式 |
| 空数组处理 | grep `forEach` 空数组分支 |
| 时区 | grep `getUTCHours\|toISOString` |

### 2.6 资源管理

| 检查项 | 工具 |
|---|---|
| 流未关闭 | grep `createReadStream` 缺 close |
| 定时器未清理 | grep `setInterval` 缺 clearInterval |
| 全局 Map 缓存无上限 | grep `new Map()` 在模块顶层 |

### 2.7 测试质量

| 检查项 | 工具 |
|---|---|
| happy path only | grep test 文件 `it(` 仅 1 个 |
| 断言无意义 | grep `expect.*toBeTruthy` 模式 |

### 2.8 架构一致性

| 检查项 | 工具 |
|---|---|
| 幻觉 API | 查 tsc + 运行时验证 |
| 多文件一致性 | grep 接口定义与调用方 |
| 代码重复 | 视觉审查 + 简单 diff |

---

## 3. Subagent 分工建议

| Subagent | 负责 | 输出 |
|---|---|---|
| SA-1 | 安全（§2.1） | 安全报告 |
| SA-2 | CRUD + 并发（§2.2 + §2.3） | 数据完整性报告 |
| SA-3 | 错误 + 边界（§2.4 + §2.5） | 健壮性报告 |
| SA-4 | 资源 + 测试 + 架构（§2.6-2.8） | 工程质量报告 |
| main | 整合 + 决策 + 用户拍板 | 迁移清单 |

---

## 4. 不在本 SKILL 范围

- ❌ UI 改造（用 `workbench-ui-designer` skill）
- ❌ 新功能开发
- ❌ 性能调优（除非审查发现明确瓶颈）
- ❌ 数据库 schema 演进（独立 skill 待建）

---

## 5. 验证方式

每个修复后必须跑：

```bash
pnpm typecheck       # 类型检查
pnpm lint            # ESLint
pnpm test            # 单元测试
pnpm build           # 构建
pnpm dev             # 启动验证
```

涉及鉴权的修复，必须用**两个测试账号**（不同租户 + 同租户不同用户）验证越权路径。

---

## 6. 命名规范

- 审查报告文件：`docs/refactor/audit/<date>-<scope>.md`
- 修复 PR 标题：`fix(audit): <bug-id> <short-desc>`
- 迁移 tag 格式：`v<date>-migrate-<batch>`（如 `v2026.09.07-migrate-m1`）

---

## 7. 验收清单

- [ ] 扫描范围明确
- [ ] 严重度阈值明确
- [ ] 8 大类逐项检查清单执行
- [ ] 迁移决策矩阵完成（迁移 / 修复后迁移 / 不迁移）
- [ ] 用户对决策矩阵已确认
- [ ] 4 批次执行计划已排
- [ ] 每批完成后 git commit + tag

---

## 8. 过期条件

- 迁移完成 → 本 skill 归档
- AI 编码问题清单变更 → 同步更新 §2
- 引入 codegen / AI 自动审查工具 → 拆分新 skill

---

**创建时间**：2026-09-07
**配套文档**：
- [`docs/AI编码常见问题诊断清单.md`](../../../docs/AI编码常见问题诊断清单.md)
- [`docs/refactor/migrationChecklist.md`](../../../docs/refactor/migrationChecklist.md)
- [`docs/refactor/00-总体迁移设计.md`](../../../docs/refactor/00-总体迁移设计.md)
