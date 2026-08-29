# Eval 2: app-shell-three-modes

## 任务背景

现有 `src/components/app-shell.tsx` 只支持单一工作台首页，用户想要：

- 工作台 / 对话 / 项目三模式切换
- 侧栏保留 240px（不要改宽度）
- 加 56px 顶栏放搜索和操作按钮
- 模式切换器放在侧栏中部
- 保留 next-auth 鉴权流程
- icons 继续用 `@tabler/icons-react`
- 不能出现 emoji

## 期望产出

### 修改 / 新增文件

| 文件 | 操作 |
|------|------|
| `src/components/layout/app-shell.tsx` | 新建（替代旧的 `src/components/app-shell.tsx`） |
| `src/components/layout/sidebar-nav.tsx` | 新建 |
| `src/components/layout/topbar.tsx` | 新建 |

### 调用方式保持

`src/app/(app)/layout.tsx` 调用 `AppShell` 的方式不变（接收 `user` 与 `children`）。

### 三模式差异

| 模式 | 侧栏菜单 | 顶栏操作 | 主区 |
|------|---------|---------|------|
| 工作台 | 项目列表 + 收藏对话 | +新建项目 / 搜索 | 快捷入口 + 最近项目 |
| 对话 | 对话列表（今天/昨天/7天/更早分组） | 模型选择 / 临时设置 | 宽屏 `max-w-3xl` 对话流 |
| 项目 | 项目列表 + 标签过滤 | +新建项目 / 视图切换 | 3 列网格 |

## 关键验收点

- [ ] 三个文件已创建
- [ ] `(app)/layout.tsx` 调用方式不变
- [ ] 侧栏宽度 240px 不变
- [ ] 顶栏 56px 不变
- [ ] 模式切换器在侧栏中部
- [ ] icons 全是 `@tabler/icons-react`
- [ ] 全站扫不到 emoji
- [ ] next-auth 鉴权流程未破坏（`getServerSession` + `redirect('/login')`）

## 失败信号

- 修改了 `(app)/layout.tsx` 的调用方式 → 失败
- 引入新图标库 → 失败
- 出现 emoji → 失败
- 侧栏宽度被改 → 失败
- 顶栏缺失或错位 → 失败