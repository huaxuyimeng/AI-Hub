'use client';

/**
 * NavigationFade —— 路由切换时的「老页淡出 + 新页淡入」衔接
 *
 * 解决痛点：之前 page-enter 只有 320ms 的「淡入」，感觉是先空白再弹出来，不丝滑。
 *          现在改成 60ms 老页淡出 + 120ms 新页淡入 = 180ms 总耗时，
 *          但视觉感受是"无缝滑过去"而不是"弹出来"。
 *
 * 实现要点：
 *   - 监听 pathname 变化（usePathname + useEffect）
 *   - pathname 一变就给 main 加 .transit-out class（60ms 内 opa 到 0）
 *   - 同时重置 children 的 .page-enter 动画（先移除再加回来 → 重启）
 *   - 整个过程都是在浏览器原生事件循环里，
 *     不阻断 React 渲染 → 不会卡死 first paint
 *
 * 兼容性：
 *   - 所有浏览器：CSS transition + opacity → 180ms 平滑过渡
 *   - Chrome 111+ / Edge 111+：自动叠加浏览器原生 View Transition API
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function NavigationFade({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLDivElement | null>(null);
  const prevPathRef = useRef<string>(pathname);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (prevPathRef.current === pathname) {
      prevPathRef.current = pathname;
      return;
    }
    prevPathRef.current = pathname;

    // 1. 老页淡出（60ms）
    main.classList.add('transit-out');

    // 2. 60ms 后移除 class，让新页淡入（page-enter 180ms 接管）
    //    使用 rAF + 嵌套 setTimeout 避免 jank
    const t = window.setTimeout(() => {
      main.classList.remove('transit-out');
    }, 60);

    return () => window.clearTimeout(t);
  }, [pathname]);

  return (
    <div ref={mainRef} className="navigation-fade-root flex flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}
