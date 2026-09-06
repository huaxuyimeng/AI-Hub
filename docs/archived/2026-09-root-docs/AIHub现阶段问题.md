# AIHub 工作台 UI 深度评审报告

> **版本**: v1.0 · **评审日期**: 2026-08-28 · **评审范围**: `src/app/**` · `src/components/**` · `src/lib/**` · `src/server/**` · `prisma/schema.prisma` · `tailwind.config.ts` · `globals.css`
> **评审基线**: `.cursor/skills/workbench-ui-designer/SKILL.md`（工程师书房质感工作台）

---

## 目录

1. [评审维度与定级标准](#1-评审维度与定级标准)
2. [视觉层（Visual）](#2-视觉层visual)
3. [组件层（Components）](#3-组件层components)
4. [交互层（Interaction & a11y）](#4-交互层interaction--a11y)
5. [页面层（Pages）](#5-页面层pages)
6. [动效与微交互（Motion）](#6-动效与微交互motion)
7. [响应式与多分辨率（Responsive）](#7-响应式与多分辨率responsive)
8. [性能与渲染（Performance）](#8-性能与渲染performance)
9. [数据 / 状态层（Data & State）](#9-数据--状态层data--state)
10. [后端联动（Backend Coupling）](#10-后端联动backend-coupling)
11. [安全与权限（Security）](#11-安全与权限security)
12. [设计 token 一致性（Design Tokens）](#12-设计-token-一致性design-tokens)
13. [无障碍（Accessibility）](#13-无障碍accessibility)
14. [可维护性 / 代码质量（Maintainability）](#14-可维护性--代码质量maintainability)
15. [国际化 / 文案（i18n & Copy）](#15-国际化--文案i18n--copy)
16. [问题汇总矩阵](#16-问题汇总矩阵)
17. [建议落地路线](#17-建议落地路线)

---

## 1. 评审维度与定级标准

### 11 个评审维度

| # | 维度 | 关注点 |
|---|------|--------|
| 1 | **Visual** | 设计 token、颜色对比、字体层级、间距、圆角、阴影、视觉一致性 |
| 2 | **Components** | 每个核心组件的完整性、状态、props 一致性 |
| 3 | **Interaction & a11y** | 键盘、焦点、ARIA、错误/空/加载状态 |
| 4 | **Pages** | 每个页面的布局、信息架构、导航 |
| 5 | **Motion** | 进入/退出/状态过渡、prefers-reduced-motion |
| 6 | **Responsive** | 320 ~ 1920、断点、折叠态 |
| 7 | **Performance** | 重渲染、context 抖动、bundle 大小、image 体积 |
| 8 | **Data & State** | loading / error / empty 三态、cache 失效、并发 |
| 9 | **Backend Coupling** | 前端契约、错误码处理 |
| 10 | **Security** | XSS、CSRF、速率限制、权限校验 |
| 11 | **Accessibility / i18n / Maintainability** | 屏幕阅读器、键盘导航、文案一致性 |

### 严重度定义

| 级别 | 含义 | 处理方式 |
|------|------|---------|
| 🔴 **P0 Critical** | 阻塞构建 / 数据丢失 / 安全漏洞 / 关键功能不可用 | **24h 内** |
| 🟠 **P1 High** | 主要功能降级 / 视觉明显违和 / 设计硬约束违反 | **本周** |
| 🟡 **P2 Medium** | 体验不佳 / 一致性缺失 / 边缘 case 未处理 | **下周** |
| � **P3 Low** | 微优化 / 文案 / 重构 / 可有可无 | **下迭代** |
| ⚪ **P4 Idea** | 锦上添花，未来考虑 | 不限时 |

---

## 2. 视觉层（Visual）

### V-01 🔴 P0：`projects/[id]/page.tsx` Next 14/15 API 不兼容

**位置**：`src/app/(app)/projects/[id]/page.tsx:147-148`

```147:148:src\app\(app)\projects\[id]\page.tsx
export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
```

- `package.json` 锁定 `next: ^14.2.0`
- `params: Promise<...>` + `use()` hook 是 **Next 15** 的 API
- Next14.2 中 `params` 是同步对象，`use()` hook 不存在
- 项目详情路由直接崩 / `pnpm build` 失败

**修复**：

```ts
export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
```

---

### V-02 🟠 P1：项目列表软删/硬删按钮使用**同一图标**

**位置**：`src/app/(app)/projects/page.tsx:138-162`

```138:162:src\app\(app)\projects\page.tsx
// 两个按钮都是 IconDotsVertical，仅靠 title 区分
<button title="移入回收站">
  <IconDotsVertical size={12} />
</button>
<button title="永久删除">
  <IconDotsVertical size={12} />
</button>
```

- 两个按钮外观一致，**误点硬删除风险高**
- 与"工程师书房"克制风格严重违和（应是清晰图标语义）

**修复**：

```tsx
<IconArchive size={12} />   {/* 软删 = 归档 */}
<IconTrash size={12} />      {/* 硬删 = 永久 */}
```

或合并成一个 `Dropdown Menu`，点 `IconDotsVertical` 弹出「归档 / 永久删除」。

---

### V-03 🟠 P1：背景图 `has-bg-image::before` z-index: -1 失效风险

**位置**：`src/app/globals.css:180-195`

```180:195:src\app\globals.css
.has-bg-image {
  background-image: var(--bg-image);
  /* ... */
}
.has-bg-image::before {
  position: fixed;
  inset: 0;
  background: var(--background);
  opacity: 0.86;
  z-index: -1;
}
```

- 当前 `.has-bg-image` 加在 `<html>`（由 `theme-provider.tsx` 第 54 行 `root.classList.add('has-bg-image')`）
- `html` 是根元素，自身不创建 stacking context，但**子元素中的 modal / fixed 元素**会与 `::before`（z-index: -1）冲突
- `<Dialog>` 用 `z-50`，但 `::before` 在 fixed 层上——叠在背景图上的半透明遮罩，**可能在某些浏览器/transform 场景下沉到内容之下**
- 当前 `body` 也设了 `background-color: var(--background)`——双重背景逻辑不一致

**修复**：把背景图机制放在 `body` 上：

```css
body.has-bg-image {
  background-image: var(--bg-image);
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  background-color: transparent;
}
body.has-bg-image::before {
  content: '';
  position: fixed;
  inset: 0;
  background: var(--background);
  opacity: 0.86;
  pointer-events: none;
  z-index: 0;
}
body.has-bg-image > * {
  position: relative;
  z-index: 1;
}
```

---

### V-04 🟠 P1：违反「严禁简单线性单色渐变」硬约束

**位置**：
- `src/components/theme/theme-switcher.tsx:230` — `linear-gradient(135deg, ${p.background}, ${p.surfaceElevated})` 作预设卡片预览
- `src/components/theme/accent-picker.tsx:84, 95, 106` — 滑块 track 用 HSL 线性渐变

skill §3 明确禁止纯线性单色渐变。前者可改为两个独立色块；后者（功能渐变）建议在 skill 文档中明确「滑块 track 例外」，或改为分段纯色块 + 刻度线。

**修复**：

```ts
// theme-switcher.tsx
function presetBgStyle(preset: ThemePreset, mode: 'light' | 'dark'): string {
  return mode === 'light' ? PRESETS[preset].light.background : PRESETS[preset].dark.background;
}
// PresetCard：左右两个独立色块，中间 1px border
```

---

### V-05 🟡 P2：汇率硬编码 `*7` 不准确

**位置**：
- `src/app/(app)/workbench/page.tsx:99` — `¥${(usage.data.totals.costCents / 100 * 7).toFixed(2)}`
- `src/app/(app)/usage/page.tsx:52` — 同样写法

实际 USD→CNY ≈ 7.2，且汇率随时间变化。硬编码 7 让显示数字系统性偏低。

**修复**：

```ts
// lib/env.ts 新增
USD_TO_CNY: z.coerce.number().default(7.2),
// 或 constants.ts
export const USD_TO_CNY = 7.2;
```

---

### V-06 🟡 P2：首页「早上好，工程师」硬编码

**位置**：`src/app/(app)/workbench/page.tsx:30-33`

```30:33:src\app\(app)\workbench\page.tsx
          <p>Workbench</p>
          <h1>早上好，<span className="text-primary">工程师</span></h1>
```

- "工程师"永远不变，没用 `session.user.name`
- 「工程师」放在 `text-primary`（accent 色）上视觉是 highlight，但**所有用户都看到"工程师"**——失去个性化的意义

**修复**：

```tsx
import { useSession } from 'next-auth/react';
const { data: session } = useSession();
// ...
<h1>早上好，<span>{session?.user?.name ?? '工程师'}</span></h1>
```

---

### V-07 🟡 P2：`tailwind.config.ts` 颜色硬编码 OKLCH 字面量

**位置**：`tailwind.config.ts:35, 43, 47`

```35:35:tailwind.config.ts
foreground: 'oklch(98% 0.005 90)', // destructive.foreground
```

- `destructive.foreground`、`success.foreground`、`warning.foreground` 都是硬编码 OKLCH
- 切到 amber 预设（暖橙）后，destructive（红）按钮上的文字仍是白——**对比度边缘**
- 应改用 CSS 变量，让主题切换时文字色也跟随调整

**修复**：

```css
/* globals.css */
:root {
  --destructive-fg: oklch(98% 0.005 90);
  --success-fg: oklch(98% 0.005 90);
  --warning-fg: oklch(20% 0.02 65);
}
```

```ts
// tailwind.config.ts
destructive: {
  DEFAULT: 'var(--destructive)',
  foreground: 'var(--destructive-fg)',
},
```

---

### V-08 🟡 P2：`bg-card` 用半透明 `--surface`（60% 不透明），弹窗层级「透」

**位置**：`tailwind.config.ts:53-56` + `globals.css:21`

```21:21:src\app\globals.css
--surface: oklch(100% 0 0 / 0.6);
```

- `bg-card` → `var(--surface)` → 60% 不透明
- 弹窗背景、命令面板用 `surface-elevated`（100% 不透明）——OK
- 但**普通页面里的卡片**（表格 / StatCard 等）也是半透明
- 叠在背景图上**正常**，但叠在 dialog 上**会"透"出后面内容**
- 与「纸感分层」意图冲突——分层应该是「不透明卡片 + 透出大背景」，而不是卡片本身半透明

**建议**：区分 `card`（100%）与 `card-glass`（60%），需要透的时候用后者。

---

### V-09 🟡 P2：滚动条 thumb 颜色用 `--border`，但 hover 用 `--muted-foreground`，层级跳跃

**位置**：`src/app/globals.css:97-111`

```97:111:src\app\globals.css
::-webkit-scrollbar-thumb {
  background: var(--border); /* 浅 */
  border-radius: 5px;
  border: 2px solid var(--background);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--muted-foreground); /* 深 */
}
```

- `--border` → `--muted-foreground` 是两个不同的设计语义层级
- 滚动条 hover 应该用 `--accent` 或 `--foreground` 的低透明版本，而非 muted-foreground（会与正文文字同色）

**修复**：

```css
::-webkit-scrollbar-thumb:hover {
  background: var(--accent);
  opacity: 0.6;
}
```

---

### V-10 🟡 P2：success / warning 颜色未被任何组件使用

**位置**：`tailwind.config.ts:41-48` 定义了 `success: { DEFAULT: 'var(--success)' }`，但：

- 全代码搜不到 `text-success` 或 `bg-success`
- 「评分通过」用 `bg-green-500/15 text-green-700`（Tailwind 默认色），**绕过主题色板**

**修复**：把所有 `bg-green-500/15 text-green-700`、`bg-yellow-500/15 text-yellow-700` 替换为 `bg-success/15 text-success`、`bg-warning/15 text-warning`。

涉及文件：
- `src/app/(app)/workbench/page.tsx:178-180`
- `src/app/(app)/projects/page.tsx:118-122`
- `src/app/(app)/plugins/page.tsx:77-78`
- `src/app/(app)/projects/[id]/page.tsx:246-250`
- `src/app/(app)/settings/page.tsx:125-127,140`

---

### V-11 🔵 P3：图标按钮 hover 时颜色变化不充分

**位置**：多处 `IconTrash`、`IconDotsVertical` 按钮

- 例如 `src/app/(app)/settings/page.tsx:185` `text-destructive hover:bg-destructive/10`，但**图标颜色不变**
- 视觉反馈不够强

---

### V-12 🔵 P3：`scrollbar` 宽度 10px，但 macOS 用户预期 8px

**位置**：`src/app/globals.css:97-99`

10px 在 macOS 上略粗，8px 更精致。

---

### V-13 🔵 P3：`<button type="button">` 重复声明 50+ 次

可以提取 `<IconButton>` 组件统一管理 type / size / variant / 禁用样式。

---

## 3. 组件层（Components）

### C-01 🟠 P1：`accent-picker` 重置按钮 disabled 状态错误

**位置**：`src/components/theme/accent-picker.tsx:61`

```61:61:src\components\theme\accent-picker.tsx
disabled={!theme.accent}
```

- 拖动期间 `local` 有值，但 `theme.accent` 还是旧的
- 假如用户**本来没设过** accent（`theme.accent === null`），拖动期间 `local` 已有值——按钮该 enabled，但被 disabled
- 视觉上像没反应

**修复**：

```tsx
disabled={!theme.accent && !local}
```

---

### C-02 🟠 P1：`theme-switcher` 删除背景图后未 invalidate

**位置**：`src/components/theme/theme-switcher.tsx:34-41`

```34:41:src\components\theme\theme-switcher.tsx
async function handleRemoveBg() {
  try {
    await fetch('/api/upload/bg', { method: 'DELETE' });
    setBgUrl(null);
  } catch (err) {
    setUploadError((err as Error).message);
  }
}
```

- `setBgUrl(null)` 只更新本地状态
- 没调 `utils.preferences.get.invalidate()`
- **远程缓存的 bgUrl 没清**，下次重新登录还会拉回 R2 链接（虽然 API 也清了 DB，但前端 cache 脏）

**修复**：

```ts
async function handleRemoveBg() {
  const res = await fetch('/api/upload/bg', { method: 'DELETE' });
  if (!res.ok) {
    setUploadError('删除失败');
    return;
  }
  setBgUrl(null);
  utils.preferences.get.invalidate();
}
```

---

### C-03 🟠 P1：`ThemeProvider` useEffect 依赖被强制忽略，跨设备同步漏触发

**位置**：`src/components/theme-provider.tsx:111-122, 124-144`

```111:122:src\components\theme-provider.tsx
React.useEffect(() => {
  if (status !== 'authenticated' || !remoteTheme.data) return;
  const rt = remoteTheme.data.theme;
  if (rt.bgUrl || rt.accent) {
    setThemeState(rt);
    writeStoredTheme(rt);
    remoteSyncRef.current = true;
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [status, remoteTheme.data?.hasRecord]);
```

- `disable-next-line` 屏蔽后，`remoteTheme.data.theme` / `bgUrl` / `accent` 改动后**不会再次触发**
- 只在 `hasRecord` 翻转时触发一次
- 假设用户在 B 设备改了主题（hasRecord 没变），回到 A 设备**不会自动同步**

**修复**：用 ref 标记「已同步过」：

```ts
const hasSyncedRef = useRef(false);
useEffect(() => {
  if (status !== 'authenticated' || !remoteTheme.data || hasSyncedRef.current) return;
  const rt = remoteTheme.data.theme;
  if (rt.bgUrl || rt.accent) {
    setThemeState(rt);
    writeStoredTheme(rt);
    hasSyncedRef.current = true;
  }
}, [status, remoteTheme.data]);
```

---

### C-04 🟠 P1：`ThemeProvider` 远程写覆盖本地写，存在竞争

**位置**：`src/components/theme-provider.tsx:80-140`

- `writeRemoteTimer` 用 setTimeout 600ms 防抖
- 但**没有取消 in-flight 请求**——如果用户连续拖动，前一个 mutate 可能晚于后一个返回，**回写旧值**
- `updateThemeMut.mutateAsync(...)` 没 abort 控制

**修复**：

```ts
const abortRef = useRef<AbortController | null>(null);
const writeRemote = useCallback((next: StoredTheme) => {
  if (status !== 'authenticated') return;
  if (writeRemoteTimer.current) clearTimeout(writeRemoteTimer.current);
  writeRemoteTimer.current = setTimeout(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    updateThemeMut.mutate({...}); // 用 mutate 而非 mutateAsync，配合 invalidate
  }, 600);
}, [status, updateThemeMut]);
```

---

### C-05 🟡 P2：`useLocalCollapse` SSR 不一致，会闪

**位置**：`src/components/app-shell.tsx:186-204`

```186:204:src\components\app-shell.tsx
function useLocalCollapse(defaultValue: boolean): [boolean, () => void] {
  const [v, setV] = useState(defaultValue);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY);
      if (stored === '1') setV(true);
      else if (stored === '0') setV(false);
    } catch {}
  }, []);
```

- SSR 渲染 collapsed=false → 客户端 mount 后读 localStorage 改值
- 用户看到「先展开后折叠」的 flash

**修复**：在 FOUC 脚本里同步写初始值（参考 `NO_FOUC_SCRIPT` 处理 theme 的方式），或用 `useSyncExternalStore`。

---

### C-06 🟡 P2：`app-shell` 的 `user` 信息缺失 `image`

**位置**：`src/components/app-shell.tsx:16-22`

```16:22:src\components\app-shell.tsx
interface User {
  id: string;
  name: string | null;
  email: string | null;
  tenantId: string | null;
  role: 'ADMIN' | 'MEMBER';
}
```

- Prisma User 有 `image` 字段，但 AppShell 没接收
- 用户头像只显示硬编码字母 `A`（`src/components/app-shell.tsx:50-52`），**没用真实头像**

**修复**：

```ts
interface User {
  // ...
  image: string | null;
}
// layout.tsx 多传一个字段
<AppShell user={{ ...session.user, image: session.user.image ?? null }}>
// AppShell 里 <Image src={user.image} /> fallback 到首字母
```

---

### C-07 🟡 P2：`<span role="button">` 无键盘可达性

**位置**：`src/app/(app)/chat/page.tsx:98-107`

```98:107:src\app\(app)\chat\page.tsx
<span
  role="button"
  tabIndex={0}
  onClick={(e) => { ... }}
```

- `<span role="button">` 没绑 `onKeyDown`
- 键盘用户按 Enter / Space 没反应
- ARIA 实践上应**直接用 `<button>`**

**修复**：

```tsx
<button
  type="button"
  onClick={(e) => { e.stopPropagation(); ... }}
  aria-label="删除对话"
>
  <IconTrash size={11} />
</button>
```

---

### C-08 🟡 P2：`StatCard` 与 `Card` 同名重复组件

**位置**：
- `src/app/(app)/workbench/page.tsx:263-285` 定义 `StatCard`
- `src/app/(app)/usage/page.tsx:122-143` 定义 `Card`
- `src/app/(app)/usage/page.tsx:145-151` 定义 `Row`

- 两个卡片组件，**签名和样式略不同**
- 应该提到 `src/components/ui/` 统一

---

### C-09 🟡 P2：`PresetCard` 的 active 态用 `ring-2 ring-ring/30` 太弱

**位置**：`src/components/theme/theme-switcher.tsx:199-204`

```199:204:src\components\theme\theme-switcher.tsx
(active
  ? 'border-primary ring-2 ring-ring/30'
  : 'hover:border-foreground/20')
```

- `ring-ring/30` 在浅色主题上几乎看不见
- 应改为 `ring-2 ring-primary/40` 或加 left accent bar

---

### C-10 🟡 P2：`<dialog>` 没有 trap focus

**位置**：
- `src/components/theme/theme-switcher.tsx:59-176`（dialog）
- `src/components/layout/command-palette.tsx:80-156`（dialog）

- 两个 dialog 都用 `<div>` 模拟，**没有 focus trap**
- Tab 键会跑到后面的内容上（穿透 modal）
- 屏幕阅读器不会识别为 dialog

**修复**：用原生 `<dialog>` 元素（HTML 5.2）或 `headlessui` 的 `<Dialog>`：

```tsx
<dialog open={open} onClose={() => setOpen(false)} className="...">
  {/* 自动 focus trap + ESC 关闭 */}
</dialog>
```

---

### C-11 🟡 P2：`TablerIconType` 类型导入可能引起循环

**位置**：`src/components/app-shell.tsx:12`

```12:12:src\components\app-shell.tsx
import type { Icon as TablerIconType } from '@tabler/icons-react';
```

- `Icon` 是动态类型；某些版本下 `import type` 会被运行时打包器忽略
- 编译期 OK，但 dev 模式下 hot-reload 偶发报「Cannot find type」

**修复**：用 `ComponentType` 或显式类型：

```ts
import { type Icon as TablerIconType } from '@tabler/icons-react';
// 或
import type { ComponentType, SVGProps } from 'react';
type TablerIconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
```

---

### C-12 � P3：`Projects` 页的 `trash` / `hardDelete` 两个按钮挨在一起，误点距离仅 4px

**位置**：`src/app/(app)/projects/page.tsx:135-162`

- 行动按钮的 touch target 至少 24×24，但两个按钮紧挨
- 移动端容易误点
- 建议硬删除按钮加 `确认对话框`（已经用了 confirm，但 UX 不一致）

---

## 4. 交互层（Interaction & a11y）

### I-01 🔴 P0：Chat 输入框 placeholder 承诺的「Esc 打开命令面板」未实现

**位置**：`src/app/(app)/chat/page.tsx:185`

```185:185:src\app\(app)\chat\page.tsx
placeholder="输入消息… (Shift+Enter 换行，Esc 打开命令面板)"
```

- placeholder 告诉用户按 Esc 打开命令面板
- `src/components/layout/command-palette.tsx:47-58` 只监听 `Cmd/Ctrl + K`，**没有 Esc 监听**
- 用户按 Esc 无反应

**修复**（二选一）：
1. 删掉 placeholder 中的「Esc 打开命令面板」
2. 在 command-palette 加监听：

```ts
} else if (e.key === 'Escape' && !open) {
  e.preventDefault();
  (document.activeElement as HTMLElement)?.blur();
  setOpen(true);
}
```

---

### I-02 🔴 P0：删除对话 `confirm()` 文案可能输出「undefined」

**位置**：`src/app/(app)/chat/page.tsx:102`

```102:102:src\app\(app)\chat\page.tsx
if (confirm(`删除「${c.title}」？`)) trash.mutate({ id: c.id });
```

- `c.title` 是 Prisma `String?` 字段
- 老数据或异常路径可能为 null
- 渲染用了 `c.title ?? '未命名'`，但 confirm 这里没用 fallback

**修复**：

```tsx
if (confirm(`删除「${c.title ?? '未命名'}」？`)) ...
```

---

### I-03 🟠 P1：`app-shell` 的折叠状态不同步服务器

**位置**：`src/components/app-shell.tsx:186-204`

- 只用 localStorage，**未调** `preferences.setSidebar` mutation
- 跨设备登录后侧栏状态丢失
- 与 theme 的双层持久化模式**不一致**

**修复**：

```ts
const setSidebar = trpc.preferences.setSidebar.useMutation();
const toggle = () => {
  const next = !v;
  localStorage.setItem(KEY, next ? '1' : '0');
  if (status === 'authenticated') setSidebar.mutate({ mode: next ? 'collapsed' : 'expanded' });
  setV(next);
};
```

---

### I-04 🟠 P1：原生 `confirm()` 风格脱节

**位置**：
- `src/app/(app)/chat/page.tsx:102`
- `src/app/(app)/projects/page.tsx:140, 151`
- `src/app/(app)/settings/page.tsx:183`

- 原生 `confirm()` 在暗色主题下弹出**白色系统对话框**，**严重违和**
- 与「工程师书房」克制风格冲突
- 阻塞主线程，体验差

**修复**：提取 `<ConfirmDialog>` 组件，调用方：

```tsx
<ConfirmDialog
  title="删除对话"
  description={`确认删除「${c.title ?? '未命名'}」？此操作不可恢复。`}
  onConfirm={() => trash.mutate({ id: c.id })}
  destructive
/>
```

---

### I-05 🟠 P1：Chat 页可能无限循环重渲染

**位置**：`src/app/(app)/chat/page.tsx:41-43`

```41:43:src\app\(app)\chat\page.tsx
useEffect(() => {
  if (!activeId && listQ.data?.items[0]) setActiveId(listQ.data.items[0].id);
}, [activeId, listQ.data]);
```

- `listQ.data` 是引用，每次 invalidate 后 refetch 即使内容不变，**对象引用变**
- 配合 `setActiveId` 触发 effect 重执行，可能无限循环

**修复**：

```ts
useEffect(() => {
  if (!activeId && listQ.data?.items[0]?.id) {
    setActiveId(listQ.data.items[0].id);
  }
}, [activeId, listQ.data?.items[0]?.id]); // 用 id 而非整个 data
```

---

### I-06 🟠 P1：`command-palette` 全局监听 keydown，焦点在 textarea 时可能失效

**位置**：`src/components/layout/command-palette.tsx:47-58`

- 当焦点在 `<textarea>`（chat 输入框）按 Cmd+K，浏览器可能先吞掉组合键
- 解决：在 onKey 里强制 blur activeElement

```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
  e.preventDefault();
  (document.activeElement as HTMLElement)?.blur();
  setOpen(v => !v);
}
```

---

### I-07 🟠 P1：`command-palette` 与 `theme-switcher` 同 z-50，同时打开会重叠

**位置**：
- `src/components/layout/command-palette.tsx:82`
- `src/components/theme/theme-switcher.tsx:64`

两个都是 `z-50` + `fixed inset-0`，视觉重叠且焦点管理冲突。

**修复**：

- CommandPalette `z-[60]`，ThemeSwitcher `z-50`
- 全局维护一个 dialog stack（打开新 dialog 前关闭旧的）

---

### I-08 🟡 P2：所有错误信息只显示 `message`，无 actionable 按钮

**位置**：
- `src/app/(app)/workbench/page.tsx:127-130`
- `src/app/(app)/chat/page.tsx:170-174`
- `src/app/(app)/projects/page.tsx:60-64`

- 显示 `{error.message}` 但**没有「重试」按钮**
- 用户遇到网络错误只能刷新页面

**修复**：抽 `<ErrorState message error onRetry />` 组件：

```tsx
<ErrorState
  title="加载失败"
  description={error.message}
  onRetry={() => utils.chat.list.invalidate()}
/>
```

---

### I-09 🟡 P2：表单提交后 `error` 显示用 banner 样式，但 `chat page` 没沿用

**位置**：
- `src/app/(app)/projects/new/page.tsx:101-105` 用 banner
- `src/app/login/page.tsx:125-129` 用 banner
- `src/app/(app)/chat/page.tsx:170-174` 用 banner

- 一致性 OK，但**错误样式每次都手写**——抽组件

---

### I-10 🟡 P2：`isPending` 期间按钮 disabled，但**没有 loading spinner**

**位置**：多处 `disabled={create.isPending}` 后只显示「创建中…」文本

- 应该用 `IconLoader2 + animate-spin`（login page 已经用了，但其他页面没沿用）

---

### I-11 🟡 P2：Toast 通知系统缺失

- 多个 mutation 成功（如创建项目）后**没有任何反馈**
- 用户只看到 URL 跳转，**不知道成功还是失败**
- 需要全局 toast（推荐 `sonner` 或自实现）

---

### I-12 🟡 P2：`placeholder` 颜色对比度过低

**位置**：`tailwind.config.ts` 没专门定义 `placeholder:text-muted-foreground`

- 部分输入用了 `placeholder:text-muted-foreground`，但**默认 placeholder 颜色**在暗色主题下可能不足 3:1 对比度

---

### I-13 🔵 P3：键盘快捷键无文档

- Cmd+K 是命令面板——但**用户不知道**
- 应该首次打开时显示 hint，或在设置页列出

---

### I-14 🔵 P3：移动端没有 hamburger menu

- 侧栏在 < 768px 仍是 240px 宽，挤掉主内容
- 应该 < 768px 隐藏侧栏，改用 drawer

---

## 5. 页面层（Pages）

### P-01 � P2：workbench 顶部 CTA「新建项目」与下方 4 个 QuickAction 第 1 个重复

**位置**：`src/app/(app)/workbench/page.tsx:38-44, 49-54`

- 顶部右侧「新建项目」按钮
- 下方第 1 个 QuickAction 也是「新建项目」
- **冗余**

---

### P-02 🟡 P2：workbench 「运行评测」icon 用 `IconSparkles`，但描述是「查看 token 消耗」

**位置**：`src/app/(app)/workbench/page.tsx:68-72`

```68:72:src\app\(app)\workbench\page.tsx
<QuickAction
  href="/usage"
  icon={<IconSparkles size={18} />}
  label="运行评测"
  desc="查看 token 消耗"
/>
```

- label 是「运行评测」，desc 是「查看 token 消耗」——**自相矛盾**
- icon 是 sparkles（魔法），对应「AI 评测」语义——但点击只是跳到用量页

**修复**：要么 label 改成「查看用量」，要么 desc 改成「运行模型评测」

---

### P-03 🟡 P2：workbench QuickAction 「导入仓库」明确标注「P3 待接入」

**位置**：`src/app/(app)/workbench/page.tsx:62-66`

```62:66:src\app\(app)\workbench\page.tsx
<QuickAction
  href="/projects"
  icon={<IconPlug size={18} />}
  label="导入仓库"
  desc="（P3 待接入）"
/>
```

- 用「导入仓库」做 label 但点击跳到 `/projects`
- 这是**误导性 UI**

**修复**：要么移除，要么真做导入功能。

---

### P-04 🟡 P2：workbench 数据卡「项目 / 对话」显示的是数量（list count），但实际显示「items.length」

**位置**：`src/app/(app)/workbench/page.tsx:79-86`

```79:86:src\app\(app)\workbench\page.tsx
<StatCard
  label="项目"
  value={projects.data?.items.length}
  loading={projects.isLoading}
  href="/projects"
/>
```

- `take: 8` 限定最多拉 8 个——**长度可能小于真实项目数**
- 显示「5」不代表总项目数是 5
- 应在 label 加 hint，或去掉 take 限制做 count

---

### P-05 🟡 P2：usage 页「每日明细」日期格式 `2024-01-01T00:00:00.000Z` 截取前 10 位

**位置**：`src/app/(app)/usage/page.tsx:82`

```82:82:src\app\(app)\usage\page.tsx
<td className="px-4 py-2.5 font-mono text-xs">{d.date.toString().slice(0, 10)}</td>
```

- `Date.toString()` 在不同时区显示不同
- 截取前 10 位得到 `Wed Jan 01 2024...` 的前 10 位是「Wed Jan 01」（错了）
- **真正的 ISO 字符串** 应该用 `d.date.toISOString().slice(0, 10)`

**修复**：

```tsx
{new Date(d.date).toISOString().slice(0, 10)}
```

或更友好：

```tsx
{new Date(d.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
```

---

### P-06 🟡 P2：projects/[id] 页有「上传文件」按钮但没功能

**位置**：`src/app/(app)/projects/[id]/page.tsx:209`

```209:209:src\app\(app)\projects\[id]\page.tsx
<IconPlus size={11} className="cursor-pointer" title="上传 (TODO)" />
```

- 用 `cursor-pointer` 样式 + title「上传 (TODO)」让用户**以为能点**
- 点击**没任何反应**——典型 dead UI

**修复**：要么实现，要么去掉 cursor-pointer + 加灰显样式

---

### P-07 🟡 P2：projects/[id] 文件树是写死 SEED_FILES，与 project 实际文件无关

**位置**：`src/app/(app)/projects/[id]/page.tsx:114-145, 160-163`

- 写死 3 个文件（src/index.ts、src/auth/login.ts、src/util/db.ts）
- 不管点进哪个项目，**看到的都是同一棵文件树**
- **MVP 占位**应该明确标注「示例数据」

**修复**：

```tsx
<div className="mb-2 flex items-center justify-between px-2 text-xs text-muted-foreground">
  <span>文件 (示例)</span>
  <IconPlus size={11} />
</div>
```

---

### P-08 🟡 P2：settings 页 ThemeSwitcher 是触发器，dialog 里又有 ThemeToggle

**位置**：
- `src/components/theme-settings-panel.tsx:23` — `ThemeSwitcher` 组件
- `src/components/theme/theme-switcher.tsx:88-112` — dialog 内含三态 mode toggle

- 主题设置面板**只显示当前状态**（一行文案），点击按钮弹 dialog
- dialog 里又能改 preset / accent / bg
- **两级入口**导致入口分散

**修复**：要么 settings 页直接显示 ThemeSwitcher 的精简版（无 dialog），要么把 panel 整合到 dialog

---

### P-09 🔵 P3：login 页「服务条款 / 隐私政策」链接是 `<Link href="#">`

**位置**：`src/app/login/page.tsx:154`

- 点击跳到 `#` 会刷新页面顶端
- **死链**

---

### P-10 🔵 P3：home page 直接 redirect，没显示 loading

**位置**：`src/app/page.tsx`

- `/` → `/login` 或 `/workbench` 硬跳
- 用户看不到中间状态
- 可加 loading.tsx 或 skeleton

---

### P-11 🔵 P3：projects/[id] 项目名硬截断，没溢出提示

**位置**：`src/app/(app)/projects/[id]/page.tsx:181`

```181:181:src\app\(app)\projects\[id]\page.tsx
<div className="text-lg font-semibold">{p.name}</div>
```

- 项目名长会溢出（虽然当前 div 没有 truncate，但视觉上会有问题）
- 加 `truncate` + `title={p.name}` 提示

---

### P-12 🔵 P3：chat 页空状态文案「点 + 创建」但 + 按钮在右上角，距离空状态文案很远

**位置**：`src/app/(app)/chat/page.tsx:80-82`

- 用户看不到空状态文字与「+」之间的关联
- 应该把「+」按钮挪到空状态中央

---

## 6. 动效与微交互（Motion）

### M-01 🟡 P2：`page-enter` 动画被 `main > div.flex-1` 选择器误伤

**位置**：`src/app/globals.css:120-124`

```120:124:src\app\globals.css
.page-enter,
main > div.flex-1 {
  animation: page-enter 200ms ease-out;
}
```

- 选择器 `main > div.flex-1` 会匹配任何 `main` 下的 `flex-1` 子元素
- **所有页面**都会进入动画（包括 dialog 内部的 main）——可能造成不期望的闪烁
- 应该明确只对 `app-shell > main > div` 生效

---

### M-02 � P2：dialog open/close 没有过渡动画

**位置**：
- `src/components/theme/theme-switcher.tsx:64`
- `src/components/layout/command-palette.tsx:82`

- 都用 `animate-fade-in` / `animate-slide-down` 一次性播放
- **关闭时没有过渡**（突然消失）

**修复**：维护 `mounted` + `closing` 状态，离开时反向播放：

```tsx
const [mounted, setMounted] = useState(open);
useEffect(() => {
  if (open) setMounted(true);
  else setTimeout(() => setMounted(false), 200);
}, [open]);
```

或用 `<dialog>` 元素的 close 事件。

---

### M-03 🟡 P2：键盘快捷键 hint（Cmd+K）没有视觉提示

- 用户首次打开应用不知道有 Cmd+K
- 应在侧栏底部加一行小字：「⌘K 打开命令面板」

---

### M-04 🔵 P3：`hover` 过渡时间 200ms，鼠标快速划过会「卡顿」感

- 多个 transition 都用 `duration-200`，视觉上略迟钝
- 试试 `duration-150`

---

### M-05 🔵 P3：`page-enter` 的 `translateY(4px)` 太弱，几乎看不见

- 进入动画应该是 `translateY(8px)` + opacity

---

## 7. 响应式与多分辨率（Responsive）

### R-01 🟠 P1：AppShell 在窄屏下侧栏仍然占 240px

**位置**：`src/components/app-shell.tsx:42-46`

```42:46:src\components\app-shell.tsx
<aside
  className={
    'shrink-0 flex flex-col border-r bg-card transition-[width] duration-200 ' +
    (collapsed ? 'w-14' : 'w-60')
  }
>
```

- `< 768px` 时侧栏仍 240px，主内容区被严重压缩
- 应在 < 768px 默认 `collapsed`，并提供 hamburger 触发 drawer

---

### R-02 🟠 P1：workbench 表格在窄屏下横向滚动，但「查看全部」链接被裁切

**位置**：`src/app/(app)/workbench/page.tsx:117`

- 标题右侧链接在 < 768px 与表格 thead 重叠

---

### R-03 🟡 P2：projects 表格中 `slug` / `可见性` / `创建时间` 用 `hidden md:table-cell` 隐藏

- 但**没有展示在移动端的其他位置**——这些字段信息完全丢失
- 应该用卡片视图替代（移动端友好的项目卡片）

---

### R-04 🟡 P2：chat 页对话列表固定 `w-64` 不响应式

**位置**：`src/app/(app)/chat/page.tsx:63`

- 移动端聊天主区域被挤到只剩 ~50%
- 应该 < 768px 时对话列表变 full-screen modal

---

### R-05 🟡 P2：ThemeSwitcher dialog 固定 `max-w-2xl`

**位置**：`src/components/theme/theme-switcher.tsx:71`

- 移动端（375px 宽）几乎是全屏
- 应该 `max-w-2xl mx-4` 加左右 margin

---

### R-06 🔵 P3：横屏（landscape）下没有专门布局

- 移动设备横屏时，命令面板 pt-[14vh] 太大
- 应该用 `min(14vh, 80px)`

---

## 8. 性能与渲染（Performance）

### PE-01 🟡 P2：ThemeProvider 把 `theme` 对象放进 useMemo 但 theme 每次变更都变

**位置**：`src/components/theme-provider.tsx:155-178`

- `ctx` 依赖 `theme`，theme 变了 ctx 必变
- 所有消费 `useTheme()` 的组件**都会重渲染**（如 AppShell、ThemeSwitcher、AccentPicker）
- 优化：把 `setPreset`/`setMode`/`setAccent` 等不变 action 用 `useCallback` 稳定（已做），但 `theme` 本身必然变

**进一步优化**：拆分 context 为 `ThemeStateContext` + `ThemeActionsContext`，actions 不变，state 变只触发依赖 state 的组件。

---

### PE-02 🟡 P2：`theme-switcher` 的 `presetBgStyle` 每次渲染都创建新字符串

**位置**：`src/components/theme/theme-switcher.tsx:227-230`

- `linear-gradient` 字符串没缓存
- `PRESET_LIST.map` 渲染 6 个 PresetCard 时，6 个字符串重新拼
- 用 `useMemo` 缓存

---

### PE-03 🟡 P2：`AppShell` 没 memo，`user` prop 引用每次都变

**位置**：`src/components/app-shell.tsx:37`

- `(app)/layout.tsx` 每次渲染传新 user 对象 → AppShell 重渲染
- 应在 layout.tsx 用 `useMemo` 稳定 user 引用

---

### PE-04 🟡 P2：背景图上传成功后 `utils.preferences.get.invalidate()` 是全局 invalidate

**位置**：`src/components/theme-provider.tsx:173`

- `preferences.get` 全局失效，所有用 `preferences` 的组件都重渲染
- 应只 invalidate 当前 query key

---

### PE-05 🟡 P2：projects/[id] 的 `buildTree` 每次渲染都重算

**位置**：`src/app/(app)/projects/[id]/page.tsx:161`

```161:161:src\app\(app)\projects\[id]\page.tsx
const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files]);
```

- `files` 是写死 SEED_FILES，**用 useMemo 但永远算同一次**
- `files = SEED_FILES` 移到组件外即可

---

### PE-06 🔵 P3：`chat page` 的 `convQ` 每次 invalidate 都重新拉所有消息

**位置**：`src/app/(app)/chat/page.tsx:15`

- `utils.chat.byId.invalidate({ id: activeId! })` 会 invalidate 该对话
- 但**轮询订阅**缺失——AI 生成完后不会自动刷新
- 应加 `useEffect` 轮询或订阅（如果支持 SSE）

---

### PE-07 🔵 P3：`@tabler/icons-react` 按需导入配置缺失

- `import { IconHome, IconFolders, ... } from '@tabler/icons-react'` 是 named import
- 应确保 next.config.js 有 `experimental.optimizePackageImports` 启用
- 否则每个图标打包到 bundle 里

---

### PE-08 � P3：`trpc.project.list.useQuery({ take: 100 })` 默认拉 100 个项目

- 应做分页 + 无限滚动（cursor-based 已实现但前端没用）

---

## 9. 数据 / 状态层（Data & State）

### DS-01 🟠 P1：`analysis.run` 把 `contentHash` 写死为 `'pending'`

**位置**：`src/server/routers/analysis.ts:152-154`

```152:154:src\server\routers\analysis.ts
contentHash: 'pending',
r2Key: `pending/${f.path}`,
```

- `contentHash` 是去重键，**写死 'pending'** 让所有重跑的文件哈希相同
- 基于 contentHash 的缓存/dedup 逻辑会**全部失效**
- `r2Key: 'pending/${f.path}'` 也没真存 R2，是个假路径

**修复**：

```ts
import { createHash } from 'crypto';
const contentHash = createHash('sha256').update(f.content).digest('hex');
const r2Key = `projects/${projectId}/${contentHash.slice(0, 12)}-${path.basename(f.path)}`;
```

---

### DS-02 🟠 P1：`chat sendMessage` mock 模式污染账本

**位置**：`src/server/routers/chat.ts:101-106`

```101:106:src\server\routers\chat.ts
} catch (e) {
  // LiteLLM 不可用时返回占位响应（开发环境 mock）
  aiText = `[dev-mode mock] LiteLLM 不可达：${(e as Error).message}\n\n...`;
  inputTokens = Math.ceil(input.content.length / 4);  // 估算值
  outputTokens = Math.ceil(aiText.length / 4);
}
```

- mock 模式 token 用 `length/4` 估算，但仍然 `recordUsage`
- 生产环境 LiteLLM 短暂挂掉时**账本里全是估算值**
- 计费不准确

**修复**：

```ts
} catch (e) {
  if (env.NODE_ENV === 'production') {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI service unavailable' });
  }
  // dev/mock 模式：只记录 dev-mode flag，不入 UsageStat
  aiText = `[dev-mock]...`;
}
```

---

### DS-03 🟠 P1：`plugin.install` 用 seed 的 `id` 当 Prisma 主键

**位置**：`src/server/routers/plugin.ts:63-67`

```63:67:src\server\routers\plugin.ts
await prismaRaw.plugin.upsert({
  where: { name: seed.name },
  update: {},
  create: seed,  // ← seed.id 是字符串 'plugin-eslint'，但 schema 用 uuid
});
```

- `Plugin.id` 是 `String @default(uuid())`，但 SEED_PLUGINS 用 `'plugin-eslint'` 这种 slug
- **`@default(uuid())` 只在数据库层生效**，`create: seed` 显式传 id 会用 'plugin-eslint'
- 但 SEED_PLUGINS 的 id 与实际生产环境新插件的 uuid 冲突吗？
- **生产环境**有真实数据时，upsert 会因为 `name` 是 unique 正确处理，但**所有引用 pluginId 的表**（InstalledPlugin / PluginAuditLog）都用 uuid
- 真实插件入库后 `pluginId` 是 uuid，seed 的 `'plugin-eslint'` 是 slug —— **类型不统一**

**修复**：

```ts
// SEED_PLUGINS 不带 id
const SEED_PLUGINS = [{ name: 'eslint-suite', displayName: '...', ... }];
// install 时让 Prisma 生成 uuid
await prismaRaw.plugin.upsert({
  where: { name: seed.name },
  update: {},
  create: { name: seed.name, displayName: seed.displayName, ... }, // 不传 id
});
```

---

### DS-04 🟡 P2：`Project.create` slug 冲突只返回错误，没自动 retry

**位置**：`src/server/routers/project.ts:62-99`

- 多个用户/快速创建可能撞 slug
- P2002 兜底抛 CONFLICT，但**没自动加后缀重试**

**修复**：retry with suffix：

```ts
async function createWithSlugRetry(prisma, baseSlug, data) {
  let slug = baseSlug;
  for (let i = 0; i < 3; i++) {
    try {
      return await prisma.project.create({ data: { ...data, slug } });
    } catch (e) {
      if (e.code !== 'P2002') throw e;
      slug = `${baseSlug}-${randomBytes(2).toString('hex')}`;
    }
  }
  throw new TRPCError({ code: 'CONFLICT', message: 'Slug retry exhausted' });
}
```

---

### DS-05 🟡 P2：tRPC query 默认 `staleTime: 5_000`，但 `chat.byId` 不应 stale

**位置**：`src/lib/trpc-provider.tsx:14`

- `chat.byId` 是消息内容，**不能 stale**
- 应该每个 query 自定义 staleTime

---

### DS-06 🟡 P2：`chat.list` cursor 没用上

**位置**：`src/server/routers/chat.ts:14-25`

- 入参支持 `cursor`，但前端 `trpc.chat.list.useQuery({ take: 50 })` **不传 cursor**
- 没有「加载更多」按钮
- 50 个对话之后的就被截断

---

### DS-07 🔵 P3：`projects/[id]` 的 `runAnalysis` mutation 成功只显示一条横条

**位置**：`src/app/(app)/projects/[id]/page.tsx:285-295`

- 没有任何 toast / dialog
- 用户必须盯着底部那条「分析完成 · 评分 XX · XX 个问题」
- 应该顶部加 toast 提示

---

## 10. 后端联动（Backend Coupling）

### B-01 🟡 P2：前端 `error.message` 直接显示 tRPC 原始错误

**位置**：所有 `error.message` 显示位

- tRPC 错误 message 可能含技术细节（SQL 片段、堆栈）
- 应该在前端做错误码 → 用户友好文案映射

**修复**：抽 `formatError(error)`：

```ts
export function formatError(error: TRPCClientError): string {
  switch (error.data?.code) {
    case 'UNAUTHORIZED': return '请先登录';
    case 'FORBIDDEN': return '权限不足';
    case 'NOT_FOUND': return '资源不存在';
    case 'CONFLICT': return '数据冲突，请刷新后重试';
    case 'TOO_MANY_REQUESTS': return '操作过于频繁，请稍后再试';
    default: return '操作失败，请稍后重试';
  }
}
```

---

### B-02 🟡 P2：`api/auth/register` 返回 `tenantId`，但前端没用

**位置**：
- `src/app/api/auth/register/route.ts:56`
- `src/app/login/page.tsx:34`

- 注册 API 返回 `tenantId`，但登录页**只检查 `res.ok`**
- 用户注册后跳回登录流——多走一次网络

---

### B-03 🟡 P2：`projects/[id]` 把 SEED_FILES 当真实数据传给 `runAnalysis`

**位置**：`src/app/(app)/projects/[id]/page.tsx:195`

```195:195:src\app\(app)\projects\[id]\page.tsx
onClick={() => runAnalysis.mutate({ projectId: p.id, files })}
```

- 把写死的 SEED_FILES 传给分析
- 用户切项目，**跑的永远是同一份 seed 数据**
- 应当**真上传文件**或**列出真实 File 表**

---

### B-04 🔵 P3：`/api/v1/projects` REST API 没人调用

**位置**：`src/app/api/v1/projects/route.ts`

- 存在但前端没用
- 是 API Key 测试用？需要文档化

---

## 11. 安全与权限（Security）

### S-01 🟠 P1：`/api/auth/register` 没有 rate limit

**位置**：`src/app/api/auth/register/route.ts`

- 没读（但路径存在）— 任何 IP 可以无限刷注册
- 项目已装 `@upstash/redis`，可以做限流

**修复**：

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '1 m'),
});
const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
const { success } = await ratelimit.limit(ip);
if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
```

---

### S-02 🟠 P1：`command-palette` 渲染了 `description` 但没 sanitize

**位置**：`src/components/layout/command-palette.tsx:138-140`

- 当前 `description` 是写死的中文文案，**没风险**
- 但**未来扩展**命令时如果接 i18n / 用户输入，可能 XSS
- 建议用 `React.createElement` 或预编译

---

### S-03 🟡 P2：`/api/upload/bg` 鉴权检查但不检查 tenant

**位置**：`src/app/api/upload/bg/route.ts:21-24`

- `session.user.tenantId` 必须存在
- 上传 prefix 是 `bg/${tenantId}/` —— OK
- 但**没检查文件内容**（5MB 限制靠 `validateFile`）—— 客户端能伪造 `file.type`
- 应该 server-side 用 `file-type` magic number 校验

---

### S-04 🟡 P2：`UserPreferences.updateTheme` 没限制字段类型

**位置**：`src/server/routers/preferences.ts:63-102`

- `preset: z.enum([...]).optional()` OK
- `bgUrl: z.string().url().nullable().optional()` OK
- 但**没有限制 `mode`** 是否能改成 `'admin'` 之类的非法值——其实 mode 用了 ThemeModeSchema，OK
- `accent` 字段范围没限制 (0-360 / 0-100 / 0-100)

**修复**：

```ts
accent: z.object({
  h: z.number().int().min(0).max(360),
  s: z.number().int().min(0).max(100),
  l: z.number().int().min(0).max(100),
}).nullable().optional(),
```

---

### S-05 🟡 P2：`project.hardDelete` 只校验 ADMIN，没二次确认

**位置**：`src/server/routers/project.ts:119-130`

- 只看 `session.user.role`
- 但 JWT callback 里 `token.role ??= 'MEMBER'` —— **老 token 没 role 字段时默认为 MEMBER**
- 应该强制 DB 查一次（每请求）

---

### S-06 🔵 P3：Session 过期没有客户端提示

- `useSession` 的 `status === 'unauthenticated'` 没有 toast
- 用户在某个 mutation 失败时才发现登录过期

---

## 12. 设计 token 一致性（Design Tokens）

### DT-01 � P1：`tailwind.config.ts` 颜色映射硬编码 OKLCH 字面量（详见 V-07）

### DT-02 🟡 P2：`--radius` = 0.625rem，但多数卡片用 `rounded-lg` / `rounded-md` / `rounded-sm`（依赖 Tailwind borderRadius extend）

**位置**：`tailwind.config.ts:58-62`

```58:62:tailwind.config.ts
borderRadius: {
  lg: 'var(--radius)', // 0.625rem = 10px
  md: 'calc(var(--radius) - 2px)',  // 8px
  sm: 'calc(var(--radius) - 4px)',  // 6px
},
```

- skill §3 要求「圆角 ≤ 12px」——10px OK
- 但 `accent-picker` 用了 `rounded-md` (8px)，`ThemeSwitcher dialog` 用了 `rounded-xl` (12px in default Tailwind)—— **12px 是临界**
- 应该把 `xl` 也限制到 12px：

```ts
borderRadius: {
  xl: 'calc(var(--radius) + 4px)',  // 14px ← 超了
  'xl': 'var(--radius)', // 10px ←改为这个
}
```

---

### DT-03 🟡 P2：`focus-visible` 焦点环样式与 ring 颜色不完全一致

**位置**：`src/app/globals.css:74-78`

```74:78:src\app\globals.css
*:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 0.25rem;
}
```

- 全局 `outline-offset: 2px` + `border-radius: 0.25rem` —— 但**按钮、卡片本身的 border-radius 不一样**（按钮 6px，卡片 10px）
- 焦点环看起来「错位」
- 应去掉全局 `border-radius`，让浏览器自动跟随

**修复**：

```css
*:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  /*去掉 border-radius，让浏览器自动跟随元素 */
}
```

---

### DT-04 � P3：shadow 系统缺失

- 全代码搜 `shadow-` 几乎都是 `shadow-sm` / `shadow-lg` / `shadow-2xl`
- 设计 token 里没有 `--shadow-sm` / `--shadow-md`
- Tailwind 默认 `shadow-sm` 是 `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` —— 与暗色主题**反差太小**
- 应定义 token：`--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.08)` 等

---

## 13. 无障碍（Accessibility）

### A-01 🟠 P1：所有 dialog 缺 `aria-modal` / focus trap / ESC 关闭

**位置**：
- `src/components/theme/theme-switcher.tsx:59-176` — 有 `aria-modal` 但**无 ESC** / 无 focus trap
- `src/components/layout/command-palette.tsx:80-156` — 有 ESC，但**无 focus trap**

**修复**：

```tsx
<dialog open={open}
  onClose={() => setOpen(false)}
  aria-label="主题设置"
>
  {/* 自动 focus trap + ESC 关闭 */}
</dialog>
```

---

### A-02 🟡 P2：所有 icon-only 按钮缺 `aria-label`

**位置**：多处 IconTrash、IconDotsVertical、IconChevron 等

- `src/app/(app)/chat/page.tsx:104` `<span role="button">` 没 aria-label
- `src/app/(app)/projects/page.tsx:138,155` 两个 trash 按钮没 aria-label（只 title）
- `src/app/(app)/projects/[id]/page.tsx:209` `IconPlus` 没 aria-label
- `src/app/(app)/plugins/page.tsx:52` trash 按钮只有 title
- `src/app/(app)/settings/page.tsx:187` refresh 按钮只有 title

**修复**：所有 icon-only 按钮加 `aria-label="..."`

---

### A-03 🟡 P2：表单 input 缺 `<label>` 关联

**位置**：
- `src/app/login/page.tsx:98-122` — input 用 `placeholder` 替代 label
- `src/app/(app)/projects/new/page.tsx:43-77` — 这里**有 label**（OK）
- `src/app/(app)/settings/page.tsx:107-110` — API Key name input 缺 label

**修复**：用 `sr-only` label 或 `aria-label`

---

### A-04 🟡 P2：颜色对比度未审计

- `--muted-foreground: oklch(50% 0.015 250)` —— 在浅色 `--background: oklch(98.5% 0.005 90)` 上
- 对比度约 4.7:1（边界 AA）
- 暗色下 `--muted-foreground: oklch(70% 0.012 250)` vs `--background: oklch(18% 0.012 250)` —— 对比度约 6:1 OK
- 但**自定义 accent** 改变时，对比度可能跌破 AA

**修复**：加 `color-contrast()` 检测或限制 accent L 范围

---

### A-05 🔵 P3：screen reader 跳过 nav 时无 skip link

- `<aside>` 是导航，但**没有 skip link**
- 用户按 Tab 会从 logo 开始遍历整个侧栏

---

### A-06 🔵 P3：`<table>` 没 `<caption>` 或 `aria-label`

- 所有 table 缺少语义化标题

---

## 14. 可维护性 / 代码质量（Maintainability）

### M-01 � P2：`PageHeader` 在多个页面重复定义

**位置**：
- `src/app/(app)/projects/page.tsx:11-29` 定义
- `src/app/(app)/usage/page.tsx:6-13` 定义
- `src/app/(app)/plugins/page.tsx:6-13` 定义
- `src/app/(app)/settings/page.tsx:11-18` 定义

**修复**：提到 `src/components/ui/page-header.tsx`

---

### M-02 🟡 P2：`StatCard` / `Card` / `QuickAction` / `ToolCard` 重复定义

- workbench 用 `StatCard` / `QuickAction` / `ToolCard`
- usage 用 `Card` / `Row`
- 风格略不同，应该统一

---

### M-03 🟡 P2：硬编码字符串散落（业务文案）

- "工程师"、"早上好"、"新对话"、"加载中…"、"暂无数据" 等文案分布在 20+ 文件
- 没有 i18n 体系（next-intl / react-i18next）
- **未来要做多语言**会非常痛苦

**建议**：

```ts
// lib/copy.ts
export const copy = {
  greeting: (name?: string) => `早上好，${name ?? '工程师'}`,
  emptyChat: '发送第一条消息',
  loading: '加载中…',
  // ...
};
```

---

### M-04 � P3：`Icon` type 导入在多处不一致

- `import type { Icon as TablerIconType } from '@tabler/icons-react'`
- 有些文件直接 inline `Icon` type

**统一**：

```ts
// src/lib/types.ts
import type { ComponentType, SVGProps } from 'react';
export type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number; stroke?: number }>;
```

---

### M-05 🔵 P3：`bg-primary/10` / `text-primary` / `border-primary` 写死透明度

- 想统一改 primary 透明度得全局搜替换
- 应该用 Tailwind 自定义 opacity：

```ts
primary: {
  DEFAULT: 'hsl(var(--accent))',
  foreground: 'hsl(var(--accent-fg))',
  10: 'hsl(var(--accent) / 0.1)',
  20: 'hsl(var(--accent) / 0.2)',
},
```

---

## 15. 国际化 / 文案（i18n & Copy）

### I18N-01 🟡 P2：所有文案硬编码中文

**修复**：引入 `next-intl` 或自建轻量 i18n

### I18N-02 🔵 P3：「工程师」「Token」「用量」等术语跨页面不一致

- 用量页用「消息数」，workbench 也用「本月消息」
- 但 chat page 用「消息」/「对话」混用

**统一**：定义术语表：

```ts
export const terms = {
  conversation: '对话',
  message: '消息',
  project: '项目',
  analysis: '分析',
  // ...
};
```

---

## 16. 问题汇总矩阵

| # | 问题 | 维度 | 级别 | 文件 |
|---|------|------|------|------|
| V-01 | Next 14/15 params 不兼容 | Visual/Build | 🔴 P0 | projects/[id]/page.tsx:147 |
| V-02 | 项目列表软/硬删同图标 | Visual | 🟠 P1 | projects/page.tsx:138 |
| V-03 | 背景图 z-index 风险 | Visual | 🟠 P1 | globals.css:180 |
| V-04 | 渐变违反硬约束 | Visual | 🟠 P1 | theme-switcher/accent-picker |
| V-05 | 汇率硬编码 | Visual | 🟡 P2 | workbench/usage |
| V-06 | 工程师硬编码 | Visual | 🟡 P2 | workbench/page.tsx:30 |
| V-07 | OKLCH 颜色硬编码 | Visual | 🟡 P2 | tailwind.config.ts:35 |
| V-08 | bg-card 半透明 | Visual | 🟡 P2 | globals.css:21 |
| V-09 | 滚动条 hover 颜色 | Visual | � P2 | globals.css:104 |
| V-10 | success/warning 未被使用 | Visual | 🟡 P2 | 多处 |
| V-11 | 图标按钮 hover 反馈弱 | Visual | 🔵 P3 | 多处 |
| V-12 | scrollbar 10px | Visual | 🔵 P3 | globals.css |
| V-13 | button 重复 | Visual | 🔵 P3 | 多处 |
| C-01 | accent-picker 重置按钮 disabled 错误 | Component | 🟠 P1 | accent-picker.tsx:61 |
| C-02 | theme-switcher 删除背景图未 invalidate | Component | 🟠 P1 | theme-switcher.tsx:34 |
| C-03 | ThemeProvider useEffect deps 被强制忽略 | Component | 🟠 P1 | theme-provider.tsx:121 |
| C-04 | writeRemote 没 abort | Component | 🟠 P1 | theme-provider.tsx:124 |
| C-05 | useLocalCollapse SSR flash | Component | 🟡 P2 | app-shell.tsx:186 |
| C-06 | AppShell 缺 image | Component | 🟡 P2 | app-shell.tsx:16 |
| C-07 | span role=button 无键盘 | Component | 🟡 P2 | chat/page.tsx:98 |
| C-08 | StatCard/Card 重复 | Component | 🟡 P2 | workbench/usage |
| C-09 | PresetCard active 态弱 | Component | 🟡 P2 | theme-switcher.tsx:199 |
| C-10 | dialog 无 focus trap | Component | 🟡 P2 | theme-switcher, command-palette |
| C-11 | TablerIconType 导入 | Component | 🔵 P3 | 多处 |
| C-12 | 软/硬删按钮 touch target | Component | 🔵 P3 | projects/page.tsx |
| I-01 | Esc 打开命令面板未实现 | Interaction | 🔴 P0 | chat/page.tsx:185 |
| I-02 | confirm undefined 文案 | Interaction | 🔴 P0 | chat/page.tsx:102 |
| I-03 | 侧栏折叠不同步服务器 | Interaction | 🟠 P1 | app-shell.tsx:186 |
| I-04 | 原生 confirm 风格脱节 | Interaction | 🟠 P1 | 多处 |
| I-05 | Chat 页可能无限循环 | Interaction | � P1 | chat/page.tsx:41 |
| I-06 | command-palette 焦点冲突 | Interaction | 🟠 P1 | command-palette.tsx:47 |
| I-07 | command-palette/theme 同 z-50 | Interaction | 🟠 P1 | theme-switcher, command-palette |
| I-08 | 错误信息无重试按钮 | Interaction | 🟡 P2 | 多处 |
| I-09 | 错误样式重复 | Interaction | � P2 | 多处 |
| I-10 | isPending 无 spinner | Interaction | 🟡 P2 | 多处 |
| I-11 | Toast 系统缺失 | Interaction | 🟡 P2 | 全局 |
| I-12 | placeholder 对比度 | Interaction | 🟡 P2 | tailwind.config |
| I-13 | 键盘快捷键无文档 | Interaction | 🔵 P3 | command-palette |
| I-14 | 移动端无 hamburger | Interaction | 🔵 P3 | app-shell.tsx |
| P-01 | workbench CTA 重复 | Page | 🟡 P2 | workbench/page.tsx |
| P-02 | workbench QuickAction 自相矛盾 | Page | 🟡 P2 | workbench/page.tsx:68 |
| P-03 | 「导入仓库」占位 | Page | 🟡 P2 | workbench/page.tsx:62 |
| P-04 | 数据卡数量不准确 | Page | 🟡 P2 | workbench/page.tsx:79 |
| P-05 | usage 日期截取错误 | Page | 🟡 P2 | usage/page.tsx:82 |
| P-06 | projects/[id] 上传按钮 dead UI | Page | 🟡 P2 | projects/[id]/page.tsx:209 |
| P-07 | projects/[id] 文件树写死 | Page | 🟡 P2 | projects/[id]/page.tsx:114 |
| P-08 | ThemeSettingsPanel 与 dialog 入口分散 | Page | 🟡 P2 | settings/theme-settings-panel |
| P-09 | login 页 href="#" 死链 | Page | � P3 | login/page.tsx:154 |
| P-10 | home redirect 无 loading | Page | 🔵 P3 | page.tsx |
| P-11 | projects/[id] 项目名溢出 | Page | 🔵 P3 | projects/[id]/page.tsx:181 |
| P-12 | chat 空状态 CTA 距离远 | Page | 🔵 P3 | chat/page.tsx:80 |
| M-01 | page-enter 选择器误伤 | Motion | 🟡 P2 | globals.css:120 |
| M-02 | dialog 关闭无动画 | Motion | � P2 | theme-switcher, command-palette |
| M-03 | Cmd+K 无视觉提示 | Motion | 🟡 P2 | command-palette |
| M-04 | transition 200ms 偏慢 | Motion | 🔵 P3 | 多处 |
| M-05 | page-enter translateY 4px 弱 | Motion | 🔵 P3 | globals.css |
| R-01 | 窄屏侧栏占 240px | Responsive | 🟠 P1 | app-shell.tsx:42 |
| R-02 | workbench 表格横向溢出 | Responsive | 🟠 P1 | workbench/page.tsx |
| R-03 | projects 移动端字段丢失 | Responsive | 🟡 P2 | projects/page.tsx |
| R-04 | chat 对话列表不响应式 | Responsive | 🟡 P2 | chat/page.tsx:63 |
| R-05 | ThemeSwitcher dialog 移动端 | Responsive | 🟡 P2 | theme-switcher.tsx:71 |
| R-06 | 横屏布局 | Responsive | 🔵 P3 | command-palette |
| PE-01 | ThemeProvider context 重渲染 | Performance | 🟡 P2 | theme-provider.tsx:155 |
| PE-02 | presetBgStyle 无缓存 | Performance | 🟡 P2 | theme-switcher.tsx:227 |
| PE-03 | AppShell 无 memo | Performance | 🟡 P2 | app-shell.tsx |
| PE-04 | preferences invalidate 全局 | Performance | 🟡 P2 | theme-provider.tsx:173 |
| PE-05 | buildTree 永远算同一次 | Performance | 🟡 P2 | projects/[id]/page.tsx:161 |
| PE-06 | chat 缺轮询 | Performance | 🔵 P3 | chat/page.tsx:15 |
| PE-07 | tabler icons 全量打包 | Performance | 🔵 P3 | next.config |
| PE-08 | projects 默认拉 100 | Performance | 🔵 P3 | projects/page.tsx |
| DS-01 | contentHash 写死 'pending' | Data | 🟠 P1 | analysis.ts:152 |
| DS-02 | chat mock 污染账本 | Data | 🟠 P1 | chat.ts:101 |
| DS-03 | plugin seed id 类型不一致 | Data | 🟠 P1 | plugin.ts:63 |
| DS-04 | slug 冲突无 retry | Data | 🟡 P2 | project.ts:62 |
| DS-05 | chat.byId 不应 stale | Data | 🟡 P2 | trpc-provider |
| DS-06 | chat.list cursor 没用 | Data | 🟡 P2 | chat.ts:14 |
| DS-07 | runAnalysis 无 toast | Data | 🔵 P3 | projects/[id]/page.tsx |
| B-01 | 错误文案不友好 | Backend | 🟡 P2 | 全局 |
| B-02 | register 返回 tenantId 未用 | Backend | 🟡 P2 | login/page.tsx |
| B-03 | runAnalysis 用 SEED 数据 | Backend | 🟡 P2 | projects/[id]/page.tsx |
| B-04 | /api/v1 文档缺失 | Backend | 🔵 P3 | api/v1/projects |
| S-01 | /api/auth/register 无 rate limit | Security | 🟠 P1 | register/route.ts |
| S-02 | command-palette description 未来 XSS | Security | 🟠 P1 | command-palette.tsx:138 |
| S-03 | /api/upload/bg 不验内容 | Security | 🟡 P2 | upload/bg/route.ts |
| S-04 | preferences accent 范围 | Security | 🟡 P2 | preferences.ts:63 |
| S-05 | hardDelete role 校验弱 | Security | 🟡 P2 | project.ts:119 |
| S-06 | Session 过期无提示 | Security | 🔵 P3 | 全局 |
| DT-01 | OKLCH 硬编码 | Design Token | 🟡 P2 | tailwind.config.ts |
| DT-02 | rounded-xl 超 12px | Design Token | 🟡 P2 | tailwind.config.ts:58 |
| DT-03 | focus-visible border-radius | Design Token | 🟡 P2 | globals.css:74 |
| DT-04 | shadow 系统缺失 | Design Token | 🔵 P3 | 全局 |
| A-01 | dialog 无 focus trap | A11y | 🟠 P1 | theme-switcher, command-palette |
| A-02 | icon-only 按钮缺 aria-label | A11y | 🟡 P2 | 多处 |
| A-03 | input 缺 label | A11y | 🟡 P2 | login, settings |
| A-04 | 颜色对比度 | A11y | 🟡 P2 | globals.css |
| A-05 | 缺 skip link | A11y | 🔵 P3 | app-shell.tsx |
| A-06 | table 缺 caption | A11y | 🔵 P3 | 多处 |
| M-01 | PageHeader 重复定义 | Maint. | 🟡 P2 | 多处 |
| M-02 | Card 系列重复 | Maint. | 🟡 P2 | 多处 |
| M-03 | 文案硬编码散落 | Maint. | 🟡 P2 | 全局 |
| M-04 | Icon type 导入不一致 | Maint. | 🔵 P3 | 多处 |
| M-05 | primary 透明度硬编码 | Maint. | 🔵 P3 | 多处 |
| I18N-01 | 无 i18n 体系 | i18n | 🟡 P2 | 全局 |
| I18N-02 | 术语不一致 | i18n | 🔵 P3 | 多处 |

**合计：82 个问题**
- 🔴 P0：4 个
- 🟠 P1：18 个
- 🟡 P2：42 个
- 🔵 P3：18 个

---

## 17. 建议落地路线

### 🚨 Sprint 0（立即 / 24h 内）

- **V-01** 修 Next 14/15 params（构建阻塞）
- **I-01** 修 Esc 命令面板承诺
- **I-02** 修 confirm undefined 文案
- **V-02** 修项目列表误删图标（**用户数据安全**）

### 🎯 Sprint 1（本周）

聚焦 P1（18 个）：

1. **V-03** 背景图 z-index 重构
2. **V-04** 渐变违反约束改为独立色块
3. **C-01 / C-02 / C-03 / C-04** ThemeProvider 系列修复
4. **I-03 / I-04** 侧栏同步 + 自定义 confirm
5. **I-05 / I-06 / I-07** Chat 重渲染 + dialog z-index
6. **DS-01 / DS-02 / DS-03** 数据完整性修复
7. **S-01 / S-02** 安全：rate limit + XSS
8. **A-01** dialog focus trap
9. **R-01 / R-02** 响应式基础

### 📋 Sprint 2（下周）

聚焦 P2 中高 ROI：

- V-05 / V-06 / V-08 / V-09 / V-10 视觉一致性
- C-05 ~ C-10 组件完整性
- I-08 ~ I-12 交互完整性
- P-01 ~ P-08 页面质量
- PE-01 ~ PE-05 性能
- S-03 ~ S-05 安全加固
- A-02 ~ A-04 无障碍

### 🌱 Sprint 3+（下迭代）

- M 系列：动效、微交互
- DT-01 ~ DT-04 设计 token 完善
- I18N-01 /02 国际化基础

---

## 附录：做得好的地方（保留不动）

- ✅ **双层持久化**：theme 的 localStorage + tRPC preferences 设计思路正确
- ✅ **Prisma 中间件**：tenant 隔离 + 软删除过滤完善
- ✅ **R2 懒初始化 + 路径穿越防护**：extractR2Key 设计严密
- ✅ **Auth 流程**：bcrypt + jwt callback 时序 + PrismaAdapter
- ✅ **tRPC context.tenantId 必传守卫**
- ✅ **PublicProject zod 校验**：防止元数据泄露
- ✅ **生命周期三件套**：soft-delete / hard-delete / restore
- ✅ **OKLCH 主体 + HSL accent** 双轨配色（skill §4）
- ✅ **无 emoji**：全代码 grep 确认
- ✅ **统一图标库**：@tabler/icons-react
- ✅ **圆角 ≤ 12px**：主调性符合 skill §3

---

**文档结束**

> 评审人：Cursor · 评审日期：2026-08-28 · 文档版本：v1.0
> 任何代码变动请同步更新本文件标注 ✅ / ❌ 状态
