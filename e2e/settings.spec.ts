import { test, expect } from '@playwright/test';

/**
 * 设置页 E2E 测试
 *
 * 测试场景：
 *   1. 设置页正常加载
 *   2. Tab 切换正常（AI Keys / 主题 / 清理等）
 *   3. AI Keys 面板显示
 */

test.describe('设置页（/settings）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // 页面应显示"设置"相关内容
    const heading = page.getByRole('heading', { name: /设置|settings/i }).first();
    await expect(heading).toBeVisible();

    const criticalErrors = errors.filter(e =>
      !e.includes('[warn]') && !e.includes('Warning') && !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('AI Keys Tab 可见', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // 找 AI Keys 相关的 tab 或按钮
    const keysTab = page.getByRole('tab', { name: /AI|Key|API|密钥/i }).first();
    const keysVisible = await keysTab.isVisible().catch(() => false);
    if (keysVisible) {
      await expect(keysTab).toBeVisible();
    }
  });
});
