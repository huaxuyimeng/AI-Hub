# 00-design · 当前 UI 现状档案（防退化基线）

> **性质**：现状档案 + 防退化基线。
> **不写**：未来设计、风格升级、改版方案（那是 `workbench-ui-designer` skill 的工作）。
> **目的**：迁移 / 重构 / 新模块加入时，**对照本档案不破坏现有外观**。
>
> 创建于 2026-09-06。后续任何 UI 调整，必须先回填到本文档再动手。

---

## 1. 技术栈

| 维度 | 现状 |
|---|---|
| 框架 | Next.js 14 App Router |
| 样式 | Tailwind CSS（utility-first）+ CSS 变量（OKLCH + HSL） |
| 组件库 | Radix UI primitives（dialog / dropdown 等无样式逻辑） |
| 图标 | `@tabler/icons-react`（**唯一**图标来源） |
| 字体 | 系统字体栈（`font-sans` 默认），无外部字体 |
| 动效 | Tailwind 内置 transition / animate；不引入 framer-motion |
| 颜色空间 | 大部分 token 用 OKLCH；accent 系用 HSL 三元组（`hsl(var(--accent))`） |

**强约束**：不引入新的样式框架 / 图标库 / 字体库。如确需，单独走 PR + 更新本档案。

---

## 2. 主题系统

### 2.1 三层主题

```
ThemePreset（预设色板，6 套）  +  Mode（light/dark/system）  +  AccentHSL（HSL DIY）
```

### 2.2 6 套预设主题（不可改 key）

| key | 显示名 |
|---|---|
| `default` | 默认（暖白 + 琥珀强调） |
| `lavender` | 薰衣草 |
| `forest` | 森林 |
| `rose` | 玫瑰 |
| `ocean` | 海洋 |
| `slate` | 板岩 |

新增主题 key 必须走 `workbench-ui-designer` skill 评估。

### 2.3 双层持久化

- localStorage（即时生效，防 FOUC）
- tRPC `preferences.set`（远程同步，跨设备）
- 加载优先级：remote > localStorage > system

### 2.4 运行时注入

- `<ThemeProvider>` 在客户端 mount 时读取 `StoredTheme`
- `applyThemeVars()` 把 token 写到 `document.documentElement.style`
- SSR 期间给 fallback（`:root` 默认值），防止首屏闪烁

---

## 3. 全局布局

### 3.1 三模式工作台壳（来自 `src/components/app-shell.tsx`）

- **侧栏宽度**：展开 `240px`（md:w-60），折叠 `64px`（md:w-16）
- **移动端**：`< 768px` 默认折叠，使用 fixed 抽屉 + backdrop
- **快捷键**：`⌘K` 打开命令面板
- **三模式分组**：
  - **模式**（NAV_MODES）：`/workbench`
  - **页面**（NAV_PAGES）：`/projects` `/chat` `/usage` `/news` `/rankings` `/plugins` `/cleanup` `/settings`

### 3.2 Brand 区

- 高度 `64px`（h-16）
- 头像（`user.image` 优先 → 首字母 fallback）
- 双行文字：`AIHub` + `user.name ?? 'Workbench'`

### 3.3 用户卡（footer）

- 名称（truncate）
- tenantId 前 8 位 + role badge
- 退出按钮

### 3.4 Briefng Toast

- 全局 `<BriefingToast />` 挂载在 AppShell 末尾
- 早报生成时自动弹出

---

## 4. 页面清单（14 个）

| 路径 | 文件 | 核心组件 | 备注 |
|---|---|---|---|
| `/login` | `src/app/login/page.tsx` | 内联表单 | 无侧栏 |
| `/workbench` | `src/app/(app)/workbench/page.tsx` | 首页仪表盘 | 默认落地页 |
| `/projects` | `src/app/(app)/projects/page.tsx` | 项目列表 + 搜索 | |
| `/projects/new` | `src/app/(app)/projects/new/page.tsx` | 新建表单 | |
| `/projects/[id]` | `src/app/(app)/projects/[id]/page.tsx` | 项目详情 + 文件树 | |
| `/chat` | `src/app/(app)/chat/page.tsx` | 对话流（消息 + 输入框） | |
| `/usage` | `src/app/(app)/usage/page.tsx` | token 用量统计 | |
| `/news` | `src/app/(app)/news/page.tsx` | 新闻列表 + 关键词过滤 | |
| `/rankings` | `src/app/(app)/rankings/page.tsx` | 模型排行表 | |
| `/rankings/[id]` | `src/app/(app)/rankings/[id]/page.tsx` | 模型详情 | |
| `/plugins` | `src/app/(app)/plugins/page.tsx` | 插件管理 | |
| `/cleanup` | `src/app/(app)/cleanup/page.tsx` | 孤儿文件扫描 + 清理 | |
| `/settings` | `src/app/(app)/settings/page.tsx` | 偏好 + API Key + 对话风格 | |
| `/privacy` `/terms` | `src/app/privacy/page.tsx` `src/app/terms/page.tsx` | 静态文档 | 无侧栏 |

### 4.1 页面顶部

- 每个页面使用 `<PageHeader>`（来自 `src/components/ui/page-header.tsx`）
- 统一格式：标题 + 描述 + 右上操作按钮

### 4.2 页面布局规范

- 容器：`mx-auto max-w-7xl px-4 py-6`（响应式 padding）
- 卡片：`<Card>` 组件 + `border` + `bg-card` + `rounded-lg`
- 加载态：Skeleton（`animate-pulse` + `bg-muted`）
- 空态：`<EmptyState>`（icon + title + description + CTA）

---

## 5. 核心组件库（`src/components/ui/`）

| 文件 | 组件名 | 用途 |
|---|---|---|
| `page-header.tsx` | `PageHeader` | 页面顶部标题 |
| `metric-card.tsx` | `MetricCard` | 数值 + 趋势指标 |
| `stat-card.tsx` | `StatCard` | 单数值卡片 |
| `spark-line.tsx` | `SparkLine` | 内联小图（不需图表库） |
| `error-state.tsx` | `ErrorState` | 错误展示（带重试） |

**禁止**：在 `src/components/ui/` 下新建业务组件（业务组件放 `src/components/<domain>/`）。

---

## 6. 业务组件（按领域）

| 目录 | 领域 |
|---|---|
| `src/components/news/` | 新闻聚合 |
| `src/components/rankings/` | 模型排行 |
| `src/components/bilibili/` | B 站监控 |
| `src/components/cleanup/` | 清理 |
| `src/components/discovery/` | 发现 |
| `src/components/theme/` | 主题切换器 |
| `src/components/settings/` | 设置面板 |
| `src/components/layout/` | 布局（命令面板等） |
| `src/components/providers.tsx` | 全局 Providers（NextAuth + Theme + tRPC + Toast） |

---

## 7. 配色 token（`src/app/globals.css`）

### 7.1 颜色变量（必含暗色对应值）

```
--background       --foreground
--surface          --surface-glass        --surface-elevated
--muted            --muted-foreground
--border           --ring
--accent           --accent-fg
--destructive      --destructive-fg
--success          --success-fg
--warning          --warning-fg
--radius           (12px)
```

### 7.2 字体 + 排版

- `font-sans`：系统字体栈（`ui-sans-serif` 系列）
- 不引入外部字体 / icon-font

---

## 8. 防退化基线（不允许违背的清单）

> 任何 UI 调整必须能解释"为什么这条不可违背"。下面 13 条都是**当前项目明确选择**的硬约束。

### 8.1 颜色规则（CRITICAL）

- ✅ 颜色**必须**用 CSS 变量（`hsl(var(--accent))` / `oklch(var(--xxx))`）
- ❌ 禁止硬编码 `#xxx` `rgb()` `oklch(...)` 直接写在 JSX className
- 例外：`SlidePreview` 内的 `--slide-*` token（独立子系统，文档已规定）
- 例外：`markdown-it` 渲染的代码块背景（token 通过 props 注入）

### 8.2 图标规则（CRITICAL）

- ✅ 必须 `@tabler/icons-react`
- ❌ 禁止 lucide-react / heroicons / react-icons / emoji 替代
- ❌ 禁止 SVG inline（除非极简几何图形）

### 8.3 布局规则

- 侧栏宽：展开 240px、折叠 64px（不允许 200px / 220px 等"差不多"的值）
- 容器宽度：内容区 `max-w-7xl`（1280px），窄屏 `max-w-2xl`
- 不允许自定义断点（用 Tailwind 默认 sm/md/lg/xl/2xl）

### 8.4 主题规则

- 6 套预设主题 key 不允许重命名（影响 localStorage 兼容性）
- 主题切换不允许有 200ms 以上的过渡（FOUC 风险）
- 暗色适配：每个新增 token 必须有 `:root` + `.dark` 双值

### 8.5 字体规则

- 系统字体栈（不引入 Google Fonts / 阿里巴巴普惠体）
- 字号：12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 px（Tailwind 默认 + 极少自定义）

### 8.6 动效规则

- 过渡时长 ≤ 200ms
- 用 Tailwind 内置 `transition / animate-` 类
- ❌ 禁止引入 framer-motion / react-spring
- 例外：`BriefingToast` 用 CSS keyframes（已在组件内）

### 8.7 响应式断点

- 移动端：`< 768px`（md 以下）
- 平板：`768px - 1024px`
- 桌面：`≥ 1024px`
- ❌ 禁止自定义断点（断点应在 `tailwind.config.ts` 集中管理）

### 8.8 文案规则

- 默认中文（zh-CN）
- 英文文案需双语：`欢迎 / Welcome`（半角斜杠 + 空格）
- 按钮文案不超过 8 个汉字（`保存` `取消` `删除` `确认`）

### 8.9 命名规则

- 文件名 = 主组件名（PascalCase）
- 目录名 = kebab-case（`news-card/`、`bilibili-panel/`）
- 业务组件目录必须有 `index.ts` barrel export

### 8.10 错误反馈

- ✅ 用 `useToast()`（来自 `src/components/toast.tsx`）
- ❌ 禁止 `alert()` `confirm()` `window.alert`
- 错误分级：`info` `success` `warning` `error` 四级

### 8.11 数据展示

- 加载态：Skeleton（`animate-pulse bg-muted rounded`）
- 空态：`<EmptyState icon title description action />`
- 错误态：`<ErrorState error onRetry />`

### 8.12 表单规则

- 必填项：label 后 `*` 红色
- 校验时机：失焦 + 提交时（不 onChange）
- 错误文案：12px 字号 + `--destructive` 颜色

### 8.13 命令面板

- 快捷键：`⌘K` / `Ctrl+K`
- 来源：`src/components/layout/command-palette.tsx`
- 不允许移除（多个用户已习惯）

---

## 9. 现状索引（指向源文件）

| 关注点 | 文件 |
|---|---|
| 全局样式 | `src/app/globals.css` |
| 主题运行时 | `src/components/theme-provider.tsx` |
| 主题类型 + token | `src/lib/themes.ts` |
| 主题切换器 | `src/components/theme/theme-switcher.tsx` |
| 主题暗色切换 | `src/components/theme-toggle.tsx` |
| 强调色选择 | `src/components/theme/accent-picker.tsx` |
| 渐变色板 | `src/components/theme/gradient-palette-picker.tsx` + `src/lib/palettes/gradient-palettes.ts` |
| AppShell | `src/components/app-shell.tsx` |
| 命令面板 | `src/components/layout/command-palette.tsx` |
| 通用 UI | `src/components/ui/*` |
| Providers | `src/components/providers.tsx` |
| Toast | `src/components/toast.tsx` |

---

## 10. 过期条件

下列任一情况发生，需更新本档案：

- 引入新的图标库 / 字体 / 样式框架
- 增加第 7 套预设主题
- AppShell 结构重构（如新增 toolbar / bottom bar）
- 删除 `⌘K` 命令面板
- 改变断点策略
- 把 `tailwind.config.ts` 的 `theme.extend` 大量自定义

---

## 11. 反模式（迁移期间禁止）

迁移期间**最容易破坏 UI** 的反模式：

1. ❌ 在新包里重新实现一套相同的 toast / dialog（必须依赖 `@aihub/ui` 暴露的统一组件）
2. ❌ 在包内硬编码颜色值（必须用 `@aihub/themes` 的 token）
3. ❌ 把 `bg-card` `text-foreground` 改成自定义 className（破坏主题切换）
4. ❌ 把 `bg-primary/10` 改成具体 `bg-blue-500/10`（破坏强调色自定义）
5. ❌ 把 `<IconXxx size={16} />` 改成 `<span>🔍</span>`（emoji 替代图标）

任一出现，必须在本档案 §8 加新条目，并附 PR 链接。
