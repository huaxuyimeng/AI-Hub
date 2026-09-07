# theme.md · theme 模块设计

> 创建于 2026-09-07
> 配套：[`00-design.md`](../00-design.md)（UI 现状档案） + [`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.11

---

## 1. 一句话职责

主题切换 / 强调色 / 渐变色板 / 背景图上传——`/settings` 主题面板 + 全局 Provider。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/themes.ts` | ~200 | 主题 token + 类型 |
| `src/lib/palettes/gradient-palettes.ts` | ~120 | 渐变色板定义 |
| `src/components/theme-provider.tsx` | ~150 | ThemeProvider（SSR 安全） |
| `src/components/theme-toggle.tsx` | ~80 | 暗色切换 |
| `src/components/theme/theme-switcher.tsx` | ~200 | 预设主题切换器 |
| `src/components/theme/accent-picker.tsx` | ~150 | HSL 强调色 DIY |
| `src/components/theme/gradient-palette-picker.tsx` | ~120 | 渐变色板选择 |
| `src/hooks/use-gradient-palette.ts` | ~50 | React Hook |

**合计**：~1070 行。

**关键约束**（来自 00-design.md §8）：

- 6 套预设主题 key 不可改（影响 localStorage 兼容性）
- 颜色必须用 CSS 变量
- 暗色适配：每个 token 必须 `:root` + `.dark` 双值
- 过渡 ≤ 200ms（FOUC 风险）

---

## 3. 目标包结构

```
packages/theme/
├── src/
│   ├── domain/
│   │   ├── themePreset.ts           # 6 套预设主题定义
│   │   ├── themeMode.ts             # 'light' | 'dark' | 'system'
│   │   └── accentHsl.ts             # HSL 三元组类型
│   ├── infra/
│   │   ├── storage.ts               # localStorage 读写
│   │   ├── remotePrefs.ts           # tRPC preferences.set 同步
│   │   └── cssVars.ts               # applyThemeVars() 写 document.documentElement.style
│   ├── interface/
│   │   ├── server/
│   │   │   └── trpcRouter.ts        # theme 相关 router（从 preferences 拆出）
│   │   └── ui/
│   │       ├── ThemeProvider.tsx
│   │       ├── ThemeToggle.tsx
│   │       ├── ThemeSwitcher.tsx
│   │       ├── AccentPicker.tsx
│   │       └── GradientPalettePicker.tsx
│   └── index.ts
├── tests/
│   └── applyThemeVars.spec.ts       # CSS 变量注入
├── package.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                  "./src/index.ts",
    "./interface/server": "./src/interface/server/trpcRouter.ts",
    "./interface/ui":     "./src/interface/ui/index.ts",
    "./palettes":         "./src/domain/palettes.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { ThemeProvider } from './interface/ui/ThemeProvider';
export { applyThemeVars } from './infra/cssVars';
export { THEME_PRESETS, type ThemePreset } from './domain/themePreset';
export { GRADIENT_PALETTES } from './domain/palettes';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/auth` | （可选）个性化偏好需登录态 |
| `@aihub/observability` | `logger`（主题切换异常） |

**禁止依赖**：

- ❌ 任何业务包（theme 是横切 UI 关注点）

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | `<ThemeProvider>` 在 `providers.tsx` 顶层挂载 |
| `apps/web` | 各页面使用 `useTheme()` hook（如有） |
| `settings`（独立包） | 主题面板 UI |

---

## 7. 边界规则

1. ✅ 6 套预设主题 key 不可改：`default` `lavender` `forest` `rose` `ocean` `slate`
2. ✅ 颜色必须 CSS 变量——**严禁**硬编码 `#xxx`
3. ✅ 暗色适配：每个 token 必须 `:root` + `.dark` 双值
4. ✅ 过渡 ≤ 200ms
5. ✅ localStorage key 用 `@aihub/theme` 前缀（避免与未来其他包冲突）
6. ⚠️ `applyThemeVars()` 在客户端 mount 时调用，SSR 期间用 fallback（`:root` 默认值）
7. ❌ 禁止在 theme 包内放业务 UI（仅"主题相关"组件）

---

## 8. 迁移步骤

```bash
# P4.1 第 4 周

mkdir -p packages/theme/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/theme/tests

# 1. domain 先迁（纯类型 + token 定义）
cp src/lib/themes.ts packages/theme/src/domain/themePreset.ts  # 拆分 preset / mode / accent
cp src/lib/palettes/gradient-palettes.ts packages/theme/src/domain/palettes.ts

# 2. infra
# applyThemeVars 抽到 infra/cssVars.ts（来自 theme-provider.tsx 内部）
# localStorage 读写抽到 infra/storage.ts

# 3. UI 组件
cp src/components/theme-provider.tsx packages/theme/src/interface/ui/ThemeProvider.tsx
cp src/components/theme-toggle.tsx packages/theme/src/interface/ui/ThemeToggle.tsx
cp src/components/theme/theme-switcher.tsx packages/theme/src/interface/ui/ThemeSwitcher.tsx
cp src/components/theme/accent-picker.tsx packages/theme/src/interface/ui/AccentPicker.tsx
cp src/components/theme/gradient-palette-picker.tsx packages/theme/src/interface/ui/GradientPalettePicker.tsx

# 4. 替换全局 import
# @/lib/themes → @aihub/theme
# @/lib/palettes/gradient-palettes → @aihub/theme/palettes
# @/components/theme-provider → @aihub/theme/interface/ui/ThemeProvider

pnpm --filter @aihub/theme typecheck
pnpm --filter @aihub/theme test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| 主题切换导致 FOUC | SSR fallback + `useLayoutEffect` 强制同步写入 |
| localStorage key 改了导致用户偏好丢失 | 保留旧 key（`StoredTheme` 等）的读路径，写入新 key |
| 渐变色板与未来主题切换冲突 | 提供 `gradientPaletteId` 独立字段，不与 themePreset 绑定 |
| HSL DIY 与预设主题冲突 | 优先级：themePreset > accentHsl > gradientPalette |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/theme typecheck` 通过
- [ ] `pnpm --filter @aihub/theme test` 通过
- [ ] 6 套预设主题切换无 FOUC
- [ ] 暗色 / 浅色 / system 三模式正常
- [ ] HSL DIY 强调色生效
- [ ] 渐变色板不影响主题切换
- [ ] 删除 `src/lib/themes.ts` 后主题仍工作

---

## 11. 过期条件

- 增加第 7 套预设主题（必须更新 `THEME_PRESETS`）
- 切换主题 token 格式（OKLCH → HSL / 反之）
- 引入新 UI 框架（影响 ThemeProvider 注入方式）
- 增加背景图 R2 转存功能

---

**创建时间**：2026-09-07
