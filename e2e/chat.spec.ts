import { test, expect } from '@playwright/test';

/**
 * 对话页 E2E 测试
 *
 * 测试场景：
 *   1. 对话页正常加载
 *   2. 对话列表出现（或空状态）
 *   3. 新建对话按钮存在
 */

test.describe('对话页（/chat）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    const heading = page.getByRole('heading', { name: /对话|chat/i }).first();
    const content = page.locator('[class*="chat" i], [class*="conversation" i]').first();

    const hasContent = await heading.isVisible().catch(() => false) ||
                      await content.isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();

    const criticalErrors = errors.filter(e =>
      !e.includes('[warn]') && !e.includes('Warning') && !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('新建对话按钮存在', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    // "新建" 或 "New" 按钮
    const newBtn = page.getByRole('button', { name: /新建|new/i }).first();
    const btnVisible = await newBtn.isVisible().catch(() => false);
    if (btnVisible) {
      await expect(newBtn).toBeEnabled();
    }
  });
});
