# calCom · Cal.com 标杆调研

> 创建于 2026-09-07
> 借鉴价值：⭐⭐⭐⭐⭐ （经典单体 → monorepo 案例）
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §8 实施原则

---

## 1. 一句话定位

**Cal.com** 是开源预约系统（48k+ stars），早期是 Next.js 单体，2022 年完成 monorepo 迁移。

---

## 2. 关键事实（已确认）

- **GitHub**：https://github.com/calcom/cal.com
- **Stars**：48,251
- **License**：AGPL-3.0
- **技术栈**：Next.js + tRPC + Prisma + TypeScript + React Native（移动端）

---

## 3. 借鉴要点

### 3.1 Monorepo 拓扑

Cal.com 的 `apps/` 结构（与 AIHub 目标一致）：

```
apps/
├── web/                    # Next.js 主站
├── api/                    # API 服务
├── website/                # 营销站
└── mobile/                 # React Native

packages/
├── features/               # 业务功能模块（横切）
├── lib/                    # 通用工具
├── prisma/                 # 数据库
├── trpc/                   # tRPC 共享
├── ui/                     # 共享组件
└── ...
```

**借鉴**：Cal.com 用 `features/` 而非业务模块命名——这是另一种合理选择。

### 3.2 包依赖图（Cal.com 模式）

```
apps/web
   ↓
features/booking → features/availability → lib → prisma
                    ↓
                features/auth
```

**借鉴**：业务功能可被多个 app 共享，避免重复实现。

### 3.3 渐进迁移（Cal.com 历程）

- 2021-09：单体 Next.js，所有功能在 `pages/` 和 `components/`
- 2022-03：开始 monorepo 拆分（pnpm workspace）
- 2022-06：6 个月内完成主体迁移，期间双仓并行
- 2022-09：完全切到 monorepo

**借鉴**：

- 6 个月主体迁移——与 AIHub 4 周路线图同量级（AIHub 更小）
- "新功能在新仓，老功能在老仓"是平滑过渡的关键

### 3.4 文档与代码同 PR

Cal.com 强约束："改 API 必须改文档；删代码必须删文档"——与 AIHub `00-总体迁移设计.md` §8.7 一致。

---

## 4. 不借鉴的方面

| 项 | 原因 |
|---|---|
| ❌ Yarn 1 → Yarn 2（Berry） | AIHub 已选 pnpm，工具不混用 |
| ❌ React Native 移动端 | AIHub 暂不需要 |
| ❌ Turborepo | 复杂度高，pnpm workspace 足够 |
| ❌ turborepo 远程缓存 | 单租户，无需 |

---

## 5. 待用户补充

> **请用户在使用本调研前补充以下信息**：
>
> 1. Cal.com 的 `packages/trpc/` 内部结构（具体文件清单）
> 2. Cal.com 的 `packages/features/` 边界规范（README 模板）
> 3. Cal.com 的 CI 工作流（GitHub Actions 配置）
> 4. Cal.com 的迁移 PR 历史（哪些 PR 拆了哪个包）

> 这部分需阅读实际仓库代码才能给出准确引用。

---

## 6. 对 AIHub 的具体建议

| 借鉴 | 应用 |
|---|---|
| 6 个月迁移历程 | AIHub 4 周可行（小 5 倍） |
| `features/` 横切命名 | ❌ 不采纳（AIHub 用业务模块命名更直观） |
| tRPC 共享包 | ✅ 借鉴：未来 `packages/trpc/` 抽公共 procedure |
| 双仓并行过渡 | ✅ 借鉴：保留 `src/` 旧路径 1 周 |
| 文档与代码同 PR | ✅ 已纳入 AIHub 原则 |

---

## 7. 过期条件

- Cal.com 迁移到 turborepo（影响借鉴价值）
- AIHub 完成 monorepo 迁移（本调研归档）

---

**创建时间**：2026-09-07
**调研深度**：⭐⭐（基础事实确认 + 借鉴框架，具体代码细节待用户补充）
