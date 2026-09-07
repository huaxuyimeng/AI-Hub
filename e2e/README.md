# Playwright E2E 测试

## 快速开始

```bash
# 1. 安装 Chromium 浏览器
pnpm test:e2e:install

# 2. 配置环境变量（创建 .env.local 或直接在 shell 设）
#    PLAYWRIGHT_TEST_EMAIL=test@example.com
#    PLAYWRIGHT_TEST_PASSWORD=your-password
#    PLAYWRIGHT_BASE_URL=http://localhost:3000  # 默认

# 3. 启动开发服务器
pnpm dev
# （在另一个终端）

# 4. 运行测试
pnpm test:e2e          # 全部
pnpm test:e2e:headed   # 看浏览器
pnpm test:e2e:ui       # UI 模式（可视化）
pnpm test:e2e:debug    # 调试
```

## 测试覆盖

| 文件 | 页面 | 主要检查 |
|------|------|----------|
| `auth.spec.ts` | `/login` | 登录校验、错误提示、注册链接 |
| `home.spec.ts` | `/` | 首页加载、侧边栏 |
| `news.spec.ts` | `/news` | 新闻列表、分类筛选 |
| `rankings.spec.ts` | `/rankings` | 排行加载、模型指标 |
| `bilibili.spec.ts` | `/bilibili` | B站页面、UP主卡片 |
| `workbench.spec.ts` | `/workbench` | 工作台加载、输入框 |
| `settings.spec.ts` | `/settings` | 设置页、AI Keys Tab |
| `cleanup.spec.ts` | `/cleanup` | 清理页、扫描按钮 |
| `chat.spec.ts` | `/chat` | 对话页、新建按钮 |

## 认证流程

`globalSetup.ts` 在首次运行时：
1. 启动无头浏览器
2. 用 `PLAYWRIGHT_TEST_EMAIL` + `PLAYWRIGHT_TEST_PASSWORD` 登录
3. 将认证状态保存到 `e2e/.auth/storage-state.json`
4. 后续所有测试自动复用该状态（无需重复登录）

**建议**：创建专用测试账号（无 2FA），避免泄露真实密码。

## 注意事项

- 测试账号建议使用专用账号（非生产环境账号）
- 部分测试依赖真实数据（如新闻、排行），无数据时可能显示空状态
- CI 环境会自动启动 `pnpm dev`（见 `playwright.config.ts` `webServer` 配置）
