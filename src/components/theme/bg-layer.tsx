'use client';

/**
 * BgLayer — 壁纸 crossfade 切换层
 *
 * 2026-09-10 新增（解决「壁纸切换不丝滑」）：
 *   - 用两张绝对定位的 <img> 叠加，CSS opacity transition 做交叉淡入淡出
 *   - 浏览器自动预加载 <img>（一旦 src 挂载），切换时不会出现「白闪」
 *   - 蒙版透明度仍走 body.has-bg-image::before + --bg-opacity（保持原有 API）
 *
 * 为什么不直接给 body.background-image 加 transition：
 *   CSS 的 background-image 属性**不支持 transition**（离散值）。
 *   必须用两个真实元素 + opacity 才能做平滑过渡。
 *
 * 设计要点：
 *   - 两层 slot（A/B）轮换前台；切换时新 slot 设 data-active=1，旧 slot 设 0
 *   - CSS transition 300ms opacity；切换期间两图同时可见，实现交叉淡入淡出
 *   - 图片 src 变化即触发浏览器加载；onLoad 后切 active，避免「加载中变白」
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface BgLayerProps {
  url: string | null;
  opacity: number;
}

function useForceUpdate(): () => void {
  const [, setTick] = useState(0);
  return useCallback(() => setTick((n) => n + 1), []);
}

export function BgLayer({ url, opacity }: BgLayerProps) {
  // 两层 slot：A 和 B 互为「前台 / 后台」
  // - urlA/urlB 记录每层当前的 src（用于渲染）
  // - front 标记当前前台是 A(0) 还是 B(1)
  // - 切换 url 时：把新 url 写到「后台 slot」→ 等 onLoad → 切 front → CSS 自动淡入淡出
  const [urlA, setUrlA] = useState<string | null>(null);
  const [urlB, setUrlB] = useState<string | null>(null);
  const [front, setFront] = useState<0 | 1>(0);
  const targetUrlRef = useRef<string | null>(null);
  const frontRef = useRef<0 | 1>(0);

  // 同步 ref（用于在 effect 里读最新 front，不依赖闭包）
  useEffect(() => {
    frontRef.current = front;
  }, [front]);

  // url 变化：写入后台 slot，等该 slot 的 <img> 加载完成后切前台
  useEffect(() => {
    if (url === null) {
      // 清空场景：直接卸掉两层
      setUrlA(null);
      setUrlB(null);
      targetUrlRef.current = null;
      return;
    }

    // 当前前台已经显示这个 url → 啥也不用做
    if ((frontRef.current === 0 && urlA === url) || (frontRef.current === 1 && urlB === url)) {
      return;
    }

    targetUrlRef.current = url;
    const nextBack: 0 | 1 = frontRef.current === 0 ? 1 : 0;

    if (nextBack === 0) setUrlA(url);
    else setUrlB(url);
  }, [url, urlA, urlB]);

  // 同步 opacity 到 CSS 变量（蒙版由 body.has-bg-image::before 消费）
  useEffect(() => {
    document.documentElement.style.setProperty('--bg-opacity', String(opacity));
  }, [opacity]);

  /** 后台 slot 的 <img> 加载完成后：把它切到前台 */
  const handleLoaded = (slot: 0 | 1) => {
    if (targetUrlRef.current === null) return;
    // 只切这一次（避免多张图同时加载完成导致重复切）
    const expectedSlot = frontRef.current === 0 ? 1 : 0;
    if (slot !== expectedSlot) return;
    setFront(slot);
    targetUrlRef.current = null;
  };

  if (!urlA && !urlB) return null;

  return (
    <div className="bg-layer" aria-hidden>
      {urlA && (
        <img
          key={`a-${urlA}`}
          src={urlA}
          alt=""
          aria-hidden
          className="bg-layer-img"
          data-active={front === 0 ? '1' : '0'}
          style={{ zIndex: front === 0 ? 2 : 1 }}
          // 关键：后台 slot 加载完才切前台，避免「加载中变白」
          onLoad={() => handleLoaded(0)}
        />
      )}
      {urlB && (
        <img
          key={`b-${urlB}`}
          src={urlB}
          alt=""
          aria-hidden
          className="bg-layer-img"
          data-active={front === 1 ? '1' : '0'}
          style={{ zIndex: front === 1 ? 2 : 1 }}
          onLoad={() => handleLoaded(1)}
        />
      )}
    </div>
  );
}
