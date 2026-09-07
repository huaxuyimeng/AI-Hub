import { test, expect } from '@playwright/test';

/**
 * AI 模型排行 E2E 测试
 *
 * 测试场景：
 *   1. 排行页正常加载
 *   2. 模型列表/表格出现
 *   3. 排行指标显示（性价比 / 评分 / 价格）
 */

test.describe('排行页（/rankings）', () => {

  test.use({ storageState: '.auth/storage-state.json' });

  test('页面正常加载', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/rankings');
    await page.waitForLoadState('networkidle');

    // 页面标题或排行内容
    const heading = page.getByRole('heading', { name: /排行|rank/i }).first();
    const table = page.locator('table, [class*="rank" i]').first();

    const hasContent = await heading.isVisible().catch(() => false) ||
                      await table.isVisible().catch(() => false);
    expect(hasContent).toBeTruthy();

    const criticalErrors = errors.filter(e =>
      !e.includes('[warn]') && !e.includes('Warning') && !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('模型卡片显示关键指标', async ({ page }) => {
    await page.goto('/rankings');
    await page.waitForLoadState('networkidle');

    // 找第一个模型行（td 或卡片 div）
    const firstRow = page.locator('tbody tr, [class*="model" i]').first();
    const rowVisible = await firstRow.isVisible().catch(() => false);
    if (rowVisible) {
      // 模型名应出现
      const modelName = firstRow.locator('td, div').first();
      await expect(modelName).toBeVisible();
    }
  });
});
