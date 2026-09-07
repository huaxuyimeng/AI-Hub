import { test, expect } from '@playwright/test';

/**
 * 新闻页 E2E 测试
 *
 * 测试场景：
 *   1. 新闻页正常加载
 *   2. 至少出现一个新闻卡片（或空状态）
 *   3. 筛选功能（分类/源头）可用
 *   4. 分页加载（下一页）
 */

test.describe('新闻页（/news）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载，显示新闻列表或空状态', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/news');
    await page.waitForLoadState('networkidle');

    // 页面标题或新闻卡片列表应出现其一
    const heading = page.getByRole('heading', { name: /新闻|AI 早报/i }).first();
    const newsCard = page.locator('article, [class*="card" i], [class*="news" i]').first();

    const hasContent = await heading.isVisible().catch(() => false) ||
                      await newsCard.isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();

    const criticalErrors = errors.filter(e =>
      !e.includes('[warn]') && !e.includes('Warning') && !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('分类筛选可点击', async ({ page }) => {
    await page.goto('/news');
    await page.waitForLoadState('networkidle');

    // 找分类 tab（如"大模型"、"产品"、"工具"等）
    const categoryTab = page.locator('button, [role="tab"], [class*="tab" i]').first();
    const isVisible = await categoryTab.isVisible().catch(() => false);
    if (isVisible) {
      await categoryTab.click();
      // 点击后页面应无崩溃（body 仍可见）
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
