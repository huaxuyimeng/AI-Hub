import path from 'path';
import fs from 'fs';

/**
 * 全局 Teardown：清理登录截图（可选）
 *
 * 若有需要可扩展为：
 *   - 清理测试产生的 R2 上传文件
 *   - 清理测试产生的 DB 记录
 *   - 发送测试报告
 */

const SCREENSHOT_PATH = path.join(__dirname, 'login-failure.png');

export default async function globalTeardown() {
  // 清理登录失败截图（不阻塞主流程）
  try {
    if (fs.existsSync(SCREENSHOT_PATH)) {
      fs.unlinkSync(SCREENSHOT_PATH);
      console.log('[Playwright] 清理登录失败截图: login-failure.png');
    }
  } catch {
    // 忽略清理错误
  }
}
