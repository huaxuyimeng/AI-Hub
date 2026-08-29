'use client';

// 来源：.cursor/skills/workbench-ui-designer/SKILL.md §6.1
// 双层持久化：localStorage（即时）+ tRPC preferences（远程，跨设备）

import * as React from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc';
import {
  type StoredTheme,
  type ThemePreset,
  type AccentHSL,
  readStoredTheme,
  writeStoredTheme,
  buildTokens,
  DEFAULT_THEME,
} from '@/lib/themes';

interface ThemeContextValue {
  theme: StoredTheme;
  setPreset: (p: ThemePreset) => void;
  setMode: (m: StoredTheme['mode']) => void;
  setAccent: (a: AccentHSL | null) => void;
  setBgUrl: (url: string | null) => void;
  reset: () => void;
  /** 上传背景图到 R2 并写 UserPreferences */
  uploadBg: (file: File) => Promise<string | null>;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function getSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeVars(theme: StoredTheme) {
  if (typeof document === 'undefined') return;
  const effective = theme.mode === 'system' ? getSystemMode() : theme.mode;
  const root = document.documentElement;

  root.classList.toggle('dark', effective === 'dark');

  const tokens = buildTokens(theme.preset, theme.accent);
  const palette = effective === 'dark' ? tokens.dark : tokens.light;
  for (const [k, v] of Object.entries(palette)) {
    root.style.setProperty(k, v);
  }

  root.dataset.preset = theme.preset;

  if (theme.bgUrl) {
    root.style.setProperty('--bg-image', `url("${theme.bgUrl}")`);
    // V-03: 背景图 class 挂到 body，避免 ::before z-index: -1 与 dialog 冲突
    document.body.classList.add('has-bg-image');
  } else {
    root.style.removeProperty('--bg-image');
    document.body.classList.remove('has-bg-image');
  }
}

const NOOP_FN = () => {};
const STUB: ThemeContextValue = {
  theme: DEFAULT_THEME,
  setPreset: NOOP_FN,
  setMode: NOOP_FN,
  setAccent: NOOP_FN,
  setBgUrl: NOOP_FN,
  reset: NOOP_FN,
  uploadBg: async () => null,
};

export function ThemeProvider({
  children,
  defaultTheme,
}: {
  children: React.ReactNode;
  defaultTheme?: StoredTheme;
}) {
  const [theme, setThemeState] = React.useState<StoredTheme>(defaultTheme ?? DEFAULT_THEME);
  const remoteSyncRef = React.useRef(false); // 防止本地 update 与 remote sync 互踩
  const writeRemoteTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { status } = useSession();
  const utils = trpc.useUtils();
  const remoteTheme = trpc.preferences.get.useQuery(undefined, {
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
  const updateThemeMut = trpc.preferences.updateTheme.useMutation();

  // 1. hydrate localStorage
  React.useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyThemeVars(stored);
  }, []);

  // 2. apply theme whenever state changes
  React.useEffect(() => {
    applyThemeVars(theme);
  }, [theme]);

  // 3. 系统主题变化（mode === 'system'）
  React.useEffect(() => {
    if (theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeVars(theme);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // 4. 登录后用服务器主题覆盖 localStorage（仅一次，且服务端 > 客户端）
  // C-03: 用 ref 标记「已同步过」，避免 hasRecord 翻转前 B 设备的更新被忽略
  // 使用 ref 比较主题本身（hasRecord/bgUrl/accent 任一变化都触发）
  const lastSyncedRef = React.useRef<string>('');
  React.useEffect(() => {
    if (status !== 'authenticated' || !remoteTheme.data) return;
    const rt = remoteTheme.data.theme;
    const fingerprint = `${rt.preset}|${rt.mode}|${rt.bgUrl ?? ''}|${rt.accent ? `${rt.accent.h}/${rt.accent.s}/${rt.accent.l}` : ''}`;
    // 只有当服务端指纹与上次同步不同，或尚未同步过，才覆盖本地
    if (remoteSyncRef.current && lastSyncedRef.current === fingerprint) return;
    // 解锁条件：当前 localStorage 是默认值（用户未在客户端改动）— 让服务端覆盖
    // 否则保留本地，由 writeRemote 主动推送
    const isLocalDefault =
      theme.preset === DEFAULT_THEME.preset &&
      theme.mode === DEFAULT_THEME.mode &&
      !theme.bgUrl &&
      !theme.accent;
    if (isLocalDefault && (rt.bgUrl || rt.accent || rt.preset !== DEFAULT_THEME.preset || rt.mode !== DEFAULT_THEME.mode)) {
      setThemeState(rt);
      writeStoredTheme(rt);
      remoteSyncRef.current = true;
      lastSyncedRef.current = fingerprint;
    }
  }, [status, remoteTheme.data, theme.preset, theme.mode, theme.bgUrl, theme.accent]);

  // C-04: 记一个 generation counter，旧 mutateAsync 完成后若 generation 已变则丢弃结果
  const remoteGenRef = React.useRef(0);
  const writeRemote = React.useCallback(
    (next: StoredTheme, debounceMs = 600) => {
      if (status !== 'authenticated') return;
      if (writeRemoteTimer.current) clearTimeout(writeRemoteTimer.current);
      writeRemoteTimer.current = setTimeout(() => {
        const gen = ++remoteGenRef.current;
        updateThemeMut
          .mutateAsync({
            preset: next.preset,
            mode: next.mode,
            accent: next.accent,
            bgUrl: next.bgUrl,
          })
          .then(() => {
            // 同步成功，更新 lastSyncedRef，避免 effect #4 拿旧 refetch 覆盖
            const fingerprint = `${next.preset}|${next.mode}|${next.bgUrl ?? ''}|${next.accent ? `${next.accent.h}/${next.accent.s}/${next.accent.l}` : ''}`;
            lastSyncedRef.current = fingerprint;
            // 后续 invalidate 不要带 stale 数据
            utils.preferences.get.invalidate();
            if (gen !== remoteGenRef.current) {
              // 已被更新 — 静默丢弃
            }
          })
          .catch(() => {
            // 离线 / 网络失败：本地已保存，下次同步覆盖
          });
      }, debounceMs);
    },
    [status, updateThemeMut, utils]
  );

  const update = React.useCallback(
    (next: StoredTheme, opts?: { remoteSync?: boolean }) => {
      setThemeState(next);
      writeStoredTheme(next);
      if (opts?.remoteSync !== false) writeRemote(next);
    },
    [writeRemote]
  );

  const ctx = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setPreset: (p) => update({ ...theme, preset: p }),
      setMode: (m) => update({ ...theme, mode: m }),
      setAccent: (a) => update({ ...theme, accent: a }),
      setBgUrl: (url) => update({ ...theme, bgUrl: url }),
      reset: () => update(DEFAULT_THEME),
      uploadBg: async (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/upload/bg', { method: 'POST', body: fd });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const { url } = (await res.json()) as { url: string };
        update({ ...theme, bgUrl: url });
        utils.preferences.get.invalidate();
        return url;
      },
    }),
    [theme, update, utils]
  );

  return <ThemeContext.Provider value={ctx}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  return ctx ?? STUB;
}

/** 注入到 <head> 的 FOUC 屏蔽脚本（在 layout.tsx 内联）。 */
export const NO_FOUC_SCRIPT = `
(function() {
  try {
    var raw = localStorage.getItem('aihub-theme-v2');
    var t;
    if (raw) { t = JSON.parse(raw); }
    else {
      var old = localStorage.getItem('aihub-theme');
      if (old === 'light' || old === 'dark') {
        t = { mode: old, preset: 'paper', accent: null, bgUrl: null };
      }
    }
    if (t && t.mode === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;