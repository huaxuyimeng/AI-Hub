'use client';

// AI 模型性价比排行：挂载 public/lvr 下的零依赖组件（LVR.init）
// 主题对接：白底保留，主色映射 AIHub 的 --accent，换肤自动跟随

import { useEffect, useRef, useState } from 'react';

const LVR_CSS = '/lvr/css/style.css';
const LVR_SCRIPTS = ['/lvr/js/data.js', '/lvr/js/ranking.js', '/lvr/js/chart.js', '/lvr/js/app.js'];

function ensureCss() {
  if (document.querySelector(`link[href="${LVR_CSS}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = LVR_CSS;
  document.head.appendChild(l);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(src));
    document.body.appendChild(s);
  });
}

export default function RankingsPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        ensureCss();
        for (const src of LVR_SCRIPTS) await loadScript(src);
        const LVR = (window as unknown as { LVR?: { init: (el: HTMLElement) => void } }).LVR;
        const host = hostRef.current;
        if (!LVR || !host || cancelled) return;
        if (!host.dataset.mounted) {
          LVR.init(host);
          host.dataset.mounted = '1';
        }
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <style>{`
        /* --accent 由主题提供者注入完整色值（oklch），直接引用即可随换肤变化；
           注意不要包 hsl()——预设色板是 oklch，包一层会得到无效颜色 */
        #lvr-host .lvr-root { --lvr-accent: var(--accent); }
        #lvr-host .lvr-bar-fill { background: var(--accent); }
      `}</style>
      <div className="flex-1 overflow-y-auto page-enter">
        <div className="mx-auto max-w-6xl px-8 py-10">
          <header className="mb-6">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Rankings</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">AI 模型性价比排行</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              性价比 = f(能力) × 速度<sup>0.8</sup> / 价格 · 数据快照 2026-08-28 · 点击模型可获取官方 API Key
            </p>
          </header>

          {state === 'loading' && (
            <div className="rounded-lg border bg-card py-16 text-center text-sm text-muted-foreground">
              加载排行组件…
            </div>
          )}
          {state === 'error' && (
            <div className="rounded-lg border border-destructive/40 bg-card py-16 text-center text-sm text-destructive">
              排行组件加载失败，请检查 public/lvr 目录是否完整。
            </div>
          )}
          <div id="lvr-host" ref={hostRef} className={state === 'ready' ? '' : 'hidden'} />
        </div>
      </div>
    </>
  );
}
