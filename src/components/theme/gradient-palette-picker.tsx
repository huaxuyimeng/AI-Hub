'use client';

/**
 * GradientPalettePicker — 在主题设置里选择页面氛围光晕调色板
 *
 * 选项：
 *   - 自动：每 25 秒随机切换
 *   - 6 套固定调色板（冰川 / 黄昏 / 苔藓 / 极光 / 丝绒 / 晨雾）
 *
 * 持久化：localStorage + 跨组件事件（见 useGradientPalette）
 *
 * 每个缩略图是一个迷你 radial-gradient，反映调色板的真实颜色组合。
 */

import { useGradientPalette, GRADIENT_PALETTE_META } from '@/lib/hooks/use-gradient-palette';
import { PALETTES, palettePreviewGradient } from '@/lib/palettes/gradient-palettes';
import { IconDice } from '@tabler/icons-react';

export function GradientPalettePicker() {
  const [choice, setChoice] = useGradientPalette();

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">氛围光晕</div>
        <div className="text-[10px] text-muted-foreground">
          {choice === 'auto' ? '每 25 秒随机切换' : '已锁定'}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {/* Auto 卡片 */}
        <Swatch
          active={choice === 'auto'}
          onClick={() => setChoice('auto')}
          preview={
            <span
              className="flex h-full w-full items-center justify-center text-muted-foreground"
              aria-label="自动"
            >
              <IconDice size={14} />
            </span>
          }
          label="自动"
        />

        {/* 6 套调色板 */}
        {PALETTES.map((p) => (
          <Swatch
            key={p.name}
            active={choice === p.name}
            onClick={() => setChoice(p.name)}
            preview={
              <span
                className="block h-full w-full rounded-md"
                style={{ background: palettePreviewGradient(p.light) }}
                aria-hidden
              />
            }
            label={GRADIENT_PALETTE_META[p.name].label}
          />
        ))}
      </div>

      <div className="text-[10px] leading-relaxed text-muted-foreground">
        控制新闻页面的 cursor-following 氛围光晕；选择「自动」则每 25 秒随机切换。
      </div>
    </div>
  );
}

function Swatch({
  active,
  onClick,
  preview,
  label,
}: {
  active: boolean;
  onClick: () => void;
  preview: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        'group relative aspect-square overflow-hidden rounded-md border transition ' +
        (active
          ? 'border-foreground/70 ring-2 ring-foreground/30 ring-offset-1 ring-offset-background'
          : 'border-border hover:border-foreground/30')
      }
    >
      {preview}
    </button>
  );
}
