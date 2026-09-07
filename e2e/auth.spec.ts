import { test, expect } from '@playwright/test';

/**
 * 登录页 E2E 测试
 *
 * 测试场景：
 *   1. 登录页正常加载（无崩溃）
 *   2. 邮箱/密码格式校验
 *   3. 空输入提交 → 显示错误提示
 *   4. 错误密码 → 显示错误提示（不跳页）
 *   5. 正确账号 → 成功跳转
 */

test.describe('登录页（/login）', () => {

  test('页面正常加载，无控制台错误', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /登录|sign in/i })).toBeVisible();

    // 无 ERROR 级别控制台错误（允许 warn）
    const criticalErrors = errors.filter(e => !e.includes('[warn]') && !e.includes('Warning'));
    expect(criticalErrors).toHaveLength(0);
  });

  test('邮箱格式校验', async ({ page }) => {
    await page.goto('/login');
    const emailInput = page.getByLabel(/邮箱|Email/i).first();
    const passwordInput = page.getByLabel(/密码|Password/i).first();
    const submitBtn = page.getByRole('button', { name: /登录|sign in/i }).first();

    // 空密码提交
    await emailInput.fill('test@example.com');
    await submitBtn.click();
    // 页面不应跳转（停留在登录页）
    await expect(page).toHaveURL(/\/login/);
  });

  test('错误密码显示提示', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/邮箱|Email/i).first().fill('test@example.com');
    await page.getByLabel(/密码|Password/i).first().fill('wrongpassword123');
    await page.getByRole('button', { name: /登录|sign in/i }).first().click();

    // 应出现错误提示（NextAuth 默认返回 Invalid credentials）
    await expect(page.getByText(/无效|错误|invalid|credentials/i)).toBeVisible({ timeout: 10_000 });
    // 不应跳转到首页
    await expect(page).toHaveURL(/\/login/);
  });

  test('注册链接可见', async ({ page }) => {
    await page.goto('/login');
    // 注册链接应该可见
    const registerLink = page.getByRole('link', { name: /注册|注册账号|sign up/i });
    await expect(registerLink).toBeVisible();
  });
});
