// tRPC preferences router
// skill §6.4 数据层：UserPreferences 增删改查

import { z } from 'zod';
import { router, protectedProcedure } from '../context';
import { prismaBase } from '../../lib/db';
import {
  type ThemePreset,
  type AccentHSL,
  type StoredTheme,
  DEFAULT_THEME,
  PRESETS,
} from '../../lib/themes';

const ThemeModeSchema = z.enum(['light', 'dark', 'system']);
const SidebarModeSchema = z.enum(['expanded', 'collapsed']);

function validatePreset(p: string): ThemePreset {
  if (p in PRESETS) return p as ThemePreset;
  return 'paper';
}

function parseAccent(s: string | null): AccentHSL | null {
  if (!s) return null;
  // 形如 "65 75% 55%"
  const m = s.match(/^\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/);
  if (!m) return null;
  const h = Number(m[1]);
  const sa = Number(m[2]);
  const l = Number(m[3]);
  if (h < 0 || h > 360 || sa < 0 || sa > 100 || l < 0 || l > 100) return null;
  return { h, s: sa, l };
}

function serializeAccent(a: AccentHSL | null): string | null {
  if (!a) return null;
  return `${a.h} ${a.s}% ${a.l}%`;
}

export const preferencesRouter = router({
  /** 当前用户的所有偏好 */
  get: protectedProcedure.query(async ({ ctx }) => {
    const row = await prismaBase.userPreferences.findUnique({
      where: { userId: ctx.session.user.id },
    });
    if (!row) {
      return { theme: DEFAULT_THEME, sidebarMode: 'expanded' as const, hasRecord: false };
    }
    const theme: StoredTheme = {
      preset: validatePreset(row.themePreset),
      mode: row.themeMode === 'light' || row.themeMode === 'dark' ? row.themeMode : 'system',
      accent: parseAccent(row.accentHsl),
      bgUrl: row.bgImageUrl,
    };
    return {
      theme,
      sidebarMode: row.sidebarMode === 'collapsed' ? ('collapsed' as const) : ('expanded' as const),
      hasRecord: true,
    };
  }),

  /** 整体更新主题（一次写所有字段，避免 N+1 写入） */
  updateTheme: protectedProcedure
    .input(z.object({
      preset: z.enum(['paper', 'ink', 'mint', 'lavender', 'amber', 'ocean']).optional(),
      mode: ThemeModeSchema.optional(),
      accent: z.object({
        h: z.number().int().min(0).max(360),
        s: z.number().min(0).max(100),
        l: z.number().min(0).max(100),
      }).nullable().optional(),
      bgUrl: z.string().url().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const data: {
        themePreset?: string;
        themeMode?: string;
        accentHsl?: string | null;
        bgImageUrl?: string | null;
      } = {};
      if (input.preset) data.themePreset = input.preset;
      if (input.mode) data.themeMode = input.mode;
      if ('accent' in input) data.accentHsl = serializeAccent(input.accent ?? null);
      if ('bgUrl' in input) data.bgImageUrl = input.bgUrl ?? null;

      const row = await prismaBase.userPreferences.upsert({
        where: { userId: ctx.session.user.id },
        update: data,
        create: {
          userId: ctx.session.user.id,
          tenantId: ctx.tenantId!,
          themePreset: data.themePreset ?? 'paper',
          themeMode: data.themeMode ?? 'system',
          accentHsl: data.accentHsl ?? null,
          bgImageUrl: data.bgImageUrl ?? null,
        },
      });

      // 返回新主题
      return {
        preset: validatePreset(row.themePreset),
        mode: row.themeMode === 'light' || row.themeMode === 'dark' ? row.themeMode : ('system' as const),
        accent: parseAccent(row.accentHsl),
        bgUrl: row.bgImageUrl,
      };
    }),

  /** 侧栏折叠状态 */
  setSidebar: protectedProcedure
    .input(z.object({ mode: SidebarModeSchema }))
    .mutation(async ({ ctx, input }) => {
      await prismaBase.userPreferences.upsert({
        where: { userId: ctx.session.user.id },
        update: { sidebarMode: input.mode },
        create: {
          userId: ctx.session.user.id,
          tenantId: ctx.tenantId!,
          sidebarMode: input.mode,
        },
      });
      return { ok: true };
    }),
});