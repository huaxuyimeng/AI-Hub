---
name: addModule
description: 新增业务模块到 monorepo（apps/ + packages/）。在用户提到「加个 X 模块」「新增 Y 功能包」时必须触发。绝不直接建目录——必须先按 §1 流程产出模块设计 + 依赖边界 + exports 字段。
---

# Add Module Skill

## 1. 调用流程（严格顺序）

### Phase 1：需求澄清

1. 模块名（camelCase）
2. 一句话职责
3. 输入 / 输出（数据形态、API 形态）
4. 依赖哪些现有包
5. 谁会消费本模块

### Phase 2：模块设计报告（必做）

输出 11 段：

1. 一句话职责
2. 当前代码位置（若是迁移）
3. 目标包结构（domain / infra / interface / index.ts）
4. 对外 API（exports 字段）
5. 依赖清单
6. 消费方清单
7. 边界规则
8. 迁移步骤（bash）
9. 风险 + 缓解
10. 验收清单
11. 过期条件

### Phase 3：实施

```bash
mkdir -p packages/<name>/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/<name>/tests

# package.json + tsconfig.json + README.md

# 包结构按"三层架构"：domain 纯逻辑 / infra 数据访问 / interface 对外接口
```

## 2. 边界规则

- ✅ 模块必须遵循 domain → infra → interface 单向依赖
- ✅ exports 字段强制锁死入口（防深路径穿透）
- ❌ 禁止包内反向依赖消费方
- ❌ 禁止跨过 @aihub/<name> 入口 import 内部文件

## 3. 命名规范

- 包名：`@aihub/<name>`（kebab-case 后转 camelCase）
- 目录：`packages/<name>/`（camelCase）
- 文件：`<purpose>.ts`（camelCase）
- 类 / 组件：PascalCase

## 4. 验收清单

- [ ] `pnpm --filter @aihub/<name> typecheck` 通过
- [ ] `pnpm --filter @aihub/<name> test` 通过
- [ ] `pnpm depcruise --validate` 0 违规
- [ ] README.md 含 4 段（依赖白名单 + 消费方清单 + 边界规则 + 过期条件）

## 5. 过期条件

- monorepo 迁移到 turborepo / nx
- 三层架构改为 DDD / 六边形
- 引入 codegen 自动生成 exports

---

**创建时间**：2026-09-07
