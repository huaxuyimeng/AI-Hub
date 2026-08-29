# Eval 1: full-build-from-zero

## 任务背景

用户在做一个多租户 AI 工作台项目，参考产品包括 GPT Work、DeepSeek Hermes、WorkBuddy、Trae Work、Qoder。要求：

- 不能用 emoji 当 UI 装饰
- 不能用简单单色渐变
- 主体白偏奶（不要纯白），暗色要舒服（不要纯黑）
- 一键换肤：6 套预设主题 + DIY 配色
- 背景图上传 → 永久存储 → 整站背景生效
- 布局参考 Cursor / ChatGPT，UI 参考那些 AI 工作台

## 期望产出

Skill 必须分两阶段执行：

### Phase 1（必须先做）
1. 读现有 `src/app/`、`src/components/`、`prisma/schema.prisma`、`globals.css`、`theme-provider.tsx`、`app-shell.tsx` 等关键文件
2. 输出完整设计报告，含：
   - 风格定义（工程师书房 / 奶白纸面 / 暗色书脊）
   - 配色系统（浅色 Paper / 暗色 Slate Brew / 6 套预设 / HSL DIY）
   - 布局骨架（三模式 + 左 240 + 顶 56）
   - 组件清单（标 [新] / [改] / [沿]）
   - 风险评估（冲突 / 配色舒适度 / 性能）
3. 用 AskQuestion 让用户回答 3 个决策点（背景图存储 / DIY 粒度 / 布局参考）

### Phase 2（用户确认后）
按 P0 → P1 → P2 → P3 → P4 实施。

## 关键验收点

- [ ] 设计报告含全部 5 个段落
- [ ] 3 个决策点必须由用户回答
- [ ] 全程无 emoji
- [ ] 全程无 `bg-gradient-to-*` 单色渐变
- [ ] 浅色用 OKLCH 验证非纯白
- [ ] 暗色用 OKLCH 验证非纯黑
- [ ] 圆角 ≤ 12px
- [ ] UserPreferences 模型加入并 migrate
- [ ] 6 套预设可切换并持久化
- [ ] 背景图可上传到 R2 并持久化

## 失败信号

- 直接动手写组件，没出设计报告 → 失败
- 跳过 AskQuestion 直接选默认 → 失败
- 用纯白 / 纯黑 → 失败
- 用 emoji 当装饰 → 失败
- 引入新图标库或字体库 → 失败