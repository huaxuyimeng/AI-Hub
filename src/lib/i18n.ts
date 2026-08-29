// I18N-01: i18n scaffold
import { COPY } from './copy';

/** 翻译函数：COPY[key] 或带插值的模板字符串 */
export function t(key: keyof typeof COPY, params?: Record<string, string | number>): string {
  const val = COPY[key];
  if (typeof val !== 'string') return String(val ?? key);
  if (!params) return val;
  return val.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
