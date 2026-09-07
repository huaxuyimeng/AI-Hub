# calDotCom · Cal.com 架构深度调研

> 创建于 2026-09-07
> 借鉴价值：⭐⭐⭐⭐⭐ （补充 calCom.md 的深度调研）
> 关联：[`calCom.md`](./calCom.md)

---

## 1. 一句话定位

本调研是 [`calCom.md`](./calCom.md) 的**深度版**，聚焦 Cal.com 的 **packages/trpc** 内部结构 + 迁移 PR 模式。

---

## 2. 调研目标

回答 3 个具体问题：

1. Cal.com 的 `packages/trpc/` 内部如何分层？
2. Cal.com 单个 PR 拆包的标准是什么？
3. Cal.com 如何处理"新功能在新仓、老功能在老仓"的过渡期？

---

## 3. 待用户补充（核心内容）

> **本调研的实际引用代码需用户从 Cal.com 仓库提取**。
>
> 建议操作：
>
> ```bash
> # 1. 克隆 Cal.com 仓库到临时目录
> git clone https://github.com/calcom/cal.com /tmp/calcom --depth=1
>
> # 2. 看 trpc 包结构
> ls -la /tmp/calcom/packages/trpc/
> find /tmp/calcom/packages/trpc -name "*.ts" | head -20
>
> # 3. 看典型 package.json
> cat /tmp/calcom/packages/trpc/package.json
>
> # 4. 看典型 migration PR
> # GitHub: https://github.com/calcom/cal.com/pulls?q=is%3Apr+monorepo+refactor
> ```
>
> 把上述命令的输出贴回本调研，然后我可以补全具体的代码引用。

---

## 4. 调研框架（待填充）

### 4.1 packages/trpc 结构（待填）

```text
packages/trpc/
├── server/             # ???
│   ├── routers/        # ???
│   ├── middlewares/    # ???
│   └── context.ts      # ???
├── react/              # ???
│   ├── Provider.tsx
│   └── hooks.ts
└── package.json
```

> 等用户补充具体内容。

### 4.2 单 PR 拆包标准（推测）

基于一般 monorepo 最佳实践，Cal.com 可能的 PR 模板：

- 每个 PR 只拆 1 个包
- 保留原 `src/` 路径作为 alias（re-export）
- 加 deprecation warning 提示开发者用新路径
- 1 周后删除旧路径

**建议 AIHub 借鉴**：

- ✅ 单 PR 一个包（与 AIHub 路线图一致）
- ✅ 保留旧路径 1 周（与 AIHub §5.1 一致）

### 4.3 过渡期处理（推测）

可能模式：

- `src/lib/news/index.ts` → re-export from `@aihub/news`
- 应用代码渐进迁移
- ESLint rule 禁止新增 `src/lib/news/` import
- 1 周后强制移除

---

## 5. 对 AIHub 的具体建议（基于推测）

| 借鉴 | 应用 |
|---|---|
| 单 PR 一个包 | ✅ 已采纳 |
| 保留旧路径 + deprecation warning | ✅ 已采纳 |
| 1 周后强制移除 | ✅ 已采纳 |

---

## 6. 自我标注

> ⚠️ **本调研是骨架**——核心内容（具体代码引用）需用户从 Cal.com 仓库提取后补充。
>
> 若用户决定不深入调研，可直接归档本文件到 `docs/archived/refactor/`。

---

## 7. 过期条件

- 用户决定不深入调研 Cal.com（本调研归档）
- Cal.com 迁移到 turborepo（影响借鉴价值）

---

**创建时间**：2026-09-07
**调研深度**：⭐（仅骨架，需用户补充）
