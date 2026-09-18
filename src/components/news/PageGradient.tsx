'use client';

/**
 * PageGradient — 鼠标跟随的柔光 blob
 *
 * 完整重写（2026-09-10 第六轮）
 *
 * 定位方案（最终版）：
 *   CSS：.page-gradient-blob 用 left:50%; top:50%; margin:-190px; → 严格居中
 *   JS：mousemove 时写 transform: translate3d(dx, dy, 0)
 *       其中 dx = clientX - centerX, dy = clientY - centerY
 *       centerX = window.innerWidth / 2
 *       centerY = window.innerHeight / 2
 *       → blob 中心严格跟随鼠标
 *
 * 为什么不用 top/left：
 *   top/left 的 transition 比 transform 慢得多（top/left 触发 layout/paint，
 *   transform 只触发 composite），动画卡顿。
 *
 * 为什么不用 transform: translate(-50%, -50%)：
 *   因为父元素已经用 margin 把左上角定位到 center - 190，所以 transform 直接
 *   在这个基础上加 translate(dx, dy) 即可。
 *
 * 调试：
 *   localStorage.setItem('aihub-debug-blob', '1') → blob 中心显示红点
 *   localStorage.removeItem('aihub-debug-blob') → 关闭
 */

import { useEffect, useRef, useState } from 'react';
import {
  PALETTES,
  getPaletteByName,
  type Palette,
} from '@/lib/palettes/gradient-palettes';
import { useTheme } from '@/components/theme-provider';
import {
  GRADIENT_PALETTE_NAMES,
  type GradientPaletteName,
} from '@/lib/hooks/use-gradient-palette';

const BLOB_SIZE = 380;
const BLOB_HALF = BLOB_SIZE / 2;

/** 随机选一套（避免和上一次相同） */
function pickRandom(lastIdx: number): number {
  const len = PALETTES.length;
  if (len <= 1) return 0;
  let idx = Math.floor(Math.random() * len);
  if (idx === lastIdx) idx = (idx + 1) % len;
  return idx;
}

/** 构造 radial-gradient 字符串 */
function buildGradient(palette: Palette, isDark: boolean, accentColor: string): string {
  const colors = isDark ? palette.dark : palette.light;
  return (
    `radial-gradient(circle, ` +
    `${accentColor} 0%, ` +
    `${colors[0]} 30%, ` +
    `${colors[1]} 60%, ` +
    `transparent 88%)`
  );
}

export function PageGradient() {
  const blobRef = useRef<HTMLDivElement>(null);

  /* ---- 调色板状态 ---- */
  const [choice, setChoice] = useState<GradientPaletteName>('auto');
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('aihub-gradient-palette');
      if (
        raw &&
        (GRADIENT_PALETTE_NAMES as readonly string[]).includes(raw)
      ) {
        setChoice(raw as GradientPaletteName);
      }
    } catch {
      /* ignore */
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<GradientPaletteName>).detail;
      if (
        typeof detail === 'string' &&
        (GRADIENT_PALETTE_NAMES as readonly string[]).includes(detail)
      ) {
        setChoice(detail);
      }
    };
    window.addEventListener('aihub-gradient-palette-change', handler);
    return () => window.removeEventListener('aihub-gradient-palette-change', handler);
  }, []);

  /* ---- 主题 accent ---- */
  const { theme } = useTheme();
  const accent = theme.accent ?? { h: 65, s: 75, l: 55 };
  const isDark = theme.mode === 'dark';
  const accentL = accent.l + (isDark ? 5 : 0);
  const accentColor = `hsl(${accent.h} ${accent.s}% ${accentL}%)`;

  /* ---- auto 模式当前调色板索引 ---- */
  const paletteIdxRef = useRef<number>(-1);

  /* ---- 调色板应用 ---- */
  const applyGradient = () => {
    const el = blobRef.current;
    if (!el) return;
    let palette: Palette;
    if (choice === 'auto') {
      paletteIdxRef.current = pickRandom(paletteIdxRef.current);
      palette = PALETTES[paletteIdxRef.current];
    } else {
      palette = getPaletteByName(choice);
    }
    el.style.backgroundImage = buildGradient(palette, isDark, accentColor);
  };

  useEffect(() => {
    applyGradient();
    if (choice !== 'auto') return;
    const id = window.setInterval(applyGradient, 25_000);
    return () => window.clearInterval(id);
  }, [choice, isDark, accentColor]);

  /* ---- 调试模式 ---- */
  useEffect(() => {
    const el = blobRef.current;
    if (!el) return;
    try {
      const debug = window.localStorage.getItem('aihub-debug-blob');
      if (debug === '1') {
        el.dataset.debug = '1';
      } else {
        delete el.dataset.debug;
      }
    } catch {
      /* ignore */
    }
  }, []);

  /* ---- 鼠标跟踪（最关键的部分） ----
     核心数学：
       CSS 已把 blob 中心定在 (window.innerWidth/2, window.innerHeight/2)
       JS 计算鼠标相对于这个中心的偏移量：
         dx = clientX - innerWidth/2
         dy = clientY - innerHeight/2
       写入 transform: translate3d(dx, dy, 0)
       → blob 中心严格 = (clientX, clientY)

     BUG-FIX（2026-09-10 第六轮）：
       用户实测：第四轮后光晕跑到鼠标**左边**了，需要**向右**校准 1.5cm（约 57px）。
       原因：前三轮累计 -89px 偏移过度（向左过头）。
       解决方案：LEFT_CALIBRATION_PX 由 -89 改为 -32（+57 = 向右挪 1.5cm）。
       Y 轴（上下）按用户要求**不动**。
  */
  useEffect(() => {
    const el = blobRef.current;
    if (!el) return;

    // 水平校准常量（px）：负值 = 向左挪
    // 89px ≈ 2.35cm（96 DPI 屏幕下 1cm ≈ 37.8px）
    // -75 第一轮用户校准（向左 2cm）
    // - 7 第二轮用户校准（再向左 0.2cm）
    // - 7 第三轮用户校准（再向左 0.2cm）
    // +57 第四轮用户校准（向右 1.5cm，因为第三轮后偏左了）
    const LEFT_CALIBRATION_PX = -32;
    const TOP_CALIBRATION_PX = 0;

    // 初始 transform：仅校准常量（CSS 居中）
    el.style.transform = `translate3d(${LEFT_CALIBRATION_PX}px, ${TOP_CALIBRATION_PX}px, 0)`;

    let raf = 0;
    let dx = LEFT_CALIBRATION_PX;
    let dy = TOP_CALIBRATION_PX;

    const flush = () => {
      raf = 0;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    const onMove = (e: MouseEvent) => {
      dx = e.clientX - window.innerWidth / 2 + LEFT_CALIBRATION_PX;
      dy = e.clientY - window.innerHeight / 2 + TOP_CALIBRATION_PX;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="page-gradient pointer-events-none fixed inset-0 z-0 h-full w-full"
    >
      <div ref={blobRef} className="page-gradient-blob" />
    </div>
  );
}
