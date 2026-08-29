'use client';

// HSL 强调色 DIY 滑块（skill §4.4 + §6.1）
//
// 流畅度优化：每个滑块的 value 用本地 useState 缓存，onChange 只更新本地 state
// （即时反馈），onPointerUp 才把最终值 commit 到 ThemeProvider。这样拖动过程不重渲染
// React Context 子树，仅在松开时统一更新。
//
// V-04: 这里 linear-gradient 是**功能性滑块 track**（HSL 色相 / 饱和度 / 亮度可视化），
// 与 skill §3「禁止装饰性纯单色线性渐变」不冲突——是控件输入的语义表达，非装饰。

import { useState, useEffect, useRef } from 'react';
import { useTheme } from '@/components/theme-provider';
import type { AccentHSL } from '@/lib/themes';

export function AccentPicker() {
  const { theme, setAccent } = useTheme();
  const committed = theme.accent ?? { h: 65, s: 75, l: 55 };

  // 本地草稿（拖动时）
  const [local, setLocal] = useState<AccentHSL | null>(null);
  const current = local ?? committed;

  // 离开或外部变化重置本地草稿
  useEffect(() => setLocal(null), [theme.accent]);

  // 节流 commit：拖动过程中每 ~120ms 才写一次 storage + apply
  const pendingRef = useRef<number | null>(null);
  function scheduleCommit(v: AccentHSL) {
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = window.setTimeout(() => {
      setAccent(v);
      pendingRef.current = null;
    }, 120);
  }

  function update(part: Partial<AccentHSL>, dragging = false) {
    const next = { ...current, ...part };
    setLocal(next);
    if (dragging) {
      scheduleCommit(next);
    } else {
      // 非拖动（点击 / 滚轮）：立即 commit
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
      setAccent(next);
    }
  }

  const previewHsl = `hsl(${current.h} ${current.s}% ${current.l}%)`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">强调色</div>
        <button
          type="button"
          onClick={() => {
            setLocal(null);
            setAccent(null);
          }}
          disabled={!theme.accent && !local}
          className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          重置为预设默认
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="h-7 w-7 rounded-md border border-border shadow-inner"
          style={{ background: previewHsl }}
        />
        <code className="font-mono text-[11px] text-muted-foreground">{previewHsl}</code>
      </div>

      <Slider
        label="色相 H"
        min={0}
        max={360}
        step={1}
        value={current.h}
        onChange={(v, dragging) => update({ h: v }, dragging)}
        suffix="°"
        gradient={`linear-gradient(to right, hsl(0 ${current.s}% ${current.l}%), hsl(60 ${current.s}% ${current.l}%), hsl(120 ${current.s}% ${current.l}%), hsl(180 ${current.s}% ${current.l}%), hsl(240 ${current.s}% ${current.l}%), hsl(300 ${current.s}% ${current.l}%), hsl(360 ${current.s}% ${current.l}%))`}
      />

      <Slider
        label="饱和度 S"
        min={0}
        max={100}
        step={1}
        value={current.s}
        onChange={(v, dragging) => update({ s: v }, dragging)}
        suffix="%"
        gradient={`linear-gradient(to right, hsl(${current.h} 0% ${current.l}%), hsl(${current.h} 100% ${current.l}%))`}
      />

      <Slider
        label="明度 L"
        min={30}
        max={80}
        step={1}
        value={current.l}
        onChange={(v, dragging) => update({ l: v }, dragging)}
        suffix="%"
        gradient={`linear-gradient(to right, hsl(${current.h} ${current.s}% 30%), hsl(${current.h} ${current.s}% 55%), hsl(${current.h} ${current.s}% 80%))`}
      />
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix = '',
  gradient,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number, dragging: boolean) => void;
  suffix?: string;
  gradient: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{value}{suffix}</span>
      </div>
      <div className="relative h-5 rounded-md border border-border" style={{ background: gradient }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value), (e.nativeEvent as PointerEvent | MouseEvent).type !== 'change')}
          onPointerUp={() => onChange(value, false)}
          onPointerCancel={() => onChange(value, false)}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
          style={{ WebkitAppearance: 'none' }}
        />
      </div>
    </div>
  );
}