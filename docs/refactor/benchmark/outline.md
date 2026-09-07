# outline · Outline 标杆调研

> 创建于 2026-09-07
> 借鉴价值：⭐⭐⭐⭐⭐ （pnpm workspace 实战 + 富文本编辑器集成）

---

## 1. 一句话定位

**Outline** 是开源知识库（40k+ stars），主打富文本协作 + Markdown 兼容。

---

## 2. 关键事实（已确认）

- **GitHub**：https://github.com/outline/outline
- **Stars**：40,480
- **License**：Apache-2.0（社区版）/ 商业版
- **技术栈**：Node.js + React + ProseMirror + Postgres + Redis

---

## 3. 借鉴要点

### 3.1 富文本 + Markdown 双引擎

Outline 同时支持 ProseMirror（富文本）和 Markdown（导出 / 导入）。

**借鉴**：AIHub 的 `chat` 模块若未来支持富文本消息（图片 / 代码块 / 引用），可参考此架构。

### 3.2 pnpm workspace 实战

Outline 是 monorepo 标杆：

```
shared/
├── editor/                 # ProseMirror 封装
├── types/
├── utils/
└── ...

server/
├── routes/
├── policies/               # 权限策略
├── models/                 # Prisma 封装
└── ...

web/
├── components/
├── scenes/
└── ...
```

**借鉴**：

- ✅ 用 `shared/` 命名（而非 AIHub 的 `packages/`）—— 两种命名都合理
- ✅ `server/policies/` 目录集中权限策略—— AIHub 的 `auth` 包可借鉴此模式
- ✅ `server/models/` 是 Prisma 封装层—— 与 AIHub 的 `infra/<model>Repo.ts` 同理念

### 3.3 权限策略层

Outline 的 `server/policies/` 是经典 RBAC 实现：

```ts
// server/policies/document.ts
export const documentPolicy = new Policy<Document>({
  read: (actor, doc) => doc.teamId === actor.teamId,
  update: (actor, doc) => doc.userId === actor.id,
  delete: (actor, doc) => actor.admin && doc.teamId === actor.teamId,
});
```

**借鉴**：

- AIHub 当前用 `protectedProcedure` / `adminProcedure` 二元 RBAC
- 未来若需要"文档可分享给指定用户但非全租户"，可参考 Policy 模式

---

## 4. 不借鉴的方面

| 项 | 原因 |
|---|---|
| ❌ ProseMirror 富文本 | AIHub 无富文本需求 |
| ❌ Redis Bull 队列 | AIHub 用 cron + 锁已足够 |
| ❌ Pro 版与社区版分支 | AIHub 是单产品 |

---

## 5. 对 AIHub 的具体建议

| 借鉴 | 应用 |
|---|---|
| `shared/editor/` 模式 | ❌ 不需要（AIHub 无富文本） |
| `server/policies/` 权限层 | ✅ P3 借鉴：未来细粒度 RBAC |
| `server/models/` Prisma 封装 | ✅ 已采纳（AIHub 的 `infra/<model>Repo.ts`） |
| pnpm workspace 实战 | ✅ 已采纳（参考其 `shared/` 结构） |

---

## 6. 待用户补充

> **请用户在使用本调研前补充以下信息**：
>
> 1. Outline 的 `server/policies/` 完整实现（具体文件）
> 2. Outline 的 ProseMirror 集成代码（具体封装）
> 3. Outline 的 monorepo 构建配置（pnpm-workspace.yaml + turbo.json）

---

## 7. 过期条件

- Outline 切换 ORM（弃用 Prisma）
- AIHub 完成 monorepo 迁移（本调研归档）

---

**创建时间**：2026-09-07
**调研深度**：⭐⭐（基础事实确认 + 借鉴框架）
