/**
 * BUG-A 修复：HTTP 层鉴权
 *
 * 问题：async server component layout 里的 redirect() 被 Next.js 14 RSC streaming
 * 编码进 payload，HTTP 层永远返回 200。未登录用户直接访问 /workbench 等会看到部分
 * HTML 内容（安全隐患 + SEO 灾难）。
 *
 * 修复：在 middleware 层用 NextAuth JWT 验证，未登录 → HTTP 307 redirect 到 /login。
 *
 * 受保护路径：(app) route group 下的所有页面
 * 公开路径：/login /terms /privacy /api/auth/* /api/news/health /api/cron/*（cron 有独立 Bearer 鉴权）
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PROTECTED_PATHS = [
  '/workbench',
  '/projects',
  '/chat',
  '/usage',
  '/settings',
  '/news',
  '/rankings',
  '/plugins',
  '/cleanup',
];

const PUBLIC_PATHS = new Set([
  '/login',
  '/terms',
  '/privacy',
  // NextAuth API 路由
  '/api/auth',
  // 健康检查（无 session 也要能访问）
  '/api/news/health',
  // Cron 路由有独立 Bearer 鉴权
  '/api/cron',
  // 静态资源
  '/_next',
  '/favicon.ico',
  '/icon.svg',
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公开路径直接放行
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // 非受保护路径（根 / 等）也放行，交给 page.tsx 自己 redirect
  if (!PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  // 受保护路径：检查 NextAuth session token
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: 'next-auth.session-token',
  });

  if (!token) {
    const loginUrl = new URL('/login', req.url);
    // 记住来源页面，登录后可跳转回来（仅对直接页面有效）
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico
     * - 明确公开的 API 路由（但 /api/auth/* 和 /api/news/health 在上面已豁免）
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
