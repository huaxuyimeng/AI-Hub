import { chromium, FullConfig } from '@playwright/test';
import path from 'path';

/**
 * 全局 Setup：创建已登录的 storageState
 *
 * 流程：
 *   1. 启动无头 Chromium
 *   2. 访问登录页
 *   3. 填写测试账号（环境变量 PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD）
 *   4. 点击登录，等待导航到首页
 *   5. 保存 storageState 到 e2e/.auth/storage-state.json
 *   6. 后续所有 test() 自动复用该状态（无需重复登录）
 *
 * 环境变量：
 *   PLAYWRIGHT_BASE_URL        — 目标地址（默认 http://localhost:3000）
 *   PLAYWRIGHT_TEST_EMAIL       — 测试账号邮箱（必填）
 *   PLAYWRIGHT_TEST_PASSWORD    — 测试账号密码（必填）
 *
 * 注意：若账号开启了 NextAuth 2FA（TOTP），需要手动在 globalSetup
 *       填入 TOTP 验证码；建议 E2E 测试用无 2FA 的专用测试账号。
 */

const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'storage-state.json');

export default async function globalSetup(_config: FullConfig) {
  const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
  const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
  const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  if (!EMAIL || !PASSWORD) {
    console.warn(
      '[Playwright] 未配置 PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD，' +
      'E2E 测试将跳过全局登录（部分需要认证的测试会被 skip）'
    );
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`[Playwright] 登录测试账号: ${EMAIL} → ${BASE_URL}`);

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

    // 查找邮箱/密码输入框（兼容不同 label 写法）
    const emailInput = page.getByLabel(/邮箱|Email/i).first();
    const passwordInput = page.getByLabel(/密码|Password/i).first();
    const submitBtn = page.getByRole('button', { name: /登录|Sign in|登录/i }).first();

    await emailInput.fill(EMAIL);
    await passwordInput.fill(PASSWORD);
    await submitBtn.click();

    // 等待登录成功跳转（URL 不再含 /login）
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 30_000,
    });

    console.log(`[Playwright] 登录成功，当前 URL: ${page.url()}`);

    // 保存认证状态（跨测试复用，无需重复登录）
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log(`[Playwright] 认证状态已保存至: ${STORAGE_STATE_PATH}`);

  } catch (err) {
    console.error('[Playwright] 全局登录失败:', err);
    await page.screenshot({ path: path.join(__dirname, 'login-failure.png') }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}
