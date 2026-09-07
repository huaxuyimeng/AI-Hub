# migrationChecklist · AI 编码问题诊断检查清单（迁移专项）

> 创建于 2026-09-07
> 适用：迁移 `D:\1Money\aihub` → `D:\AI Hub` 前的代码审查
> 参考：`D:\1Money\aihub\docs\AI编码常见问题诊断清单.md`
> 状态：**待扫描**（批次 B 执行）

---

## 1. 使用说明

### 1.1 何时使用

- 迁移前：识别**可丢弃**的非必要功能 / 代码
- 迁移中：识别**必须保留**的核心代码
- 迁移后：识别**遗留问题**待后续修复

### 1.2 8 大类审查维度

1. 安全漏洞
2. 增删改查完整性
3. 并发与竞态条件
4. 错误处理
5. 边界条件与逻辑错误
6. 资源管理
7. 测试质量
8. 架构与代码一致性

---

## 2. 迁移决策矩阵

按审查结果对**每个文件 / 模块**做三类处理：

| 决策 | 标准 | 动作 |
|---|---|---|
| ✅ **迁移** | 通过审查且有核心业务价值 | 复制到 D:\AI Hub |
| ⚠️ **修复后迁移** | 有问题但修复成本低 | 标记 + 修复 + 复制 |
| ❌ **不迁移** | 一次性脚本 / 弃用功能 / 死代码 / 调试产物 | 移到 `D:\AI Hub\deprecated\` 或丢弃 |

---

## 3. 检查清单（8 大类逐项）

### 3.1 安全漏洞（必查，否则阻断迁移）

- [ ] **1.1 硬编码敏感信息**
  - API Key / DB 密码 / JWT Secret 是否在代码中明文
  - `.env` 是否在 `.gitignore`
  - 示例代码占位符是否被误用为真实密钥
- [ ] **1.2 注入攻击**
  - SQL 是否全用参数化（Prisma 自动，无问题）
  - 命令执行是否过滤输入
  - 模板渲染是否防 XSS（React 默认转义）
- [ ] **1.3 认证与授权碎片化**
  - 所有 tRPC procedure 是否走 `protectedProcedure` / `adminProcedure`
  - 公开路由（`publicProcedure`）是否有意为之（已知 `fetch-news` cron）
  - 敏感操作是否需要额外 role 校验
- [ ] **1.4 敏感数据泄露**
  - 日志是否打印 token / password
  - API 响应是否返回多余字段（toPublicProject 等）
  - 错误信息是否暴露堆栈
- [ ] **1.5 不安全的加密**
  - 密码是否用 bcrypt（已有）/ argon2
  - JWT Secret 是否硬编码（CLAUDE.md §3 强约束 env）
  - 随机数是否用 `crypto`（不用 `Math.random`）

### 3.2 增删改查完整性

- [ ] **2.1 事务边界**
  - 多表写入是否包裹 `$transaction`
  - 事务失败回滚逻辑
- [ ] **2.2 幂等性**
  - 写操作是否支持幂等键（POST / PUT / DELETE）
  - 网络超时重试是否产生重复写入
  - 前端按钮防抖
- [ ] **2.3 数据库约束**
  - `NOT NULL` 是否完整
  - 唯一性靠 DB 索引 vs 应用层
  - `FOREIGN KEY` 是否完整
  - 业务规则 `CHECK` 约束
- [ ] **2.4 状态机跳转**
  - 订单 / 任务状态流转校验
  - 是否跳过中间态
  - 乐观锁（版本号）
- [ ] **2.5 删除安全性**
  - 软删 vs 硬删（CLAUDE.md §3 仅 9 个模型白名单）
  - 级联删除误删
  - 批量删除数量限制
- [ ] **2.6 查询问题**
  - N+1 查询
  - 深分页用游标（已有 cursor）
  - 外部查询超时
  - 连接池监控
  - 上线前 `EXPLAIN ANALYZE`

### 3.3 并发与竞态条件

- [ ] **3.1 TOCTOU 漏洞**
  - "先查后改"时间窗口
  - 库存扣减原子操作（`UPDATE SET count = count - 1 WHERE count > 0`）
- [ ] **3.2 分布式锁**
  - 唯一持有者 ID（BUG-15 已识别）
  - 锁过期时间（Vercel serverless 失效）
  - 锁续期（看门狗）
  - Redis 主从切换兜底
- [ ] **3.3 异步时序**
  - 所有 `await` 正确使用
  - 依赖关系正确执行
  - `Promise.all` 失败时其他操作状态
- [ ] **3.4 重试风暴**
  - 指数退避 + 抖动
  - 熔断器
  - 多层重试流量放大
  - 重试幂等性

### 3.4 错误处理

- [ ] **4.1 静默吞错**
  - `try/catch` 空块或仅 `console.log`
  - `Promise.catch` 遗漏
  - 异常被丢弃
- [ ] **4.2 错误信息质量**
  - 具体到能定位（不是"操作失败"）
  - 区分用户可见 vs 内部错误
  - 包含上下文（操作 / 参数 / 状态）
  - 不暴露内部细节
- [ ] **4.3 外部调用容错**
  - HTTP / API 调用超时（BUG-M 已知）
  - 文件读写异常分支
  - DB 连接失败降级
  - 第三方不可用影响

### 3.5 边界条件与逻辑错误

- [ ] **5.1 边界值**
  - 空数组 / 空字符串 / null
  - 零值除法 / 取模
  - 分页 page=0 / -1 / pageSize=0
  - 日期时区（BUG-07 / BUG-25 已知）
- [ ] **5.2 循环与索引**
  - `<` vs `<=` 边界
  - offset 跳过 / 重复
  - 循环内修改集合
- [ ] **5.3 类型与语义**
  - `==` vs `===`
  - `null` vs `undefined`
  - 浮点误差
  - API 字段类型一致性
- [ ] **5.4 过拟合**
  - 是否只对示例数据工作
  - 验证规则与测试用例脱钩
  - Magic number 应来自配置
  - 假设的 schema 与实际匹配

### 3.6 资源管理

- [ ] **6.1 资源泄漏**
  - 异常分支释放 DB 连接 / 文件句柄
  - `finally` 清理
  - 定时器 / 监听器清理
  - Stream 关闭（含错误分支）
- [ ] **6.2 超时缺失**
  - HTTP 连接 / 读取超时
  - DB 语句级超时
  - 长操作整体超时
  - `while(true)` 轮询
- [ ] **6.3 内存与性能**
  - 全局缓存无上限
  - 大数据集流式处理
  - 循环内重复计算 / 对象创建
  - OOM 防护

### 3.7 测试质量

- [ ] **7.1 测试有效性**
  - 仅 happy path（常见 AI 生成代码问题）
  - 断言有意义（非"没抛异常"）
  - Mock 过度
  - 验证实现而非需求
- [ ] **7.2 测试覆盖**
  - 边界条件（空 / 零 / 极值 / 非法）
  - 并发场景
  - 错误分支
  - 状态流转非法跳转

### 3.8 架构与代码一致性

- [ ] **8.1 幻觉 API**
  - 函数 / 方法 / 库真实存在
  - API 签名一致
  - 导入的包存在 / 未弃用
- [ ] **8.2 多文件一致性**
  - 接口定义与调用方参数匹配
  - Service 加参数后 Controller 同步
  - DB Schema 变更后 ORM Model 同步
  - 公共工具函数返回值变更后调用方更新
- [ ] **8.3 代码重复与风格**
  - 功能相同但实现不同的多份代码
  - 新增代码复用项目已有工具
  - 代码风格一致
  - 不引入未使用的设计模式
- [ ] **8.4 上下文丢失**
  - 长对话后 AI 忘记架构约定
  - 多文件改动前后矛盾
  - 引入冲突依赖
  - 命名冲突

---

## 4. 已知问题（来自 docs/refactor/bugs/）

迁移前必须**修复或显式记录**的 12 条 Bug：

| ID | 严重度 | 标题 | 状态 |
|---|---|---|---|
| b05 | 🔴 | expireRefreshAccess（refresh 端点无 admin 门禁） | 待修 |
| b06 | 🔴 | newsByModelLimitUnbounded（limit 无界） | 待修 |
| b08 | 🔴 | orphanCleanupLoop（清理死循环） | 待修 |
| b09 | 🔴 | pseudoTenantSystem（'system' 当 tenantId） | 待修 |
| b12 | 🔴 | appSecretWeak（密钥派生过弱） | 待修 |
| b13 | 🟡 | injectTenantIdDeepStub（递归注入空壳） | 待修 |
| b14 | 🟡 | softDeleteReadOps（中间件污染 update） | 待修 |
| b16 | 🟡 | sidebarCollapseRace（折叠状态回滚） | 待修 |
| b17 | 🟡 | chatPrefillDead（/chat?prefill= 不读） | 待修 |
| b18 | 🟢 | settingsMutationOnChange（每敲一字发一次） | 待修 |
| b19 | 🟢 | chatOptimisticUpdate（无乐观更新） | 待修 |
| b23 | 🟢 | aihubRestKeyDead（死功能） | 待下线 |

> 每条修复方案见 `docs/refactor/bugs/<id>.md`。

---

## 5. 不迁移清单（一次性脚本 / 调试产物）

按 `04-cleanup-checklist.md` 与 `docs/archived/bug-audit-2026-09-03.md` §"已知但不在本次范围"：

### 5.1 调试 / 临时脚本（不迁移）

- `probe.ps1` / `probe2.ps1`（PowerShell 探针，已删除）
- `scripts/_debug-render.ts`（临时）
- `scripts/check-bili-cache.js` / `.cjs`（重复）
- `scripts/fix-daily-report-state.ts`（一次性修复）
- `prisma/usage-test-*.db`（测试残留）
- `prisma/seed-dev-admin.mjs`（dev only，无 env 门控）

### 5.2 业务可下线功能

- aihub-rest API Key（BUG-23 死功能）
- `CachePanel.tsx` tRPC router（未实现）

### 5.3 已过期 / 一次性脚本归档

迁移到 `D:\AI Hub\scripts\legacy\` 或 `docs\archived\2026-09-subs\`：

- 所有在 git status 显示 `??` 但无调用方的一次性脚本
- 硬编码路径的脚本（应改读 env）

---

## 6. 迁移批次建议（4 批）

| 批次 | 内容 | 工作量 |
|---|---|---|
| **M1** | 配置文件（package.json / tsconfig / next.config / .gitignore / CLAUDE.md） | 30 min |
| **M2** | src/lib/ + src/server/（业务核心） | 4-6 h |
| **M3** | src/app/ + src/components/ + src/features/（UI） | 4-6 h |
| **M4** | scripts/ + docs/ + tests/（运维 / 文档 / 测试） | 2-4 h |

每批完成后 `git commit` + 打 tag。

---

## 7. 验收清单（迁移后）

- [ ] `pnpm typecheck` 通过（D:\AI Hub 下）
- [ ] `pnpm test` 通过
- [ ] `pnpm lint` 通过
- [ ] `pnpm build` 通过
- [ ] `pnpm dev` 启动正常
- [ ] D:\1Money\aihub 与 D:\AI Hub 双向可恢复（git tag）

---

## 8. 过期条件

- 迁移完成 → 本文件归档到 `docs\archived\`
- 8 大类审查项变更 → 更新版本号

---

**创建时间**：2026-09-07
**下次更新**：批次 B 扫描完成后
