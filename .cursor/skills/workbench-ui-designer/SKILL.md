---
name: workbench-ui-designer
description: 设计与实现 AI 工作台风格的前端界面（参考 Cursor / ChatGPT / Trae / Qoder / DeepSeek Hermes / WorkBuddy）。包含奶白/暗色双主题、6 套预设主题、HSL DIY 强调色、背景图上传 R2 持久化、三模式（工作台 / 对话 / 项目）切换。在用户提到「搭工作台」「仿造 GPT Work / Hermes / WorkBuddy」「UI 改造」「换肤」「DIY 配色」「背景图上传」「侧栏重构」「多模式布局」「AI 控制台 UI」时必须触发。即便用户只要求「改一下主题」「换一下侧栏」，也应主动加载本 skill。绝不直接动手写组件代码——必须先产出设计报告让用户拍板。
---

# Workbench UI Designer

## 1. 核心理念

仿造 Cursor 与 ChatGPT 缝合风，目标体验是「工程师的私人书房」——奶白纸面、暗色书脊、克制装饰、可 DIY。

> 「像在 IDE 里写代码同时能听到 Coffee Shop 的环境音。」

**情感关键词**：克制、纸感、温度、秩序、留白。

---

## 2. 调用流程（严格顺序，禁止跳步）

### Phase 1：调研与设计报告（必做，先于任何代码）

1. 读现有 UI 代码（`src/app/`、`src/components/`、`prisma/schema.prisma`、`globals.css`、`theme-provider.tsx`、`app-shell.tsx`）
2. 列出已有资产（图标库、字体、trpc、R2 工具、可复用 hooks）
3. 列出**痛点**与**冲突点**（旧 localStorage 主题 key、旧 ThemeProvider Context 接口、旧 HSL 变量）
4. 写出 5 段式设计报告：
   - **风格定义**（品牌定位 + 三原则）
   - **配色系统**（浅色 / 暗色 / 6 预设 / DIY）
   - **布局骨架**（三模式 + 通用结构）
   - **组件清单**（按层级分组，标 [新] / [改] / [沿]）
   - **风险评估**（冲突 / 配色舒适度 / 性能）
5. 用 AskQuestion 让用户拍板至少 3 个决策点（背景图存储 / DIY 粒度 / 布局参考）
6. **等待用户确认后才能进入 Phase 2**

### Phase 2：分阶段实施

按 P0 → P1 → P2 → P3 → P4 推进，每阶段结束跑一次视觉自检：

| 阶段 | 内容 | 工时 |
|------|------|------|
| P0 | 配色变量替换 + ThemeProvider 重写 + 6 套预设 | 0.5 天 |
| P1 | UserPreferences 模型 + tRPC + R2 上传 + 背景图持久化 | 1 天 |
| P2 | AppShell 三模式 + 工作台改版 + 顶栏 | 1 天 |
| P3 | 对话 / 项目模式重写 + 命令面板 | 2 天 |
| P4 | 微动效 / 键盘快捷键 / 无障碍审计 | 0.5 天 |

---

## 3. 视觉硬约束（违反即重做，不解释）

| 约束 | 原因 | 反例 |
|------|------|------|
| **严禁 emoji** 作为 UI 装饰 | 工程感缺失、不可定制、与品牌无关 | 卡片标题前加 🎨 / 🚀 |
| **严禁纯线性单色渐变** | 易廉价感，除非用于强调层叠 | `bg-gradient-to-r from-white to-gray-100` |
| **严禁纯白 `#ffffff`** 作主背景 | 刺眼、缺纸感 | 用 `oklch(98.5% 0.005 90)` 奶白 |
| **严禁纯黑 `#000000`** 作暗色背景 | 发灰刺眼 | 用 `oklch(18% 0.012 250)` 深蓝灰 |
| **圆角上限 12px** | 不要 16 / 20 / full | 按钮用 `rounded-lg` / 卡片 `rounded-xl` |
| **暗色背景必须有 1% 噪点** | 避免大色块死板 | `background-image: noise` overlay |
| **字体三档** GeistSans 主 / GeistMono 代码 / 中文 fallback 到 Inter Tight | 已在 package.json | 不要换字体库 |
| **图标统一** `@tabler/icons-react` | 已装 | 不要引入 lucide / heroicons |
| **对比度** 主体文字 ≥ 7:1（AAA） | 无障碍 | 琥珀强调色放浅色背景要 ≥ 4.5:1 |
| **分层用透明度** 不要堆卡片 | 保持视觉轻盈 | 用 `bg-background/60 backdrop-blur-xl` |

---

## 4. 配色系统

### 4.1 浅色 Paper（默认浅色）

| 变量 | 值 | 含义 |
|------|----|------|
| `--background` | `oklch(98.5% 0.005 90)` | 奶白纸面 #faf8f3 |
| `--foreground` | `oklch(22% 0.015 250)` | 深墨文字 |
| `--surface` | `oklch(100% 0 0 / 0.6)` | 半透明卡（叠在纸面） |
| `--surface-elevated` | `oklch(100% 0 0)` | 浮层（弹窗/下拉） |
| `--muted` | `oklch(96% 0.008 90)` | 灰奶 |
| `--muted-foreground` | `oklch(50% 0.015 250)` | 次要文字 |
| `--border` | `oklch(92% 0.01 90)` | 1px hairline |
| `--ring` | `oklch(72% 0.14 65)` | 琥珀焦点环 |
| `--accent` | `oklch(72% 0.14 65)` | 默认强调色（可 DIY） |
| `--accent-fg` | `oklch(20% 0.05 65)` | 强调色上的文字 |
| `--destructive` | `oklch(58% 0.22 25)` | 砖红 |
| `--success` | `oklch(65% 0.15 145)` | 成功 |
| `--warning` | `oklch(78% 0.15 75)` | 警告 |

### 4.2 暗色 Slate Brew（默认暗色）

| 变量 | 值 |
|------|----|
| `--background` | `oklch(18% 0.012 250)` 深蓝灰（不纯黑） |
| `--foreground` | `oklch(95% 0.008 90)` |
| `--surface` | `oklch(22% 0.012 250 / 0.7)` 半透明 |
| `--surface-elevated` | `oklch(24% 0.012 250)` |
| `--muted` | `oklch(26% 0.012 250)` |
| `--muted-foreground` | `oklch(70% 0.012 250)` |
| `--border` | `oklch(30% 0.015 250)` |
| `--ring` | `oklch(75% 0.16 65)` 暖焦点环 |
| `--accent` | `oklch(75% 0.16 65)` |
| `--accent-fg` | `oklch(15% 0.02 65)` |

### 4.3 6 套预设主题（用户一键切换）

| ID | 名称 | 浅色 base | 暗色 base | 灵感 |
|----|------|----------|----------|------|
| `paper` | 纸面奶白 | oklch(98.5% 0.005 90) | oklch(18% 0.012 250) | 默认 |
| `ink` | 墨韵深褐 | oklch(97% 0.008 60) | oklch(16% 0.018 50) | 偏文人气 |
| `mint` | 薄荷晨雾 | oklch(98% 0.012 160) | oklch(17% 0.02 160) | WorkBuddy |
| `lavender` | 紫晶夜读 | oklch(98% 0.012 290) | oklch(18% 0.025 290) | Hermes |
| `amber` | 琥珀灯下 | oklch(97% 0.02 75) | oklch(16% 0.025 65) | 暖夜 |
| `ocean` | 海盐青蓝 | oklch(98% 0.008 220) | oklch(17% 0.025 220) | Cursor 蓝 |

存储位置：`UserPreferences.themePreset` 字段，枚举 `paper | ink | mint | lavender | amber | ocean`。

### 4.4 DIY 强调色（HSL 滑块）

- 用户拖动三个滑块：H(0-360) / S(0-100%) / L(40-80%)
- 实时生成 `--accent` / `--ring` / `--accent-fg` 三个变量
- 保存到 `UserPreferences.accentHsl`（字符串如 `"65 75% 55%"`）
- 应用时通过 CSS 变量注入：`accent: hsl(var(--accent-hsl))`
- 用 `useDeferredValue` 延迟滑块反馈，避免卡顿

### 4.5 配色对比度自检（每次配色必跑）

| 组合 | 阈值 | 备注 |
|------|------|------|
| 奶白底 / 深墨字 | ≥ 7:1 | AAA |
| 暗色底 / 浅墨字 | ≥ 7:1 | AAA |
| 琥珀强调 / 奶白底 | ≥ 3:1 | 仅大字号或图标 |
| 琥珀强调 / 暗色底 | ≥ 4.5:1 | AA |
| 灰奶 muted / 浅奶底 | ❌ 禁止做文字 | 仅分隔用 |

---

## 5. 布局骨架（缝合怪式，三模式可切换）

### 5.1 通用结构

```
┌─────────────────────────────────────────────────────────────┐
│ [Sidebar 240px]  │  [Topbar 56px]                            │
│                  ├──────────────────────────────────────────┤
│  Logo + 工作区   │                                          │
│  ─────           │                                          │
│  模式切换器       │         主内容区（按模式变化）             │
│  • 工作台        │                                          │
│  • 对话          │                                          │
│  • 项目          │                                          │
│  • 插件          │                                          │
│  • 用量          │                                          │
│  • 设置          │                                          │
│  ─────           │                                          │
│  收藏 / 历史      │                                          │
│  ─────           │                                          │
│  主题切换        │                                          │
│  用户卡片        │                                          │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 模式一：工作台（Workbench — Cursor 风）

- 左栏：项目列表（带收藏星标） + 收藏对话
- 主区：顶部欢迎语 + 4 个快捷入口（新建项目 / 新建对话 / 导入仓库 / 运行评测）
- 下方：最近项目表格（按时间倒序，深 hairline 分隔，无卡片堆叠）

### 5.3 模式二：对话（Chat — ChatGPT 风）

- 左栏：对话列表（搜索 + 分组：今天 / 昨天 / 7 天内 / 更早）
- 主区：宽屏居中 `max-w-3xl` 对话流，输入框固定底部
- 输入框附工具栏：模型选择 / 附件 / 语音
- 右上角：模型下拉（DeepSeek V4 / K2.7 / Claude） + 临时设置

### 5.4 模式三：项目（Projects — Trae / Qoder 风）

- 左栏：项目列表 + 标签过滤（公开 / 私有 / 回收站）
- 主区：项目网格（封面 + 名称 + 最新评分 + 操作），3 列响应式

### 5.5 侧栏宽度决策

默认 240px（比现 224 略宽，能放工具区）。若需紧凑模式可缩到 56px（图标列）。

---

## 6. 组件清单（按层级，标 [新] / [改] / [沿]）

### 6.1 主题层

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/lib/themes.ts` | [新] | 6 套预设定义 + DIY 计算 |
| `src/components/theme/theme-provider.tsx` | [改] | 替换旧 provider，支持 preset / accent / bgUrl |
| `src/components/theme/theme-switcher.tsx` | [新] | 主题选择弹窗（预设网格 + DIY + 背景图） |
| `src/components/theme/accent-picker.tsx` | [新] | HSL 三滑块 |
| `src/components/theme/background-uploader.tsx` | [新] | 上传 + 客户端压缩 + R2 持久化 |

### 6.2 布局层

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/components/layout/app-shell.tsx` | [改] | 三模式壳，替代旧单一工作台 |
| `src/components/layout/sidebar-nav.tsx` | [新] | 侧栏菜单组件 |
| `src/components/layout/topbar.tsx` | [新] | 顶部操作栏 |
| `src/components/layout/command-palette.tsx` | [新] | Cmd+K 全局搜索（Trae 风） |

### 6.3 工作台层

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/app/(app)/workbench/page.tsx` | [改] | 重写为 Cursor 风首页 |
| `src/components/workbench/quick-actions.tsx` | [新] | 4 个快捷入口 |
| `src/components/workbench/recent-projects.tsx` | [新] | 表格化最近项目 |

### 6.4 数据层

| 文件 | 状态 | 说明 |
|------|------|------|
| `prisma/schema.prisma` | [改] | 新增 `UserPreferences` 模型 |
| `src/server/routers/preferences.ts` | [新] | tRPC 增删改查 |
| `src/app/api/upload/bg/route.ts` | [新] | Next Route Handler 接 R2 |

### 6.5 沿用资产

| 资产 | 来源 |
|------|------|
| 图标库 | `@tabler/icons-react`（已装） |
| 主字体 | `geist` 包（已装） |
| R2 上传通道 | `src/lib/cleanup.ts` 的 `extractR2Key` + `S3Client` |
| tRPC context | 已有 `createContext`，加 `preferences` router |
| 会话 | `next-auth`（已集成） |

---

## 7. 冲突检查清单（实施前必读）

| 冲突点 | 现有 | 新方案 | 兼容性处理 |
|--------|------|--------|----------|
| 主题 localStorage key | `aihub-theme` 存 `light / dark / system` | 改为 `{preset, accent, bgUrl}` JSON | 旧值识别为 `preset='paper', accent=null, bgUrl=null` |
| ThemeProvider Context | 三态字符串 | 改为对象 `{theme, setPreset, setAccent, setBg}` | 同步 `useTheme` 调用方 |
| AppShell 组件签名 | `{user, children}` | 增加 `mode` prop，三模式壳 | 调用方仅在 `(app)/layout.tsx` |
| globals.css 变量 | shadcn 默认 HSL | 替换为奶白 / 暗色 OKLCH | 全站视觉刷新，逐页验证 |
| `<html>` 类名 | 仅 `.dark` | 加 `.dark` + `.theme-{preset}` | 不破坏 Tailwind 暗色机制 |

---

## 8. 性能 / 体验约束

| 项 | 约束 |
|----|------|
| 背景图上传 | ≤ 5MB 原图，客户端压到 ≤ 500KB，1920×1080 |
| OKLCH 浏览器兼容 | 不支持回退 HSL（`color-mix` 检测） |
| 主题切换闪烁 | 在 `<head>` 注入同步脚本，FOUC 屏蔽 |
| DIY 滑块反馈 | 用 `useDeferredValue` 延迟 |
| 侧栏折叠状态 | 持久化到 localStorage + 后端 |
| 首次加载 | 主题脚本内联到 head，避免 hydrate 闪烁 |

---

## 9. 实施前必问用户的 3 个决策点

| # | 问题 | 默认答案 |
|---|------|----------|
| 1 | 背景图存储方式 | 后端 R2 永久存储 + Prisma 元数据 |
| 2 | DIY 配色粒度 | 6 预设 + HSL 强调色（不让自定义完整 CSS 变量） |
| 3 | 布局参考 | Cursor + ChatGPT 混合 |

如用户回答与默认不同，记录到设计报告顶部，覆盖下文。

---

## 10. 验收标准（每个阶段必须满足）

### 视觉
- [ ] 浅色背景是奶白（非纯白），用 OKLCH 验证
- [ ] 暗色背景是深蓝灰（非纯黑），用 OKLCH 验证
- [ ] 任意界面扫不到 emoji
- [ ] 任意界面扫不到 `bg-gradient-to-*` 单色渐变
- [ ] 所有圆角 ≤ 12px
- [ ] 暗色背景可见 1% 噪点纹理

### 功能
- [ ] 6 套预设可一键切换并持久化（刷新后保留）
- [ ] DIY 强调色 HSL 三滑块可调，实时生效
- [ ] 上传背景图：客户端压缩 → R2 → Prisma 记录 → 全站背景生效
- [ ] 移除背景图可恢复默认
- [ ] 主题 / DIY / 背景图均用户级持久化（跨设备登录各自保留）

### 性能
- [ ] 首屏无 FOUC（head 内联同步脚本）
- [ ] 切换主题 < 16ms（一帧）
- [ ] DIY 滑块拖动不卡顿（useDeferredValue）

---

## 11. 绝对禁止

- 直接动手写组件代码而不先出设计报告
- 在没拿到用户对 3 个决策点的回答前进入 Phase 2
- 修改不相关的现有文件（除非是必要的数据层迁移）
- 引入新的图标库 / 字体库 / UI 库
- 用 emoji 替代图标
- 用 `bg-gradient-to-r` 做主背景
- 把侧栏塞到全宽（必须保持 240px 固定宽度感）
- 在 globals.css 里再加一份硬编码颜色（必须用 CSS 变量）

---

## 12. 完成标志

- [ ] Phase 1 设计报告已写到 `docs/ui-style-report.md` 或聊天输出
- [ ] 3 个决策点已由用户回答
- [ ] UserPreferences 模型已加入 `prisma/schema.prisma` 并 migrate
- [ ] P0 阶段可见效果：切换 6 预设、DIY 强调色
- [ ] P1 阶段可见效果：上传背景图并持久化
- [ ] P2 阶段可见效果：三模式切换正常，UI 无 emoji、无单色渐变
- [ ] 所有验收清单已勾选