# Eval 3: theme-system-r2-background

## 任务背景

单独抽离换肤系统。需求：

- 6 套预设主题可一键切换：paper / ink / mint / lavender / amber / ocean
- DIY 强调色 HSL 三滑块：H(0-360) / S(0-100%) / L(40-80%)
- 背景图上传到 R2 永久存储（≤ 5MB 原图客户端压到 ≤ 500KB / 1920×1080）
- 配色用 OKLCH，浅色奶白不要纯白，暗色深蓝灰不要纯黑
- 所有偏好持久化到 UserPreferences 表（userId unique）
- 加载时优先用服务端数据回填 ThemeProvider

## 期望产出

### 数据库
`prisma/schema.prisma` 新增 `UserPreferences` 模型：

```prisma
model UserPreferences {
  userId       String   @id
  themePreset  String   @default("paper")  // paper | ink | mint | lavender | amber | ocean
  accentHsl    String?  // "65 75% 55%"
  bgUrl        String?
  bgUpdatedAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

### tRPC
`src/server/routers/preferences.ts` 暴露：
- `get` — 返回当前用户偏好
- `update` — 更新 preset / accent
- `uploadBg` — multipart 接文件 → R2 → 写 bgUrl
- `removeBg` — 清空 bgUrl

### API
`src/app/api/upload/bg/route.ts` Next.js Route Handler 接 multipart，调 R2，复用现有 `S3Client` 与 `extractR2Key`。

### 组件
5 个新增组件位于 `src/components/theme/`：
- `themes.ts` — 6 套预设定义
- `theme-provider.tsx` — 改写 Context（preset / accent / bgUrl）
- `theme-switcher.tsx` — 弹窗（预设网格 + DIY + 背景图）
- `accent-picker.tsx` — HSL 三滑块
- `background-uploader.tsx` — 上传 + 客户端压缩（用 canvas resize + toBlob）

### 同步脚本
在 `src/app/layout.tsx` 的 `<head>` 内联同步脚本，从 localStorage 读 `{preset, accent, bgUrl}` 写到 `<html>` className + CSS 变量，避免 FOUC。

## 关键验收点

- [ ] UserPreferences 模型已加并 migrate
- [ ] tRPC 4 个端点可用
- [ ] R2 上传走 Next Route Handler（不直接走 tRPC，避免 multipart 处理复杂化）
- [ ] 客户端压缩逻辑用 canvas（不引第三方）
- [ ] 6 套预设可切换（用 OKLCH 验证色值）
- [ ] DIY 强调色实时生效
- [ ] 背景图上传 → R2 → 写库 → 整站背景生效
- [ ] 移除背景图可恢复默认
- [ ] 刷新后所有偏好保留
- [ ] 首屏无 FOUC

## 失败信号

- 用 HSL 而非 OKLCH 写主题色 → 失败
- 浅色用 `#ffffff` → 失败
- 暗色用 `#000000` → 失败
- 跳过 Prisma migrate → 失败
- 第三方图片压缩库（不是 canvas） → 失败
- FOUC 闪烁没解决 → 失败
- tRPC 直接处理 multipart（不走 Route Handler） → 失败