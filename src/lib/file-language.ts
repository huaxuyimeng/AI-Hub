// C-8 修复：根据文件扩展名推断语言（供 File.language 字段）
// 来源：github-linguist 的简化版（仅覆盖最常见的 ~30 个扩展名）

const EXT_TO_LANG: Record<string, string> = {
  // Web / TS / JS
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  svelte: 'svelte',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  // 后端语言
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  cs: 'csharp',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  hxx: 'cpp',
  php: 'php',
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-c++',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'zsh',
  ps1: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  // 数据 / 配置
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  ini: 'ini',
  conf: 'conf',
  env: 'shell',
  // 文档
  md: 'markdown',
  mdx: 'mdx',
  txt: 'text',
  rst: 'rst',
  tex: 'tex',
  // 其它
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  csv: 'csv',
  log: 'log',
};

// 一些无扩展名的特殊文件
const FILENAME_LANG: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  '.gitignore': 'gitignore',
  '.dockerignore': 'dockerignore',
  '.env': 'shell',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
};

export function languageFromPath(path: string): string | null {
  // 先按完整文件名匹配（无扩展名的情况）
  const filename = path.split('/').pop() ?? path;
  if (FILENAME_LANG[filename]) return FILENAME_LANG[filename];

  const m = filename.match(/\.([a-zA-Z0-9]+)$/);
  if (!m) return null;
  return EXT_TO_LANG[m[1].toLowerCase()] ?? null;
}

/**
 * BUG-G 修复（2026-09-06）：根据 language 推断上传时的 Content-Type
 * 之前 upload 路由硬编码 'text/plain; charset=utf-8'，导致浏览器下载 .ts/.tsx 文件
 * 时无法识别为 TypeScript。
 *
 * 查不到映射时返回 null，调用方应 fallback 到 'text/plain; charset=utf-8'。
 */
const LANG_TO_MIME: Record<string, string> = {
  typescript: 'text/typescript; charset=utf-8',
  tsx:        'text/tsx; charset=utf-8',
  javascript: 'application/javascript; charset=utf-8',
  jsx:        'text/jsx; charset=utf-8',
  vue:        'text/vue; charset=utf-8',
  svelte:     'text/svelte; charset=utf-8',
  html:       'text/html; charset=utf-8',
  css:        'text/css; charset=utf-8',
  scss:       'text/x-scss; charset=utf-8',
  sass:       'text/x-sass; charset=utf-8',
  less:       'text/x-less; charset=utf-8',
  stylus:     'text/x-stylus; charset=utf-8',
  python:     'text/x-python; charset=utf-8',
  ruby:       'text/x-ruby; charset=utf-8',
  go:         'text/x-go; charset=utf-8',
  rust:       'text/x-rust; charset=utf-8',
  java:       'text/x-java; charset=utf-8',
  kotlin:     'text/x-kotlin; charset=utf-8',
  scala:      'text/x-scala; charset=utf-8',
  csharp:     'text/x-csharp; charset=utf-8',
  cpp:        'text/x-c++; charset=utf-8',
  c:          'text/x-c; charset=utf-8',
  php:        'application/x-php; charset=utf-8',
  swift:      'text/x-swift; charset=utf-8',
  'objective-c': 'text/x-objective-c; charset=utf-8',
  'objective-c++': 'text/x-objective-c++; charset=utf-8',
  lua:        'text/x-lua; charset=utf-8',
  perl:       'text/x-perl; charset=utf-8',
  r:          'text/x-r; charset=utf-8',
  bash:       'application/x-shellscript; charset=utf-8',
  powershell: 'application/x-powershell; charset=utf-8',
  batch:      'text/x-batch; charset=utf-8',
  json:       'application/json; charset=utf-8',
  yaml:       'application/x-yaml; charset=utf-8',
  toml:       'application/toml; charset=utf-8',
  xml:        'application/xml; charset=utf-8',
  ini:        'text/plain; charset=utf-8',
  conf:       'text/plain; charset=utf-8',
  shell:      'application/x-shellscript; charset=utf-8',
  markdown:   'text/markdown; charset=utf-8',
  mdx:        'text/mdx; charset=utf-8',
  text:       'text/plain; charset=utf-8',
  rst:        'text/x-rst; charset=utf-8',
  tex:        'application/x-tex; charset=utf-8',
  sql:        'application/sql; charset=utf-8',
  graphql:    'application/graphql; charset=utf-8',
  gql:        'application/graphql; charset=utf-8',
  dockerfile: 'text/x-dockerfile; charset=utf-8',
  csv:        'text/csv; charset=utf-8',
  log:        'text/plain; charset=utf-8',
};

export function mimeFromLanguage(language: string | null | undefined): string {
  if (!language) return 'text/plain; charset=utf-8';
  return LANG_TO_MIME[language] ?? 'text/plain; charset=utf-8';
}
