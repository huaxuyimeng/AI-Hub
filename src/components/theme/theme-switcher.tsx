'use client';

// 主题切换弹窗：6 预设网格 + 模式切换 + DIY 强调色 + 背景图入口
// skill §6.1 ThemeSwitcher
//
// v3 改进：
// - 预设卡片用 mini UI 预览（不是渐变方块）
// - R2 未配置时禁用上传入口 + 灰色提示（不是红色 error）
// - 上传错误改为 toast

import { useState, useEffect, useRef } from 'react';
import { IconCheck, IconSun, IconMoon, IconDeviceLaptop, IconPhoto, IconX, IconAlertTriangle } from '@tabler/icons-react';
import { useTheme } from '@/components/theme-provider';
import { PRESET_LIST, PRESETS, type ThemePreset, type StoredTheme } from '@/lib/themes';
import { AccentPicker } from './accent-picker';
import { useToast } from '@/components/toast';
import { isR2ConfiguredClient } from '@/lib/r2-client';
import { trpc } from '@/lib/trpc';

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setPreset, setMode, setBgUrl, uploadBg } = useTheme();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const r2Ready = isR2ConfiguredClient();
  const toast = useToast();
  const utils = trpc.useUtils();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // C-10: focus trap — dialog 打开时聚焦到 dialog，关闭时还原焦点
  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  async function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadBg(f);
      if (url) toast.success('背景图已保存');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleRemoveBg() {
    try {
      const res = await fetch('/api/upload/bg', { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `删除失败 (${res.status})`);
      }
      setBgUrl(null);
      // C-02: invalidate preferences cache 以清除远程脏数据
      utils.preferences.get.invalidate();
      toast.info('已移除背景');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="主题设置"
        className={
          'inline-flex items-center rounded-md border bg-card transition hover:bg-accent ' +
          (compact ? 'p-2' : 'gap-1.5 px-2.5 py-1.5 text-xs')
        }
        title="主题设置"
      >
        <span
          className={'rounded-full border border-border shadow-inner ' + (compact ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5')}
          style={{ background: 'hsl(var(--accent))' }}
        />
        {!compact && '主题'}
      </button>

      {/* C-10: 用原生 <dialog> 替代 div 覆盖层，自动获得 focus trap + backdrop click close */}
      <dialog
        ref={dialogRef}
        className="m-auto rounded-xl border surface-elevated p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm animate-slide-down"
        onClick={(e) => { if (e.target === dialogRef.current) setOpen(false); }}
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
      >
        <div
          className="flex max-h-[88vh] w-full max-w-2xl flex-col animate-slide-down mx-4 sm:mx-0"
          onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
              <h2 className="text-base font-semibold">主题设置</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconX size={16} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {/* 模式 */}
              <section>
                <div className="mb-2 text-xs font-medium">外观</div>
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as StoredTheme['mode'][]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition ' +
                        (theme.mode === m
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'hover:bg-accent')
                      }
                    >
                      {m === 'light' ? (
                        <IconSun size={12} />
                      ) : m === 'dark' ? (
                        <IconMoon size={12} />
                      ) : (
                        <IconDeviceLaptop size={12} />
                      )}
                      {m === 'light' ? '浅色' : m === 'dark' ? '暗色' : '跟随系统'}
                    </button>
                  ))}
                </div>
              </section>

              {/* 预设 */}
              <section>
                <div className="mb-2 text-xs font-medium">预设</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PRESET_LIST.map((p) => (
                    <PresetCard
                      key={p.preset}
                      preset={p.preset}
                      name={p.name}
                      description={p.description}
                      active={theme.preset === p.preset}
                      onSelect={() => setPreset(p.preset)}
                    />
                  ))}
                </div>
              </section>

              {/* DIY 强调色 */}
              <section>
                <AccentPicker />
              </section>

              {/* 背景图 */}
              <section>
                <div className="mb-2 flex items-center justify-between text-xs font-medium">
                  <span>背景图</span>
                  {theme.bgUrl && (
                    <span className="text-[10px] text-muted-foreground">已上传</span>
                  )}
                </div>
                {theme.bgUrl ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="h-12 w-20 rounded-md border bg-cover bg-center"
                      style={{ backgroundImage: `url("${theme.bgUrl}")` }}
                    />
                    <button
                      type="button"
                      onClick={handleRemoveBg}
                      className="text-xs text-destructive hover:underline"
                    >
                      移除背景
                    </button>
                  </div>
                ) : r2Ready ? (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-xs transition hover:bg-accent">
                    <IconPhoto size={12} />
                    {uploading ? '上传中…' : '选择图片 (≤ 5MB)'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleBgUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                  </label>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                    <IconAlertTriangle size={14} className="mt-px shrink-0 text-muted-foreground" />
                    <div>
                      云存储未配置，无法上传图片。如需自定义背景图，请在 .env 中配置 R2 凭据后重启服务。
                    </div>
                  </div>
                )}
              </section>
            </div>

            <div className="shrink-0 border-t px-5 py-3 text-right">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                完成
              </button>
            </div>
          </div>
        </dialog>
    </>
  );
}

function PresetCard({
  preset,
  name,
  description,
  active,
  onSelect,
}: {
  preset: ThemePreset;
  name: string;
  description: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'group relative rounded-md border p-2.5 text-left transition ' +
        (active
          ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'hover:border-foreground/20')
      }
    >
      {/* Mini UI 预览：模拟卡片/文本框/按钮 */}
      <MiniPreview preset={preset} />
      <div className="mt-2 flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{name}</div>
          <div className="truncate text-[10px] text-muted-foreground">{description}</div>
        </div>
        {active && <IconCheck size={12} className="shrink-0 text-primary" />}
      </div>
    </button>
  );
}

/**
 * Mini UI 预览：用预设的调色板画一个迷你 app 界面（顶栏 + 文本 + 按钮）。
 * 让用户一眼看到主题的整体观感，而不是只看到两条渐变。
 */
function MiniPreview({ preset }: { preset: ThemePreset }) {
  const t = PRESETS[preset].light;
  return (
    <div
      className="h-16 rounded-md border overflow-hidden relative"
      style={{ background: t.background }}
    >
      {/* 顶栏 */}
      <div
        className="absolute inset-x-0 top-0 flex h-3.5 items-center gap-1 border-b px-1.5"
        style={{ background: t.surface, borderColor: t.border }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: t.mutedForeground }}
        />
        <span
          className="h-1.5 w-8 rounded-sm"
          style={{ background: t.mutedForeground, opacity: 0.4 }}
        />
      </div>
      {/* 卡片 */}
      <div
        className="absolute left-1.5 right-1.5 top-5 h-3 rounded-sm border"
        style={{ background: t.surfaceElevated, borderColor: t.border }}
      >
        <div
          className="absolute left-1 top-1 h-0.5 w-4 rounded-sm"
          style={{ background: t.foreground, opacity: 0.7 }}
        />
        <div
          className="absolute left-1 bottom-1 h-0.5 w-6 rounded-sm"
          style={{ background: t.mutedForeground, opacity: 0.5 }}
        />
      </div>
      {/* 按钮 */}
      <div
        className="absolute bottom-1.5 right-1.5 h-2.5 w-5 rounded-sm"
        style={{ background: `hsl(${t.accent})` }}
      />
    </div>
  );
}