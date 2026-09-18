'use client';

// 主题切换弹窗
// skill §6.1 ThemeSwitcher
//
// 2026-08-30 重设计（按用户反馈）：
//   - 「外观」section：移除"跟随系统"，第三个按钮改为「预设颜色」
//   - 「预设颜色」section 内：DIY 强调色（滑块 + 常用色）+ 壁纸（含历史）
//   - 6 个预设卡片只在 mode !== 'preset' 时显示（在「预设」section）
//   - 底部「完成」按钮保留
//
// 桌面尺寸：max-w-2xl（672px），单列纵向布局。
// 桌面尺寸 ≥ 768：DIY 滑块与预设网格左右两栏并列。
//
// 动效统一用 globals.css 的 .animate-slide-down。

import { useState, useEffect, useRef } from 'react';
import {
  IconCheck,
  IconSun,
  IconMoon,
  IconPalette,
  IconPhoto,
  IconUpload,
  IconX,
  IconTrash,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { useTheme } from '@/components/theme-provider';
import { PRESET_LIST, PRESETS, type ThemePreset } from '@/lib/themes';
import { AccentPicker } from './accent-picker';
import { GradientPalettePicker } from './gradient-palette-picker';
import { useToast } from '@/components/toast';
import { useConfirm, type ConfirmOptions } from '@/components/confirm-dialog';
import { isR2ConfiguredClient } from '@/lib/r2-client';
import { trpc } from '@/lib/trpc';

type ModeTab = 'light' | 'dark' | 'preset';

interface WallpaperItem {
  id: string;
  url: string;
  label: string;
  isActive: boolean;
  sizeBytes: number;
  contentType: string;
  opacity: number;
  createdAt: string;
}

/** 读取当前是否为暗色（client-mount 后才同步真实值，避免 SSR/CSR hydration mismatch） */
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  return dark;
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setPreset, setMode, setBgUrl, setBgOpacity, uploadBg } = useTheme();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // H-28 修复：<dialog> SSR 时输出 children，但 client 首帧 React 会因 dialog 的 a11y 行为
  //          找不到 server 渲染的 <label>/<input> 节点 → hydration mismatch。
  //          解决：用 mounted gate，让 <dialog> 只在 client 端首次 mount 后才挂载。
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const isDark = useIsDark(); // V-15：用于 PresetCard 预览跟随 dark/light
  const r2Ready = isR2ConfiguredClient();
  const toast = useToast();
  const utils = trpc.useUtils();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // C-14 修复：原生 confirm() 改用 useConfirm()，统一 UI 风格并恢复键盘可访问性
  const [askConfirm, ConfirmNode] = useConfirm();

  // 模式 tab：light | dark | preset（仅 dialog UI 用，不与 theme.mode 双向同步）
  // H-27 修复：useState 初值是"一次性快照"，theme.mode 从外部变化时（旧 ThemeToggle 等）
  // 不会再触发 modeTab 同步；改成"点击时一次性 setMode + setModeTab"，避免 useEffect
  // 异步回写造成 race / 状态机错位。
  const initialTab: ModeTab =
    theme.mode === 'dark' ? 'dark' :
    theme.mode === 'light' ? 'light' : 'preset';
  const [modeTab, setModeTab] = useState<ModeTab>(initialTab);

  // 点击 tab 时同步切 mode（替代原 useEffect）
  const handleModeTab = (tab: ModeTab) => {
    setModeTab(tab);
    if (tab === 'light' && theme.mode !== 'light') setMode('light');
    else if (tab === 'dark' && theme.mode !== 'dark') setMode('dark');
    // tab === 'preset' 不强制改 mode（保留用户当前 light/dark）
  };

  // dialog focus
  // C-15 修复：监听原生 close 事件（Safari 旧版 preventDefault 在 cancel 上不生效，
  //        只用 useEffect 手动 close 会导致 dialog 已关闭但 React state 仍 open=true）
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const onClose = () => setOpen(false);
    dlg.addEventListener('close', onClose);
    return () => dlg.removeEventListener('close', onClose);
  }, []);

  // open 状态 → showModal/close 触发
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  async function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    // 前端预校验（2026-09-10 用户反馈）：让 400 错误的真实原因立刻可见，
    // 不必等网络往返。服务端 route.ts 仍会做权威校验（防止绕过）。
    const PRE_ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!PRE_ALLOWED.includes(f.type)) {
      const ext = (f.name.split('.').pop() ?? '').toLowerCase();
      const hint =
        f.type === 'image/heic' || f.type === 'image/heif' || ext === 'heic' || ext === 'heif'
          ? 'iPhone HEIC 格式不支持，请用「照片 → 分享 → 存储为 JPEG」后再上传'
          : f.type === 'image/avif' || ext === 'avif'
          ? 'AVIF 格式暂不支持，请另存为 PNG/JPG/WebP'
          : `不支持的格式 (${f.type || '未知'})`;
      toast.error(`「${f.name}」${hint}`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const url = await uploadBg(f);
      if (url) {
        toast.success('背景图已保存');
        setBgUrl(url); // H-28: 上传成功后立即同步到 theme provider，否则背景层不会实时刷新
        utils.wallpaper.list.invalidate();
      }
    } catch (err) {
      // 2026-09-10 调试：catch 到但 toast 没出现，加 log + 强制 throw 验证
      console.error('[handleBgUpload] upload failed:', err);
      toast.error((err as Error).message || '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleRemoveActiveBg() {
    try {
      const res = await fetch('/api/upload/bg', { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        throw new Error(data.error || `删除失败 (${res.status})`);
      }
      setBgUrl(null);
      utils.preferences.get.invalidate();
      utils.wallpaper.list.invalidate();
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
          // V-11 折叠态对齐：所有折叠态按钮统一 30×30（与折叠按钮/退出按钮一致）
          'inline-flex items-center justify-center rounded-md border bg-card transition hover:bg-accent ' +
          (compact ? 'h-[30px] w-[30px] p-0' : 'gap-1.5 px-2.5 py-1.5 text-xs')
        }
        title="主题设置"
      >
        <span
          className="h-3.5 w-3.5 rounded-full border border-border shadow-inner"
          style={{ background: 'hsl(var(--accent))' }}
        />
        {!compact && '主题'}
      </button>

      {mounted && (
      <dialog
        ref={dialogRef}
        className="m-auto w-[calc(100vw-2rem)] max-w-2xl rounded-xl border surface-elevated p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm animate-slide-down"
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
        onCancel={() => {
          // C-15 修复：去掉 preventDefault()，让原生 cancel 走默认流程关闭 dialog，
          //        close 事件被上面的 effect 捕获 → setOpen(false) 同步 state
          setOpen(false);
        }}
      >
        <div
          className="flex max-h-[88vh] flex-col animate-slide-down"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
            <h2 className="text-base font-semibold">主题设置</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="关闭"
            >
              <IconX size={16} />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* 外观：浅色 / 暗色 / 预设颜色 */}
            <section>
              {/* V-14: 显式 text-foreground */}
              <div className="mb-2 text-xs font-medium text-foreground">外观</div>
              <div className="flex gap-2">
                <ModeButton
                  active={modeTab === 'light'}
                  onClick={() => handleModeTab('light')}
                  icon={<IconSun size={13} />}
                  label="浅色"
                />
                <ModeButton
                  active={modeTab === 'dark'}
                  onClick={() => handleModeTab('dark')}
                  icon={<IconMoon size={13} />}
                  label="暗色"
                />
                <ModeButton
                  active={modeTab === 'preset'}
                  onClick={() => handleModeTab('preset')}
                  icon={<IconPalette size={13} />}
                  label="预设颜色"
                />
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground">
                {modeTab === 'preset'
                  ? '在下方自定义你的强调色与壁纸'
                  : '系统模式已取消；如需自动切换，请在浏览器中设置'}
              </div>
            </section>

            {/* 预设（仅当 modeTab !== 'preset' 时显示） */}
            {modeTab !== 'preset' && (
              <section>
                {/* V-14: 显式 text-foreground */}
                <div className="mb-2 text-xs font-medium text-foreground">预设</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PRESET_LIST.map((p) => (
                    <PresetCard
                      key={p.preset}
                      preset={p.preset}
                      name={p.name}
                      description={p.description}
                      active={theme.preset === p.preset}
                      onSelect={() => setPreset(p.preset)}
                      isDark={isDark}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 预设颜色 = DIY accent + 氛围光晕 + 壁纸（含历史） */}
            {modeTab === 'preset' && (
              <section className="space-y-5">
                <div>
                  {/* V-14: 显式 text-foreground */}
                  <div className="mb-2 text-xs font-medium text-foreground">自定义强调色</div>
                  <AccentPicker />
                </div>

                <div>
                  <GradientPalettePicker />
                </div>

                <WallpaperPanel
                  r2Ready={r2Ready}
                  uploading={uploading}
                  onUpload={handleBgUpload}
                  onRemoveActive={handleRemoveActiveBg}
                  onSetBgUrl={setBgUrl}
                  onSetBgOpacity={setBgOpacity}
                  askConfirm={askConfirm}
                />
              </section>
            )}
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
      )}
      {/* C-14 修复：ConfirmNode 必须放在 dialog 外层（useConfirm 用 state 控制渲染） */}
      <ConfirmNode />
    </>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        // V-14 修复：显式指定 text-foreground（暗色模式下文字色要跟随前景色）
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium text-foreground transition ' +
        (active
          ? 'border-primary bg-primary/10 text-primary'
          : 'hover:bg-accent')
      }
    >
      {icon}
      {label}
    </button>
  );
}

function PresetCard({
  preset,
  name,
  description,
  active,
  onSelect,
  isDark,
}: {
  preset: ThemePreset;
  name: string;
  description: string;
  active: boolean;
  onSelect: () => void;
  isDark: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        // V-14 修复：显式指定 text-foreground（暗色模式文字色翻转）
        'group relative rounded-md border p-2.5 text-left text-foreground transition ' +
        (active
          ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'hover:border-foreground/20')
      }
    >
      <MiniPreview preset={preset} isDark={isDark} />
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

function MiniPreview({ preset, isDark }: { preset: ThemePreset; isDark: boolean }) {
  // V-15 修复：跟随 dark/light 切换（用 isDark 参数而非硬编码 .light）
  const t = isDark ? PRESETS[preset].dark : PRESETS[preset].light;
  // H-34 修复：surface 用不透明值（去掉 / 0.x 透明通道），
  //   解决透明 surface 透出卡片底色、文字对比度不足的问题
  const surface = t.surface.replace(/\s*\/\s*[\d.]+\s*$/, '');
  const mutedFg = t.mutedForeground.replace(/\s*\/\s*[\d.]+\s*$/, '');
  return (
    <div
      className="relative h-16 overflow-hidden rounded-md border"
      style={{ background: t.background }}
    >
      <div
        className="absolute inset-x-0 top-0 flex h-3.5 items-center gap-1 border-b px-1.5"
        style={{ background: surface, borderColor: t.border }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: mutedFg }}
        />
        <span
          className="h-1.5 w-8 rounded-sm"
          style={{ background: mutedFg, opacity: 0.4 }}
        />
      </div>
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
          style={{ background: mutedFg, opacity: 0.5 }}
        />
      </div>
      <div
        className="absolute bottom-1.5 right-1.5 h-2.5 w-5 rounded-sm"
        style={{ background: `hsl(${t.accent})` }}
      />
    </div>
  );
}

/* =========================================================================
 * 壁纸面板：当前 + 历史缩略图 + 上传
 * ========================================================================= */
function WallpaperPanel({
  r2Ready,
  uploading,
  onUpload,
  onRemoveActive,
  onSetBgUrl,
  onSetBgOpacity,
  askConfirm,
}: {
  r2Ready: boolean;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveActive: () => void;
  onSetBgUrl: (url: string) => void;
  onSetBgOpacity: (opacity: number) => void;
  askConfirm: (opts: ConfirmOptions) => Promise<boolean>;
}) {  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: wallpapers = [], isLoading } = trpc.wallpaper.list.useQuery();
  const setActiveMut = trpc.wallpaper.setActive.useMutation({
    onSuccess: (data) => {
      // H-31: 激活后立即同步 url → theme provider，背景层实时刷新
      if (data?.url) onSetBgUrl(data.url);
      if (typeof data.opacity === 'number') onSetBgOpacity(data.opacity);
      utils.wallpaper.list.invalidate();
      utils.preferences.get.invalidate();
      toast.success('已切换壁纸');
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.wallpaper.delete.useMutation({
    onSuccess: () => {
      utils.wallpaper.list.invalidate();
      utils.preferences.get.invalidate();
      toast.info('已删除壁纸');
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });
  const setOpacityMut = trpc.wallpaper.setOpacity.useMutation({
    onSuccess: (data) => {
      onSetBgOpacity(data.opacity);
      utils.wallpaper.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const clearInactiveMut = trpc.wallpaper.clearInactive.useMutation({
    onSuccess: (res) => {
      utils.wallpaper.list.invalidate();
      toast.info(`已清空 ${res.deleted} 张历史壁纸`);
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">壁纸</div>
        <div className="flex items-center gap-2">
          {wallpapers.some((w) => !w.isActive) && (
            <button
              type="button"
              onClick={() => clearInactiveMut.mutate()}
              className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title="保留当前激活的壁纸，删除其它历史"
            >
              <IconTrash size={11} className="mr-0.5 inline-block" />
              清空历史
            </button>
          )}
          {r2Ready ? (
            <label
              className={
                'inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs transition hover:bg-accent ' +
                (uploading ? 'pointer-events-none opacity-60' : '')
              }
            >
              <IconUpload size={12} />
              {uploading ? '上传中…' : '上传壁纸'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
          ) : null}
        </div>
      </div>

      {!r2Ready && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <IconAlertTriangle size={14} className="mt-px shrink-0" />
          <div>
            云存储未配置，无法上传/切换壁纸。请在 .env 中配置 R2 凭据后重启服务。
          </div>
        </div>
      )}

      {r2Ready && isLoading && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="aspect-video animate-pulse rounded-md border bg-muted/40"
            />
          ))}
        </div>
      )}

      {r2Ready && !isLoading && wallpapers.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center text-[11px] text-muted-foreground">
          <IconPhoto size={20} className="opacity-50" />
          <div>还没有壁纸</div>
          <div className="text-[10px]">点击右上角&quot;上传壁纸&quot;添加第一张</div>
        </div>
      )}

      {r2Ready && wallpapers.length > 0 && (
        <div className="space-y-3">
          {/* 壁纸网格 */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {wallpapers.map((w) => (
              <WallpaperThumb
                key={w.id}
                item={w}
                onActivate={() => setActiveMut.mutate({ id: w.id })}
                // 二次点击取消应用（2026-09-10 用户反馈）：点击已激活的图 = 移除背景
                onRemoveActive={onRemoveActive}
                onSetOpacity={(opacity) => setOpacityMut.mutate({ id: w.id, opacity })}
                askConfirm={askConfirm}
                onDelete={() => {
                  if (w.isActive) onRemoveActive();
                  deleteMut.mutate({ id: w.id });
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WallpaperThumb({
  item,
  onActivate,
  onRemoveActive,
  onSetOpacity,
  onDelete,
  askConfirm,
}: {
  item: WallpaperItem;
  onActivate: () => void;
  // 二次点击取消应用（2026-09-10 用户反馈）：点击当前激活的图 = 移除背景
  onRemoveActive: () => void;
  onSetOpacity: (opacity: number) => void;
  onDelete: () => void;
  askConfirm: (opts: ConfirmOptions) => Promise<boolean>;
}) {
  return (
    <div
      className={
        'group relative overflow-hidden rounded-md border transition ' +
        (item.isActive
          ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'hover:border-foreground/30')
      }
    >
      <button
        type="button"
        onClick={() => (item.isActive ? onRemoveActive() : onActivate())}
        className="block aspect-video w-full bg-cover bg-center"
        style={{ backgroundImage: `url("${item.url}")` }}
        aria-label={item.label || (item.isActive ? '点击取消当前壁纸' : '切换到此壁纸')}
        title={item.label || (item.isActive ? '点击取消' : '点击切换')}
      />
      {item.isActive && (
        <>
          <div className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground">
            当前
          </div>
          {/* 2026-09-09 新增：激活壁纸支持透明度调节 */}
          <div className="absolute inset-x-1 bottom-1 flex items-center gap-1">
            <span className="text-[9px] text-white/60">透</span>
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={Math.round(item.opacity * 100)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                onSetOpacity(Number(e.target.value) / 100);
              }}
              className="h-1 flex-1 cursor-pointer accent-white"
              title={`透明度 ${Math.round(item.opacity * 100)}%`}
            />
            <span className="w-5 text-right font-mono text-[9px] text-white/60">
              {Math.round(item.opacity * 100)}
            </span>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={async (e) => {
          e.stopPropagation();
          // C-14 修复：用 useConfirm() 替代原生 confirm()，统一 UI + 恢复键盘可访问性
          const ok = await askConfirm({
            title: '删除这张壁纸？',
            description: item.isActive ? '当前正在使用此壁纸' : '',
            destructive: true,
          });
          if (ok) onDelete();
        }}
        className="absolute right-1 top-1 hidden rounded bg-black/60 p-1 text-white group-hover:block hover:bg-destructive"
        aria-label="删除壁纸"
        title="删除"
      >
        <IconTrash size={11} />
      </button>
    </div>
  );
}