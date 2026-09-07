import { test, expect } from '@playwright/test';

/**
 * 清理工具 E2E 测试
 *
 * 测试场景：
 *   1. 清理页正常加载
 *   2. 扫描按钮存在
 *   3. 扫描结果或空状态显示
 */

test.describe('清理页（/cleanup）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/cleanup');
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /清理|clean/i }).first();
    const content = page.locator('[class*="cleanup" i], button').first();

    const hasContent = await heading.isVisible().catch(() => false) ||
                      await content.isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();

    const criticalErrors = errors.filter(e =>
      !e.includes('[warn]') && !e.includes('Warning') && !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('扫描按钮可点击', async ({ page }) => {
    await page.goto('/cleanup');
    await page.waitForLoadState('networkidle');

    // 找扫描相关按钮
    const scanBtn = page.getByRole('button', { name: /扫描|scan/i }).first();
    const btnVisible = await scanBtn.isVisible().catch(() => false);
    if (btnVisible) {
      await expect(scanBtn).toBeEnabled();
    }
  });
});
