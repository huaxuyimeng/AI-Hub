'use client';

// HSL 强调色 DIY 滑块（skill §4.4 + §6.1）
//
// 2026-08-30 修复：
//   - 旧版 input 设了 appearance-none 但没自定义 thumb，导致 Chromium 上
//     滑块把手完全透明，用户根本看不见、拖不动。
//   - 修复：thumb 样式在 globals.css `.accent-picker-range` 选择器中定义。

import { useState, useEffect } from 'react';
import { useTheme } from '@/components/theme-provider';
import type { AccentHSL } from '@/lib/themes';

export function AccentPicker() {
  const { theme, setAccent } = useTheme();
  const committed = theme.accent ?? { h: 65, s: 75, l: 55 };

  // 本地草稿：在外部状态变更时重置；null 表示跟随 committed
  const [draft, setDraft] = useState<AccentHSL | null>(null);
  const current = draft ?? committed;

  // 主题被外部重置时（例如从服务端同步），清掉本地草稿
  useEffect(() => setDraft(null), [theme.accent]);

  function updateChannel(part: Partial<AccentHSL>) {
    const next = { ...current, ...part };
    setDraft(next);
    setAccent(next); // 同步 commit：setAccent 内部 600ms debounce 落库
  }

  const previewHsl = `hsl(${current.h} ${current.s}% ${current.l}%)`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">强调色</div>
        <button
          type="button"
          onClick={() => {
            setDraft(null);
            setAccent(null);
          }}
          disabled={!theme.accent && !draft}
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
        onChange={(v) => updateChannel({ h: v })}
        suffix="°"
        trackStyle={{
          background: `linear-gradient(to right, hsl(0 ${current.s}% ${current.l}%), hsl(60 ${current.s}% ${current.l}%), hsl(120 ${current.s}% ${current.l}%), hsl(180 ${current.s}% ${current.l}%), hsl(240 ${current.s}% ${current.l}%), hsl(300 ${current.s}% ${current.l}%), hsl(360 ${current.s}% ${current.l}%))`,
        }}
      />

      <Slider
        label="饱和度 S"
        min={0}
        max={100}
        step={1}
        value={current.s}
        onChange={(v) => updateChannel({ s: v })}
        suffix="%"
        trackStyle={{
          background: `linear-gradient(to right, hsl(${current.h} 0% ${current.l}%), hsl(${current.h} 100% ${current.l}%))`,
        }}
      />

      <Slider
        label="明度 L"
        min={30}
        max={80}
        step={1}
        value={current.l}
        onChange={(v) => updateChannel({ l: v })}
        suffix="%"
        trackStyle={{
          background: `linear-gradient(to right, hsl(${current.h} ${current.s}% 30%), hsl(${current.h} ${current.s}% 55%), hsl(${current.h} ${current.s}% 80%))`,
        }}
      />

      {/* 常用色快速选择 */}
      <SwatchRow onPick={(h) => updateChannel({ h })} activeH={current.h} />
    </div>
  );
}

const SWATCHES: Array<{ h: number; name: string }> = [
  { h: 0, name: '红' },
  { h: 15, name: '橙红' },
  { h: 35, name: '橙' },
  { h: 50, name: '金' },
  { h: 75, name: '黄' },
  { h: 130, name: '绿' },
  { h: 165, name: '青' },
  { h: 200, name: '天蓝' },
  { h: 220, name: '蓝' },
  { h: 260, name: '靛' },
  { h: 290, name: '紫' },
  { h: 320, name: '品红' },
  { h: 345, name: '玫红' },
];

function SwatchRow({ onPick, activeH }: { onPick: (h: number) => void; activeH: number }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-muted-foreground">常用色</div>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((s) => {
          const isActive = Math.abs(s.h - activeH) < 4;
          return (
            <button
              key={s.h}
              type="button"
              title={s.name}
              onClick={() => onPick(s.h)}
              className={
                'h-5 w-5 rounded-full border transition hover:scale-110 ' +
                (isActive
                  ? 'border-foreground scale-110 ring-2 ring-foreground/30'
                  : 'border-border')
              }
              style={{ background: `hsl(${s.h} 75% 55%)` }}
              aria-label={s.name}
            />
          );
        })}
      </div>
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
  trackStyle,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  trackStyle: React.CSSProperties;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{value}{suffix}</span>
      </div>
      <div className="relative h-5 rounded-md border border-border" style={trackStyle}>
        {/* 进度指示：thumb 左侧加深色遮罩，适配任意 track 颜色 */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md border-r border-foreground/30"
          style={{
            width: `${pct}%`,
            background: 'rgba(0,0,0,0.15)',
          }}
          aria-hidden
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          className="accent-picker-range absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent"
          style={{ WebkitAppearance: 'none' }}
        />
      </div>
    </div>
  );
}
