/**
 * Pre-paint 内联脚本
 *
 * 用途：在浏览器首次绘制之前把"页面渐变光晕"和"暗色模式"全部设置好，
 *       避免刷新时短暂出现错误的默认颜色（蓝紫青+橙色）然后再过渡到正确颜色。
 *
 * 比 NO_FOUC_SCRIPT 更进一步 —— 不仅切 .dark class，还写入：
 *   --pg-c1, --pg-c2, --pg-c3 : 渐变光晕的 3 段色（来自 aihub-gradient-palette）
 *   --pg-acc                    : 渐变中心强调色（来自 aihub-theme-v2.accent 或 preset）
 *
 * 这些变量后续会被 React 的 PageGradient 和 ThemeProvider 重写相同值，
 * 但因为写入的是同一份字符串，浏览器不会触发 transition（CSS 过渡只在
 * 计算值变化时启动），所以视觉上完全平滑。
 *
 * 注意：脚本用 JSON.stringify 把 PALETTES 和 PRESETS 序列化进去，
 *       保证首屏渲染时所有数据可用（不依赖网络、不依赖 ESM）。
 */

import { PALETTES } from './palettes/gradient-palettes';
import { PRESETS } from './themes';

/** 兼容旧的 aihub-theme 单字符串存储 */
const LEGACY_KEY = 'aihub-theme';
const THEME_KEY = 'aihub-theme-v2';
const PALETTE_KEY = 'aihub-gradient-palette';

export const PREPAINT_SCRIPT = `
(function () {
  try {
    var html = document.documentElement;
    var isDark = false;
    var theme = null;

    /* 1. 读取主题 */
    try {
      var raw = localStorage.getItem('${THEME_KEY}');
      if (raw) {
        theme = JSON.parse(raw);
        if (theme.mode === 'dark') isDark = true;
        else if (theme.mode === 'system') {
          isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
      } else {
        var old = localStorage.getItem('${LEGACY_KEY}');
        if (old === 'dark') isDark = true;
      }
    } catch (e) {
      /* 静默：首屏脚本任何异常都应让页面继续渲染，降级为默认主题 */
    }
    if (isDark) html.classList.add('dark');

    /* 2. 应用渐变调色板（PALETTES 内联） */
    var PALETTES = ${JSON.stringify(PALETTES)};
    var palName = null;
    try { palName = localStorage.getItem('${PALETTE_KEY}'); }
    catch (e) {
      /* 静默：调色板读取失败降级为 glacier */
    }
    var pal = null;
    if (palName === 'auto') {
      /* auto 模式：bootstrap 端随机选一套，保证和 React 端第一次 interval 选到的
         不是同一套也能视觉上一致（避免 2.4s 颜色过渡） */
      pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    } else {
      for (var i = 0; i < PALETTES.length; i++) {
        if (PALETTES[i].name === palName) { pal = PALETTES[i]; break; }
      }
    }
    if (!pal) pal = PALETTES[0]; /* fallback：glacier */
    var colors = isDark ? pal.dark : pal.light;
    html.style.setProperty('--pg-c1', colors[0]);
    html.style.setProperty('--pg-c2', colors[1]);
    html.style.setProperty('--pg-c3', colors[2]);

    /* 3. 应用 accent（PRESETS 内联） */
    var PRESETS = ${JSON.stringify(PRESETS)};
    var presetName = (theme && theme.preset && PRESETS[theme.preset]) ? theme.preset : 'paper';
    var tokens = PRESETS[presetName];
    var accentColor = (isDark ? tokens.dark : tokens.light).accent;
    if (theme && theme.accent) {
      var l = theme.accent.l;
      if (isDark) l = Math.max(40, l + 5);
      accentColor = 'hsl(' + theme.accent.h + ' ' + theme.accent.s + '% ' + l + '%)';
    }
    html.style.setProperty('--pg-acc', accentColor);
  } catch (e) {
    /* 静默：整个 prepaint 失败时让页面继续渲染（CSS 默认色保底） */
  }
})();
`.trim();

/** 保留旧名字，避免破坏外部引用（即使现在没人用） */
export const NO_FOUC_SCRIPT = PREPAINT_SCRIPT;