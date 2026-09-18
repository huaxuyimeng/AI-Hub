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
      bgOpacity: row.bgImageOpacity,
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
      bgOpacity: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const data: {
        themePreset?: string;
        themeMode?: string;
        accentHsl?: string | null;
        bgImageUrl?: string | null;
        bgImageOpacity?: number;
      } = {};
      if (input.preset) data.themePreset = input.preset;
      if (input.mode) data.themeMode = input.mode;
      if ('accent' in input) data.accentHsl = serializeAccent(input.accent ?? null);
      if ('bgUrl' in input) data.bgImageUrl = input.bgUrl ?? null;
      if (typeof input.bgOpacity === 'number') data.bgImageOpacity = input.bgOpacity;

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
          bgImageOpacity: data.bgImageOpacity ?? 0.35,
        },
      });

      // 返回新主题
      return {
        preset: validatePreset(row.themePreset),
        mode: row.themeMode === 'light' || row.themeMode === 'dark' ? row.themeMode : ('system' as const),
        accent: parseAccent(row.accentHsl),
        bgUrl: row.bgImageUrl,
        bgOpacity: row.bgImageOpacity,
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

  /**
   * 更新新闻/排行设置
   * 来源：整合 plan §3.4 设置页扩展
   */
  updateNewsSettings: protectedProcedure
    .input(z.object({
      newsRefreshInterval: z.number().int().min(1).max(24).optional(),
      newsCategories: z.array(z.string()).optional(),
      newsSources: z.array(z.string()).optional(),
      followedModels: z.array(z.string()).optional(),
      priceAlertThreshold: z.number().min(0).max(100).nullable().optional(),
      briefingToast: z.boolean().optional(),
      briefingWindowHour: z.number().int().min(0).max(23).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.newsRefreshInterval !== undefined) data.newsRefreshInterval = input.newsRefreshInterval;
      if (input.newsCategories !== undefined) data.newsCategories = input.newsCategories.join(',');
      if (input.newsSources !== undefined) data.newsSources = input.newsSources.join(',');
      if (input.followedModels !== undefined) data.followedModels = input.followedModels.join(',');
      if (input.priceAlertThreshold !== undefined) data.priceAlertThreshold = input.priceAlertThreshold;
      if (input.briefingToast !== undefined) data.briefingToast = input.briefingToast;
      if (input.briefingWindowHour !== undefined) data.briefingWindowHour = input.briefingWindowHour;

      await prismaBase.userPreferences.upsert({
        where: { userId: ctx.session.user.id },
        update: data,
        create: {
          userId: ctx.session.user.id,
          tenantId: ctx.tenantId!,
          newsRefreshInterval: input.newsRefreshInterval ?? 3,
          newsCategories: input.newsCategories?.join(',') ?? '',
          newsSources: input.newsSources?.join(',') ?? '',
          followedModels: input.followedModels?.join(',') ?? '',
          priceAlertThreshold: input.priceAlertThreshold,
          briefingToast: input.briefingToast ?? true,
          briefingWindowHour: input.briefingWindowHour ?? 8,
        },
      });

      return { ok: true };
    }),

  /**
   * 获取新闻/排行设置
   */
  getNewsSettings: protectedProcedure.query(async ({ ctx }) => {
    const row = await prismaBase.userPreferences.findUnique({
      where: { userId: ctx.session.user.id },
      select: {
        newsRefreshInterval: true,
        newsCategories: true,
        newsSources: true,
        followedModels: true,
        priceAlertThreshold: true,
        briefingToast: true,
        briefingWindowHour: true,
      },
    });

    return {
      newsRefreshInterval: row?.newsRefreshInterval ?? 3,
      newsCategories: row?.newsCategories ? row.newsCategories.split(',').filter(Boolean) : [],
      newsSources: row?.newsSources ? row.newsSources.split(',').filter(Boolean) : [],
      followedModels: row?.followedModels ? row.followedModels.split(',').filter(Boolean) : [],
      priceAlertThreshold: row?.priceAlertThreshold ?? null,
      briefingToast: row?.briefingToast ?? true,
      briefingWindowHour: row?.briefingWindowHour ?? 8,
    };
  }),

  // ── AI 对话风格 ────────────────────────────────────────────────────────

  /** 获取聊天风格（用于 chat.ts 注入 + 设置页展示） */
  getChatStyle: protectedProcedure.query(async ({ ctx }) => {
    const row = await prismaBase.userPreferences.findUnique({
      where: { userId: ctx.session.user.id },
      select: {
        chatPresetStyle: true,
        chatOpeningLine: true,
        chatPersonaRole: true,
        chatCustomRules: true,
        chatResponseLang: true,
        chatReasoningDepth: true,
        chatStyleOnboarded: true,
      },
    });
    return {
      chatPresetStyle: row?.chatPresetStyle ?? 'friendly',
      chatOpeningLine: row?.chatOpeningLine ?? null,
      chatPersonaRole: row?.chatPersonaRole ?? null,
      chatCustomRules: row?.chatCustomRules ?? '',
      chatResponseLang: row?.chatResponseLang ?? 'auto',
      chatReasoningDepth: row?.chatReasoningDepth ?? 'normal',
      chatStyleOnboarded: row?.chatStyleOnboarded ?? false,
    };
  }),

  /** 更新聊天风格（sanitize 后 upsert） */
  updateChatStyle: protectedProcedure
    .input(z.object({
      chatPresetStyle: z.enum(['rigorous', 'humorous', 'friendly', 'concise', 'literary']).optional(),
      chatOpeningLine: z.string().max(500).nullable().optional(),
      chatPersonaRole: z.string().max(500).nullable().optional(),
      chatCustomRules: z.string().max(2000).optional(),
      chatResponseLang: z.enum(['zh', 'en', 'auto']).optional(),
      chatReasoningDepth: z.enum(['normal', 'detailed', 'none']).optional(),
      chatStyleOnboarded: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.chatPresetStyle !== undefined) data.chatPresetStyle = input.chatPresetStyle;
      if (input.chatOpeningLine !== undefined) data.chatOpeningLine = input.chatOpeningLine ?? null;
      if (input.chatPersonaRole !== undefined) data.chatPersonaRole = input.chatPersonaRole ?? null;
      if (input.chatCustomRules !== undefined) data.chatCustomRules = input.chatCustomRules;
      if (input.chatResponseLang !== undefined) data.chatResponseLang = input.chatResponseLang;
      if (input.chatReasoningDepth !== undefined) data.chatReasoningDepth = input.chatReasoningDepth;
      if (input.chatStyleOnboarded !== undefined) data.chatStyleOnboarded = input.chatStyleOnboarded;

      const row = await prismaBase.userPreferences.upsert({
        where: { userId: ctx.session.user.id },
        update: data,
        create: {
          userId: ctx.session.user.id,
          tenantId: ctx.tenantId!,
          chatPresetStyle: (input.chatPresetStyle ?? 'friendly') as string,
          chatOpeningLine: input.chatOpeningLine ?? null,
          chatPersonaRole: input.chatPersonaRole ?? null,
          chatCustomRules: (input.chatCustomRules ?? '') as string,
          chatResponseLang: (input.chatResponseLang ?? 'auto') as string,
          chatReasoningDepth: (input.chatReasoningDepth ?? 'normal') as string,
          chatStyleOnboarded: (input.chatStyleOnboarded ?? false) as boolean,
        },
      });

      return {
        chatPresetStyle: row.chatPresetStyle,
        chatOpeningLine: row.chatOpeningLine,
        chatPersonaRole: row.chatPersonaRole,
        chatCustomRules: row.chatCustomRules,
        chatResponseLang: row.chatResponseLang,
        chatReasoningDepth: row.chatReasoningDepth,
        chatStyleOnboarded: row.chatStyleOnboarded,
      };
    }),

  // ── AI 代码评审提示词（可自定义） ──────────────────────────────────────

  /** 获取当前评审提示词（null = 使用 deep-code-audit 默认规则） */
  getAnalysisPrompt: protectedProcedure.query(async ({ ctx }) => {
    const row = await prismaBase.userPreferences.findUnique({
      where: { userId: ctx.session.user.id },
      select: { analysisPrompt: true },
    });
    return { prompt: row?.analysisPrompt ?? null };
  }),

  /** 更新评审提示词（传入 null = 恢复默认） */
  updateAnalysisPrompt: protectedProcedure
    .input(z.object({ prompt: z.string().max(8000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await prismaBase.userPreferences.upsert({
        where: { userId: ctx.session.user.id },
        update: { analysisPrompt: input.prompt },
        create: {
          userId: ctx.session.user.id,
          tenantId: ctx.tenantId!,
          analysisPrompt: input.prompt,
        },
      });
      return { ok: true };
    }),

  // ── AI 代码评审 8 维度权重（可自定义） ──────────────────────────────

  /** 获取评审 8 维度权重（null = 用 DEFAULT_CATEGORIES 默认权重） */
  getCategoryWeights: protectedProcedure.query(async ({ ctx }) => {
    const row = await prismaBase.userPreferences.findUnique({
      where: { userId: ctx.session.user.id },
      select: { categoryWeights: true },
    });
    // 容错解析（失败视为未配置）
    if (!row?.categoryWeights) return { weights: null };
    try {
      const parsed = JSON.parse(row.categoryWeights);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { weights: null };
      return { weights: parsed as Record<string, number> };
    } catch {
      return { weights: null };
    }
  }),

  /**
   * 更新评审 8 维度权重。
   * weights = null 表示恢复默认；其他情况必须是 8 个 key 的对象，值 ∈ [0, 1]
   */
  updateCategoryWeights: protectedProcedure
    .input(z.object({
      weights: z.record(z.number().min(0).max(1)).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      await prismaBase.userPreferences.upsert({
        where: { userId: ctx.session.user.id },
        update: { categoryWeights: input.weights ? JSON.stringify(input.weights) : null },
        create: {
          userId: ctx.session.user.id,
          tenantId: ctx.tenantId!,
          categoryWeights: input.weights ? JSON.stringify(input.weights) : null,
        },
      });
      return { ok: true, weights: input.weights };
    }),
});