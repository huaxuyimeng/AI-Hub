'use client';

/**
 * CodeBlock — VSCode 风格语法高亮的代码块
 *
 * 实现策略：
 *   - 客户端动态 import prismjs（避免 SSR 报错 + 减小初始 bundle）
 *   - 同时按需加载语言组件（jsx/tsx/python/go/rust/sql...）
 *   - 主题：light 用 prism（VSCode 默认），dark 用 prism-tomorrow（VSCode Dark+ 同款）
 *   - 高亮在 useEffect 中执行（Prism 标记 DOM）
 *
 * 性能：
 *   - 首次加载 ~6KB（prism 核心 + JS/TS）
 *   - 后续加载其他语言组件按需
 *   - Prism 标记是不可逆的（修改 innerHTML），所以用 mounted flag 控制
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { IconCopy, IconCheck } from '@tabler/icons-react';

export type SupportedLanguage =
  | 'javascript' | 'typescript' | 'tsx' | 'jsx'
  | 'json' | 'css' | 'html' | 'xml' | 'markdown'
  | 'python' | 'go' | 'rust' | 'java' | 'c' | 'cpp' | 'csharp'
  | 'sql' | 'bash' | 'shell' | 'yaml' | 'dockerfile'
  | 'plaintext';

interface Props {
  code: string;
  /** 语言（Prisma 存的是 string|null|undefined，组件都接受） */
  language?: SupportedLanguage | string | null | undefined;
  /** 显示文件名（顶部 tab 风格） */
  filename?: string;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 截断行数（默认不截断）；超出后显示 "… 还有 N 行" */
  maxLines?: number;
  /** className 覆盖外层容器 */
  className?: string;
}

// Prism 动态加载的语言映射（按需）
// 注：用 /* webpackIgnore: true */ + 字符串拼接绕过 webpack 静态分析，
//     因为 prismjs 子模块不在 package.json "exports" 里，webpack 解析不到。
//     它们在浏览器运行时通过 dynamic import 正常加载。
const SUPPORTED_LANGS = [
  'typescript', 'tsx', 'jsx',
  'python', 'go', 'rust', 'java',
  'css', 'sql',
  'bash', 'yaml', 'json', 'markdown',
  'c', 'cpp', 'csharp', 'markup',
  'dockerfile',
] as const;

type LanguageId = (typeof SUPPORTED_LANGS)[number];

const LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = Object.fromEntries(
  SUPPORTED_LANGS.map((lang) => [
    lang,
    // B-03 修复：去掉 /* webpackIgnore: true */，让 webpack 正常打包 prism 语言组件。
    // 之前用 webpackIgnore 是想"绕过" Next.js SSR 报错，但副作用是浏览器原生 import
    // 解析不到 bare specifier 'prismjs/components/prism-typescript' → Failed to resolve。
    // 现在用 'use client' + 在 useEffect 内动态 import，SSR 不执行，webpack 客户端打包正确。
    () => import(`prismjs/components/prism-${lang}`),
  ]),
);

const PRISM_LANG_MAP: Record<string, string> = {
  javascript: 'javascript',
  js: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  python: 'python',
  py: 'python',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  css: 'css',
  sql: 'sql',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  cs: 'csharp',
  html: 'markup',
  xml: 'markup',
  dockerfile: 'dockerfile',
  plaintext: 'none',
};

let prismRef: Prism | null = null;

interface Prism {
  highlightElement: (el: Element) => void;
  languages: Record<string, unknown>;
  [key: string]: unknown;
}

async function loadPrism(lang: string): Promise<Prism> {
  if (prismRef) return prismRef;
  // B-03 修复：去掉 /* webpackIgnore: true */，让 webpack 客户端 bundle 处理。
  // 客户端 useEffect 内动态 import，避免 SSR 阶段执行。
  const mod = await import('prismjs');
  prismRef = mod as unknown as Prism;
  // 加载语言组件（必须在 Prism.highlight 之前）
  if (LANGUAGE_LOADERS[lang]) {
    await LANGUAGE_LOADERS[lang]();
  }
  return prismRef;
}

export function CodeBlock({
  code,
  language = 'plaintext',
  filename,
  showLineNumbers = false,
  maxLines,
  className = '',
}: Props) {
  const codeRef = useRef<HTMLElement>(null);
  // B-12 修复：用 ref 追踪 setTimeout 句柄，组件卸载时清理，避免在卸载后调用 setCopied。
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const [highlightError, setHighlightError] = useState<string | null>(null);

  // 卸载时清理未触发的 timer
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // 规范化语言名
  const rawLang = (language ?? 'plaintext').toString().toLowerCase();
  const normalizedLang = PRISM_LANG_MAP[rawLang] ?? 'none';
  const displayLang = rawLang;

  // 截断行
  const lines = code.split('\n');
  const truncated = maxLines && lines.length > maxLines;
  const displayCode = truncated ? lines.slice(0, maxLines).join('\n') : code;
  const remaining = truncated ? lines.length - maxLines! : 0;

  useEffect(() => {
    if (!codeRef.current || highlighted) return;
    if (normalizedLang === 'none' || normalizedLang === 'plaintext') {
      // 不需要高亮，直接显示
      setHighlighted(true);
      return;
    }

    let cancelled = false;
    loadPrism(normalizedLang).then((Prism) => {
      if (cancelled || !codeRef.current) return;
      Prism.highlightElement(codeRef.current);
      setHighlighted(true);
    }).catch((err) => {
      // B-01 修复：从 console.warn 升级为 console.error 并展示横幅
      // 原因：之前 warn + 静默 setHighlighted(true) 导致 prism 加载失败时用户看不到任何提示，
      //       难以排查"代码块全是一种颜色"这种 Bug（详见 2026-09-09 复盘）。
      console.error(`[CodeBlock] Prism 加载失败 (${normalizedLang})，语法高亮不可用：`, err);
      setHighlighted(true);
      setHighlightError(err instanceof Error ? err.message : String(err));
    });

    return () => { cancelled = true; };
  }, [normalizedLang, highlighted]);

  const handleCopy = async () => {
    // B-12 修复：timer 句柄存到 ref，组件卸载时清理（避免卸载后 setCopied 触发警告）
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    const doScheduleReset = () => {
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1500);
    };
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      doScheduleReset();
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        doScheduleReset();
      } catch (err) {
        // B-12 修复：execCommand 失败也要提示用户
        console.warn('[CodeBlock] 复制失败：', err);
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <div className={`group relative overflow-hidden rounded-md border border-border bg-[var(--code-bg,#0d1117)] ${className}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          {filename ? (
            <span className="font-medium text-foreground/80">{filename}</span>
          ) : (
            <span className="text-muted-foreground">{displayLang}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          aria-label="复制代码"
        >
          {copied ? (
            <>
              <IconCheck size={12} className="text-success" />
              <span className="text-success">已复制</span>
            </>
          ) : (
            <>
              <IconCopy size={12} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* B-01 修复：高亮失败时显示横幅，方便排查 */}
      {highlightError && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          语法高亮加载失败，已显示原始代码（{highlightError.slice(0, 80)}）
        </div>
      )}

      {/* Code body */}
      <pre
        className={`overflow-auto p-4 text-xs leading-relaxed ${
          showLineNumbers ? 'line-numbers' : ''
        }`}
        style={{
          color: 'var(--code-fg,#e6edf3)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        } as CSSProperties}
      >
        <code
          ref={codeRef}
          className={`language-${normalizedLang === 'none' ? 'plaintext' : normalizedLang}`}
        >
          {displayCode}
        </code>
        {truncated && (
          <div className="mt-2 border-t border-border/30 pt-2 text-muted-foreground italic">
            … 还有 {remaining} 行（未显示）
          </div>
        )}
      </pre>
    </div>
  );
}
