// 来源：d:\1Money\design\部署运维.md §5.2 环境变量校验
// 批次 A 必修：缺失关键环境变量应 fail-fast，不允许运行时崩溃
// 批次 C28：ORPHAN_RETENTION_DAYS 校验 + 1-365 天区间
// 批次 C29 配套：env 校验后供 layout.tsx 使用，避免 NEXTAUTH_URL 缺失时崩

import { z } from 'zod';

// 空字符串视为"未设置"。开发环境 .env.local 里常用空串占位 OAuth / Redis 等，
// 让 .optional() 真正生效。
const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const envSchema = z.object({
  // 数据库
  DATABASE_URL: z.string().url(),

  // Auth
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  // AI（至少有一个）
  DEEPSEEK_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  KIMI_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),

  // 文件存储（全部 optional，空串视作未配置）
  CLOUDFLARE_R2_ACCOUNT_ID: z.preprocess(emptyToUndef, z.string().optional()),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.preprocess(emptyToUndef, z.string().optional()),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  CLOUDFLARE_R2_BUCKET: z.string().default('aihub-files'),
  CLOUDFLARE_R2_PUBLIC_URL: z.preprocess(emptyToUndef, z.string().url().optional()),

  // 缓存
  UPSTASH_REDIS_REST_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(emptyToUndef, z.string().optional()),

  // Cron（批次 B13）
  CRON_SECRET: z.string().min(16),

  // C28：孤儿文件保留天数（cleanup.ts 使用）
  ORPHAN_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),

  // V-05：USD→CNY 汇率（workbench/usage 显示用），默认 7.2
  USD_TO_CNY: z.coerce.number().min(1).max(20).default(7.2),

  // 监控
  SENTRY_DSN: z.preprocess(emptyToUndef, z.string().url().optional()),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ 环境变量校验失败：');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

if (!parsed.data.DEEPSEEK_API_KEY && !parsed.data.KIMI_API_KEY && !parsed.data.ANTHROPIC_API_KEY) {
  throw new Error('必须配置至少一个 AI Provider（DEEPSEEK_API_KEY / KIMI_API_KEY / ANTHROPIC_API_KEY）');
}

export const env: Env = parsed.data;