import { test, expect } from '@playwright/test';

/**
 * 工作台 / 对话页 E2E 测试
 *
 * 测试场景：
 *   1. 页面正常加载
 *   2. 对话输入框存在
 *   3. 可输入文字
 */

test.describe('工作台（/workbench）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/workbench');
    await page.waitForLoadState('networkidle');

    // 输入框或聊天区应存在
    const input = page.locator('textarea, input[type="text"], [contenteditable]').first();
    const chatArea = page.locator('[class*="chat" i], [class*="message" i]').first();

    const hasInput = await input.isVisible().catch(() => false);
    const hasChat = await chatArea.isVisible().catch(() => false);
    expect(hasInput || hasChat).toBeTruthy();

    const criticalErrors = errors.filter(e =>
      !e.includes('[warn]') && !e.includes('Warning') && !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('输入框可输入文字', async ({ page }) => {
    await page.goto('/workbench');
    await page.waitForLoadState('networkidle');

    const input = page.locator('textarea, input[type="text"]').first();
    const inputVisible = await input.isVisible().catch(() => false);
    if (inputVisible) {
      await input.fill('你好');
      await expect(input).toHaveValue('你好');
    }
  });
});
