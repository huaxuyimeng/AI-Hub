import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置
 *
 * 运行前准备：
 *   1. pnpm install
 *   2. pnpm playwright install chromium --with-deps
 *   3. 启动开发服务器：pnpm dev
 *
 * 运行测试：
 *   pnpm test:e2e          # 全部
 *   pnpm test:e2e:ui       # UI 模式（可视化）
 *   pnpm test:e2e:headed   # 有头模式（看浏览器）
 *   pnpm test:e2e:debug    # 调试模式
 *
 * 注意：需要先配置 .env.local 中的环境变量（参考 .env.example），
 *       否则部分功能（如排行刷新、新闻聚合）会失败。
 */

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html']] : [['html', { open: 'never' }]],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    // 默认超时（页面导航 / 点击 / 断言）
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  projects: [
    // Chromium（主要）
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile Safari（可选，移动端回归）
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],

  webServer: process.env.CI
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
