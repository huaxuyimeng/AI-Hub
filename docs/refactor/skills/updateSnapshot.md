---
name: updateSnapshot
description: 更新 slide-engine 测试快照（snapshot）。在用户提到「刷新 slide 测试」「更新 PPTX fixture」「slide 渲染有变化」时必须触发。绝不直接 commit 旧 snapshot——必须先 diff 验证变更合理。
---

# Update Snapshot Skill

## 1. 调用流程

### Phase 1：触发条件

- `pnpm slide:lint` 输出"layout changed"警告
- `pnpm test:slides` 失败且提示"snapshot mismatch"
- 新增页型 / 新增字段

### Phase 2：审查变更（必做）

1. 跑 `pnpm slide:snapshot` 生成新 snapshot
2. **逐字段对比** diff（不要一键接受）
3. 列出每个变化是否符合预期：
   - ✅ 布局调整（如新增 padding）→ 接受
   - ❌ 内容漂移（如字段名错位）→ 拒绝，先查根因
4. 在 PR 描述里列出每个变化的原因

### Phase 3：接受 / 拒绝

- 接受：`git add tests/__snapshots__/`
- 拒绝：回到代码修改

## 2. 边界规则

- ✅ snapshot 必须有语义注释（不是黑盒）
- ❌ 禁止一键接受所有 snapshot 变化
- ❌ 禁止把 snapshot 放在源码目录（必须 tests/__snapshots__/）

## 3. 验收清单

- [ ] diff 已被逐字段审查
- [ ] 变化原因已记录在 PR 描述
- [ ] `pnpm test:slides` 通过

## 4. 过期条件

- 切换测试框架（vitest snapshot）
- slide-engine 重写

---

**创建时间**：2026-09-07
