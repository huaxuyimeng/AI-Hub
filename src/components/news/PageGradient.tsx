'use client';

/**
 * PageGradient — 鼠标跟随的柔光 blob
 *
 * 设计：
 * - 一个 div，圆角 50%，CSS filter: blur() 让边缘自然柔化成有机的"一团"
 * - 鼠标位置 = 强调色（accent）；向外过渡到调色板的其它色相
 * - 跟随鼠标移动（CSS transform + 700ms transition）
 * - 6 套调色板可在主题面板切换；自动模式每 25 秒随机切换
 * - 颜色通过 @property 注册，浏览器原生插值
 * - 取消 SVG filter 和 mix-blend-mode（避免颜色叠加变深）
 * - 取消独立 "svg" 色阶（用 light/dark 原色即可）
 *
 * 尺寸：380×380px box，40px blur → 视觉半径 ~220px
 *      比之前 520px 圆形径向渐变小约 40%，比上一版 SVG blob 大约 10%
 */

import { useEffect, useRef, useState } from 'react';
import {
  PALETTES,
  getPaletteByName,
  type Palette,
} from '@/lib/palettes/gradient-palettes';
import { useTheme } from '@/components/theme-provider';
import {
  useGradientPalette,
  GRADIENT_PALETTE_NAMES,
  type GradientPaletteName,
} from '@/lib/hooks/use-gradient-palette';

/** 随机选一套（避免和上一次相同） */
function pickRandom(lastIdx: number): number {
  if (PALETTES.length <= 1) return 0;
  let idx = Math.floor(Math.random() * PALETTES.length);
  if (idx === lastIdx) idx = (idx + 1) % PALETTES.length;
  return idx;
}

/**
 * 把调色板应用到 CSS 变量（@property 已注册 → 自动平滑过渡）
 *
 * 这里用 light/dark 直接套用（透明度和之前的 radial-gradient 背景一样）。
 * 之前设计过 svg[] 数组（高饱和度），用户反馈"颜色变深了"，所以删掉。
 */
function applyPalette(palette: Palette, isDark: boolean) {
  const root = document.documentElement;
  if (isDark) {
    root.style.setProperty('--pg-c1', palette.dark[0]);
    root.style.setProperty('--pg-c2', palette.dark[1]);
    root.style.setProperty('--pg-c3', palette.dark[2]);
  } else {
    root.style.setProperty('--pg-c1', palette.light[0]);
    root.style.setProperty('--pg-c2', palette.light[1]);
    root.style.setProperty('--pg-c3', palette.light[2]);
  }
}

export function PageGradient() {
  const blobRef = useRef<HTMLDivElement>(null);
  // V-16 修复：直接订阅 localStorage + 自定义事件。
  // 原代码 [choice] = useGradientPalette() 是 PageGradient 自己的 useState 实例，
  // 与 Picker 里的 hook 互不相通，所以 Picker 改 choice 时 PageGradient 永远拿初始值。
  // 改：每次 Picker 改 → dispatchEvent → 本组件监听后 setChoice → useEffect 触发 apply()
  const [choice, setChoice] = useState<GradientPaletteName>('auto');
  useEffect(() => {
    // 初始从 localStorage 读
    try {
      const raw = window.localStorage.getItem('aihub-gradient-palette');
      if (raw && (GRADIENT_PALETTE_NAMES as readonly string[]).includes(raw)) {
        setChoice(raw as GradientPaletteName);
      }
    } catch {
      /* ignore */
    }
    // 监听跨组件事件
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<GradientPaletteName>).detail;
      if (typeof detail === 'string' && (GRADIENT_PALETTE_NAMES as readonly string[]).includes(detail)) {
        setChoice(detail);
      }
    };
    window.addEventListener('aihub-gradient-palette-change', handler);
    return () => window.removeEventListener('aihub-gradient-palette-change', handler);
  }, []);
  const { theme } = useTheme();

  const accent = theme.accent ?? { h: 65, s: 75, l: 55 };
  const accentColor = `hsl(${accent.h} ${accent.s}% ${accent.l}%)`;

  // 检测当前是否为暗色模式（直接读 DOM，避免对 theme context 的依赖）
  const readIsDark = (): boolean => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  };

  /**
   * 把当前 accent 同步到 --pg-acc 变量
   *
   * 跳过「首挂」：bootstrap 脚本已经按 localStorage 写入了正确的 --pg-acc。
   * 如果 React 第一次 render 立刻用「默认值」（accent=null → 橙色）覆盖回去，
   * 会触发 800ms 颜色过渡，肉眼可见的橙色一闪。
   * 依赖 useGradientPalette 第二次 setName(localStorage 值) 后，
   * theme.accent 也会被 ThemeProvider 同步更新，下一次 render 才会真正写入。
   */
  const isFirstAccentRender = useRef(true);
  useEffect(() => {
    if (isFirstAccentRender.current) {
      isFirstAccentRender.current = false;
      return;
    }
    const root = document.documentElement;
    root.style.setProperty('--pg-acc', accentColor);
  }, [accentColor]);

  /**
   * 调色板切换 + auto 模式每 25s 随机切一次
   *
   * 跳过「首次 apply()」—— bootstrap 已经把 --pg-c1/2/3 写到了 localStorage
   * 里的实际调色板（glacier / dusk / moss / ...）。
   * 如果这里再调一次 applyPalette，会用 useGradientPalette 的初始值 'auto'
   * 选出一个随机调色板，覆写掉 bootstrap 的结果，又一次闪烁。
   *
   * interval 必须每次都注册（cleanup 会保证单实例）—— 否则 auto 模式永远不轮播。
   */
  const isFirstPaletteRender = useRef(true);
  useEffect(() => {
    let paletteIdx = -1;
    let intervalId: number | null = null;

    const apply = () => {
      // H-24 修复：拆开赋值与取值，避免逗号运算符副作用隐藏在三元表达式里
      let palette: Palette;
      if (choice === 'auto') {
        paletteIdx = pickRandom(paletteIdx);
        palette = PALETTES[paletteIdx];
      } else {
        palette = getPaletteByName(choice);
      }
      applyPalette(palette, readIsDark());
    };

    // 首挂跳过 apply，bootstrap 已写入正确值
    if (!isFirstPaletteRender.current) {
      apply();
    }
    isFirstPaletteRender.current = false;

    // auto 模式下启动 25s 轮播
    if (choice === 'auto') {
      intervalId = window.setInterval(apply, 25_000);
    }

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [choice]);

  // 监听 light/dark 切换（属性变化 → 立刻重应用调色板）
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (choice === 'auto') return; // auto 由 interval 驱动
      applyPalette(getPaletteByName(choice), readIsDark());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, [choice]);

  // 鼠标跟踪（rAF 节流 + 700ms transition 平滑插值）
  useEffect(() => {
    const el = blobRef.current;
    if (!el) return;

    let raf = 0;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;

    const flush = () => {
      raf = 0;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };

    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    // 初始位置
    el.style.transform = `translate(${x}px, ${y}px)`;

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