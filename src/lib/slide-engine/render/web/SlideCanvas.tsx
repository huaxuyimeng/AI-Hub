/**
 * React 哑渲染器
 * 只做一件事：PlacedSlide → React 绝对定位画布
 * 布局决策全部在页型定义里，这里零逻辑
 */

'use client';

import React from 'react';
import type { ThemeTokens } from '../../contracts/theme';
import type { PlacedSlide, PlacedBox } from '../../contracts/geometry';

// 默认画布尺寸（960×540 pt）
const CANVAS_W = 960;
const CANVAS_H = 540;

export type SlideCanvasProps = {
  slide: PlacedSlide;
  theme: ThemeTokens;
  /** 缩放比例，默认 1 */
  scale?: number;
  /** 是否显示边框（调试用） */
  debug?: boolean;
};

export const SlideCanvas = React.memo(function SlideCanvas({
  slide,
  theme,
  scale = 1,
  debug = false,
}: SlideCanvasProps) {
  const w = CANVAS_W * scale;
  const h = CANVAS_H * scale;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: w,
        height: h,
        backgroundColor: theme.colors.surface,
        fontFamily: `"${theme.fonts.cn}", "Microsoft YaHei", "PingFang SC", sans-serif`,
      }}
    >
      {slide.boxes.map(box => (
        <RenderBox
          key={box.id}
          box={box}
          theme={theme}
          scale={scale}
          debug={debug}
        />
      ))}
    </div>
  );
});

function RenderBox({
  box,
  theme,
  scale,
  debug,
}: {
  box: PlacedBox;
  theme: ThemeTokens;
  scale: number;
  debug: boolean;
}) {
  const x = box.box.x * scale;
  const y = box.box.y * scale;
  const w = box.box.w * scale;
  const h = box.box.h * scale;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: x,
    top: y,
    width: w,
    height: h,
    zIndex: box.z,
  };

  switch (box.kind) {
    case 'card':
    case 'badge': {
      const bg = box.fill ?? theme.colors.surface;
      const radius = box.radius ? box.radius * scale : 8 * scale;
      const border = debug
        ? '1px dashed red'
        : box.borderColor
          ? `0.5px solid ${box.borderColor}`
          : undefined;

      // card/badge 允许携带文字（如 header-chip 徽标）。
      // 早期实现只画形状，导致徽标语全部消失，只剩一个空色块。
      if (box.text?.value) {
        return (
          <div
            style={{
              ...style,
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                box.text.align === 'center' ? 'center' : box.text.align === 'right' ? 'flex-end' : 'flex-start',
              backgroundColor: bg,
              borderRadius: radius,
              border,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              fontFamily:
                box.text.font === 'num'
                  ? `"${theme.fonts.num}", "Inter", "Helvetica Neue", Arial, sans-serif`
                  : `"${theme.fonts.cn}", "Microsoft YaHei", "PingFang SC", sans-serif`,
              fontSize: box.text.size * scale,
              fontWeight: box.text.weight,
              lineHeight: box.text.lineHeight,
              color: box.text.color ?? theme.colors.ink,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              padding: `0 ${4 * scale}px`,
              boxSizing: 'border-box',
            }}
          >
            {box.text.value}
          </div>
        );
      }

      return (
        <div
          style={{
            ...style,
            backgroundColor: bg,
            borderRadius: radius,
            border,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        />
      );
    }

    case 'divider':
      return (
        <div
          style={{
            ...style,
            backgroundColor: box.fill ?? theme.colors.border,
          }}
        />
      );

    case 'bar':
      return (
        <div
          style={{
            ...style,
            backgroundColor: box.fill ?? theme.colors.primary,
            borderRadius: Math.min(h / 2, 4 * scale),
          }}
        />
      );

    case 'text':
      return <RenderText box={box} theme={theme} style={style} scale={scale} debug={debug} />;

    case 'table':
      return <RenderTable box={box} theme={theme} style={style} scale={scale} debug={debug} />;

    case 'image':
      return (
        <div
          style={{
            ...style,
            backgroundColor: theme.colors.border,
            borderRadius: 4 * scale,
          }}
        />
      );

    default:
      return (
        <div
          style={{
            ...style,
            backgroundColor: 'rgba(255,0,0,0.1)',
            border: debug ? '1px dashed red' : undefined,
          }}
        />
      );
  }
}

function RenderText({
  box,
  theme,
  style,
  scale,
  debug,
}: {
  box: PlacedBox;
  theme: ThemeTokens;
  style: React.CSSProperties;
  scale: number;
  debug: boolean;
}) {
  const text = box.text;
  if (!text || !text.value) {
    return (
      <div
        style={{
          ...style,
          backgroundColor: debug ? 'rgba(0,255,0,0.1)' : 'transparent',
          border: debug ? '1px dashed green' : undefined,
        }}
      />
    );
  }

  const fontFamily =
    text.font === 'num'
      ? `"${theme.fonts.num}", "Inter", "Helvetica Neue", Arial, sans-serif`
      : `"${theme.fonts.cn}", "Microsoft YaHei", "PingFang SC", sans-serif`;

  const alignMap: Record<string, React.CSSProperties['textAlign']> = {
    left: 'left',
    center: 'center',
    right: 'right',
  };

  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'flex-start',
        fontFamily,
        fontSize: text.size * scale,
        fontWeight: text.weight,
        lineHeight: text.lineHeight,
        color: text.color ?? theme.colors.ink,
        textAlign: alignMap[text.align] ?? 'left',
        overflow: 'hidden',
        border: debug ? '1px dashed blue' : undefined,
      }}
    >
      {text.value}
    </div>
  );
}

function RenderTable({
  box,
  theme,
  style,
  scale,
  debug,
}: {
  box: PlacedBox;
  theme: ThemeTokens;
  style: React.CSSProperties;
  scale: number;
  debug: boolean;
}) {
  const cells = box.cells;
  if (!cells || cells.length === 0) {
    return (
      <div
        style={{
          ...style,
          backgroundColor: debug ? 'rgba(255,255,0,0.1)' : theme.colors.surface,
          border: debug ? '1px dashed yellow' : `0.5px solid ${theme.colors.border}`,
        }}
      />
    );
  }

  const rows = cells.map((row, ri) => (
    <tr key={ri}>
      {row.map((cell, ci) => {
        const fontFamily =
          cell.font === 'num'
            ? `"${theme.fonts.num}", "Inter", "Helvetica Neue", Arial, sans-serif`
            : `"${theme.fonts.cn}", "Microsoft YaHei", "PingFang SC", sans-serif`;

        const alignMap: Record<string, React.CSSProperties['textAlign']> = {
          left: 'left',
          center: 'center',
          right: 'right',
        };

        return (
          <td
            key={ci}
            style={{
              padding: `${4 * scale}px ${8 * scale}px`,
              fontSize: cell.size * scale,
              fontFamily,
              fontWeight: cell.weight,
              lineHeight: cell.lineHeight,
              color: cell.color ?? theme.colors.ink,
              textAlign: alignMap[cell.align] ?? 'left',
              borderBottom: `0.5px solid ${theme.colors.border}`,
              borderRight: `0.5px solid ${theme.colors.border}`,
              backgroundColor: ri % 2 === 1 ? theme.colors.surface : 'white',
            }}
          >
            {cell.value}
          </td>
        );
      })}
    </tr>
  ));

  return (
    <table
      style={{
        ...style,
        borderCollapse: 'collapse',
        width: '100%',
        border: debug ? '1px dashed orange' : `0.5px solid ${theme.colors.border}`,
      }}
    >
      <tbody>{rows}</tbody>
    </table>
  );
}

// ============================================================================
// 多页预览组件
// ============================================================================

export type DeckPreviewProps = {
  slides: PlacedSlide[];
  theme: ThemeTokens;
  scale?: number;
  debug?: boolean;
  /** 当前页码（1-indexed）。**传入即为受控模式**，组件会跟随该值；不传则组件内部自管 */
  page?: number;
  /** 页码切换回调 */
  onPageChange?: (page: number) => void;
};

export const DeckPreview = React.memo(function DeckPreview({
  slides,
  theme,
  scale = 1,
  debug = false,
  page,
  onPageChange,
}: DeckPreviewProps) {
  // page 传入即为「受控」（父组件掌握当前页），不传则组件自己管
  const isPageControlled = page !== undefined;
  const [currentPage, setCurrentPage] = React.useState(page ?? 1);
  const totalPages = slides.length;

  const handlePageChange = React.useCallback((newPage: number) => {
    setCurrentPage(newPage);
    onPageChange?.(newPage);
  }, [onPageChange]);

  // 受控同步：父组件换页（缩略图跳转 / 切换日期重置）时必须跟随内部态，
  // 否则外部点了第 8 页、画面还停在第 1 页。
  // 同时夹住越界：内容换了导致 slides 变短时，停在末页而不是渲染空白。
  React.useEffect(() => {
    if (!isPageControlled) return;
    const clamped = Math.min(Math.max(1, page), Math.max(1, slides.length));
    setCurrentPage((prev) => (prev === clamped ? prev : clamped));
  }, [isPageControlled, page, slides.length]);

  // 键盘翻页
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' && currentPage > 1) {
        e.preventDefault();
        handlePageChange(currentPage - 1);
      } else if (e.key === 'ArrowRight' && currentPage < totalPages) {
        e.preventDefault();
        handlePageChange(currentPage + 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, totalPages, handlePageChange]);

  const currentSlide = slides[currentPage - 1];
  if (!currentSlide) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* 预览框 */}
      <div className="relative" style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}>
        <SlideCanvas
          slide={currentSlide}
          theme={theme}
          scale={scale}
          debug={debug}
        />

        {/* 翻页按钮 */}
        <button
          type="button"
          aria-label="上一页"
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white shadow-md transition hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="下一页"
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white shadow-md transition hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* 页码指示器 */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          第 <strong className="font-semibold text-foreground">{String(currentPage).padStart(2, '0')}</strong> / {String(totalPages).padStart(2, '0')} 页
        </span>
        <span className="opacity-50">·</span>
        <span className="opacity-70">键盘 ← → 翻页</span>
      </div>
    </div>
  );
});
