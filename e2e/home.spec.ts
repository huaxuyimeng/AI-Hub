import { test, expect } from '@playwright/test';

/**
 * 首页 / 工作台 E2E 测试
 *
 * 测试场景：
 *   1. 首页正常加载
 *   2. 侧边栏正常显示
 *   3. 新闻模块加载（或空状态）
 */

test.describe('首页（/）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    // 等待至少一个主内容区出现
    await page.waitForLoadState('networkidle');

    const criticalErrors = errors.filter(e => !e.includes('[warn]') && !e.includes('Warning'));
    expect(criticalErrors).toHaveLength(0);
  });

  test('侧边栏存在', async ({ page }) => {
    await page.goto('/');
    // 侧边栏（包含导航链接）应该存在
    const sidebar = page.locator('nav, aside, [class*="sidebar" i]').first();
    await expect(sidebar).toBeVisible();
  });
});
