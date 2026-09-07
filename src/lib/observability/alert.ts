import { logger } from './logger';

export interface Alert {
  level: 'info' | 'warn' | 'critical';
  title: string;
  message: string;
  ctx?: Record<string, unknown>;
}

/** 始终打 JSON 日志；配置了 SLACK_WEBHOOK_URL 才 POST。 */
export async function alert(a: Alert) {
  logger.warn('ALERT', { title: a.title, message: a.message, alertLevel: a.level, ...a.ctx });

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  try {
    // P1-#1 修复：Slack webhook 加 5s 超时，避免 Slack 服务器挂死阻塞调用方
    // （如 cron 失败告警卡 60s+，影响后续响应）
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch(webhook, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${a.title}*\n${a.message}`,
          attachments: [
            {
              color: a.level === 'critical' ? 'danger' : a.level === 'warn' ? 'warning' : 'good',
              fields: Object.entries(a.ctx ?? {}).map(([k, v]) => ({
                title: k,
                value: String(v),
                short: true,
              })),
            },
          ],
        }),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logger.error('slack alert failed', { error: (e as Error).message });
  }
}
