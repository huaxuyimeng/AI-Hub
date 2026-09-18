'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconBrandGithub, IconLoader2 } from '@tabler/icons-react';

/**
 * 本地开发默认账号（来自 .env.local 的 NEXT_PUBLIC_DEV_DEFAULT_ACCOUNT）。
 * 格式："email,password"。
 * 生产环境 NEXT_PUBLIC_DEV_DEFAULT_ACCOUNT 未配置时为空，自动跳过。
 */
const DEV_ACCOUNT = process.env.NEXT_PUBLIC_DEV_DEFAULT_ACCOUNT ?? '';
const [DEV_EMAIL, DEV_PASSWORD] = DEV_ACCOUNT.split(',').map((s) => s.trim());

export default function LoginPage() {
  // Suspense 包裹：useSearchParams 在 Next 14 必须配 Suspense，否则 build 阶段预渲染失败
  return (
    <Suspense fallback={
      <div className="grid min-h-screen place-items-center bg-background">
        <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const callbackUrl = sp.get('callbackUrl') ?? '/workbench';

  const [email, setEmail] = useState(DEV_EMAIL);
  const [password, setPassword] = useState(DEV_PASSWORD);
  const [name, setName] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (registerMode) {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, name: name || undefined }),
          signal: AbortSignal.timeout(10_000),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? '注册失败');
          return;
        }
        // B-02: 注册成功后弹个轻提示，再走 signIn（tenantId 已由服务端建好，会话自然取到）
        const tenantId = (data as { tenantId?: string }).tenantId;
        if (tenantId) {
          console.log('[register] workspace created:', tenantId);
        }
      }
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });
      if (result?.error) {
        setError('邮箱或密码错误');
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }

  async function handleGithub() {
    setLoading(true);
    await signIn('github', { callbackUrl });
  }

  return (
    /* 全屏 grid 居中，padding-y 给对话框呼吸空间 */
    <div className="grid min-h-screen place-items-center bg-background px-4 py-12 sm:py-16">
      <div className="w-full max-w-[26rem] animate-fade-in">
        {/* 卡片 */}
        <div className="rounded-xl border surface-elevated p-8 shadow-lg shadow-foreground/[0.04]">
          {/* Logo + 标题 */}
          <div className="mb-7 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <span className="text-lg font-bold">A</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">AIHub</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              多租户 AI 代码分析平台
            </p>
          </div>

          {/* GitHub */}
          <button
            type="button"
            onClick={handleGithub}
            disabled={loading}
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-md border bg-background px-4 py-2.5 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
          >
            <IconBrandGithub size={18} />
            使用 GitHub 登录
          </button>

          {/* divider */}
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>或</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleCredentials} className="space-y-3">
            {registerMode && (
              <input
                type="text"
                placeholder="显示名称（可选）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="w-full rounded-md border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            )}
            <input
              type="email"
              required
              placeholder="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="w-full rounded-md border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="密码（≥ 8 位）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={registerMode ? 'new-password' : 'current-password'}
              className="w-full rounded-md border bg-background px-3.5 py-2.5 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive animate-fade-in">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <IconLoader2 size={16} className="animate-spin" />}
              {registerMode ? '注册并登录' : '登录'}
            </button>

            {!registerMode && DEV_EMAIL && (email === DEV_EMAIL || password === DEV_PASSWORD) && (
              <button
                type="button"
                onClick={() => { setEmail(''); setPassword(''); }}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground transition"
              >
                清空默认测试账号
              </button>
            )}
          </form>

          {!registerMode && DEV_EMAIL && (email === DEV_EMAIL || password === DEV_PASSWORD) && (
            <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-center text-[11px] leading-relaxed text-muted-foreground">
              当前为开发环境，默认填入测试账号 <span className="font-mono">{DEV_EMAIL}</span> / <span className="font-mono">{DEV_PASSWORD}</span>。
            </p>
          )}

          <div className="mt-5 text-center text-xs text-muted-foreground">
            {registerMode ? '已有账号？' : '没有账号？'}
            <button
              type="button"
              onClick={() => {
                setRegisterMode(!registerMode);
                if (!registerMode) {
                  // 进入注册模式：清空密码避免误用测试密码注册
                  setPassword('');
                  setEmail('');
                } else {
                  // 回到登录模式：恢复测试账号默认值
                  setEmail('admin@aihub.local');
                  setPassword('admin123');
                }
              }}
              className="ml-1 font-medium text-primary hover:underline"
            >
              {registerMode ? '去登录' : '去注册'}
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          继续操作即代表同意{' '}
          <Link
            href="/terms"
            className="hover:text-foreground underline-offset-4 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            服务条款
          </Link>{' '}
          与{' '}
          <Link
            href="/privacy"
            className="hover:text-foreground underline-offset-4 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            隐私政策
          </Link>
        </p>
      </div>
    </div>
  );
}