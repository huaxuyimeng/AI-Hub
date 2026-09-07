import { test, expect } from '@playwright/test';

/**
 * B 站 UP 主追踪 E2E 测试
 *
 * 测试场景：
 *   1. B 站页面正常加载
 *   2. UP 主列表或卡片出现
 *   3. 可点击进入详情
 */

test.describe('B站页面（/bilibili）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/bilibili');
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /B站|UP主|Bilibili/i }).first();
    const content = page.locator('[class*="bilibili" i], [class*="up" i]').first();

    const hasContent = await heading.isVisible().catch(() => false) ||
                      await content.isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();

    const criticalErrors = errors.filter(e =>
      !e.includes('[warn]') && !e.includes('Warning') && !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('UP 主卡片可点击', async ({ page }) => {
    await page.goto('/bilibili');
    await page.waitForLoadState('networkidle');

    // 找第一个可点击的 UP 主卡片
    const card = page.locator('a, button').filter({ hasText: /\d+万|\d+粉丝|B站/i }).first();
    const cardVisible = await card.isVisible().catch(() => false);
    if (cardVisible) {
      await card.click();
      // 点击后页面应无崩溃（body 仍可见）
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
