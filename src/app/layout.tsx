import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { env } from '@/lib/env';
import { Providers } from '@/components/providers';
import { PREPAINT_SCRIPT } from '@/lib/bootstrap-script';

// C29：从 env.ts 取校验过的 NEXTAUTH_URL；缺失时 fallback 并打 warn
function resolveMetadataBase(): URL {
  try {
    return new URL(env.NEXTAUTH_URL);
  } catch {
    console.warn('[layout] NEXTAUTH_URL 不可用，metadataBase 降级到 localhost:3000');
    return new URL('http://localhost:3000');
  }
}

// 注入给客户端的 R2 配置信息（不暴露凭据）
const r2Ready = Boolean(
  env.CLOUDFLARE_R2_ACCOUNT_ID &&
    env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
    env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
);

export const metadata: Metadata = {
  title: {
    default: 'AIHub',
    template: '%s · AIHub',
  },
  description: 'AI 代码审查 / 对话 / 评分 — 多租户 SaaS',
  metadataBase: resolveMetadataBase(),
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f3' },
    { media: '(prefers-color-scheme: dark)', color: '#1c2030' },
  ],
};

// 内联脚本：把 R2 配置 flag 注入 window（仅布尔值，无凭据泄露风险）
const R2_BOOTSTRAP_SCRIPT = `window.__AIHUB_R2_READY = ${r2Ready ? 'true' : 'false'};`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // C31：suppressHydrationWarning 避免 theme class 在 hydration 时报警告
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* FOUC 屏蔽：避免 hydration 之前主题错位闪烁 + 写入渐变光晕调色板 */}
        <script dangerouslySetInnerHTML={{ __html: PREPAINT_SCRIPT }} />
        {/* R2 配置 flag（仅 boolean，无凭据） */}
        <script dangerouslySetInnerHTML={{ __html: R2_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}