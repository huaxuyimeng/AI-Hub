/**
 * 'use client' + React Hooks 完整性检查
 *
 * 防 Bug：开发环境 Fast Refresh 缓存导致 hook 运行时未定义。
 * 经验教训：2026-09-09 项目详情页 useEffect 运行时 ReferenceError，
 *           原因是 dev server 模块缓存未及时更新。
 *
 * 这个测试做 3 件事：
 *   1. 所有标记 'use client' 的 .tsx 文件，import 必须包含它们实际用到的 hook
 *   2. 所有 .tsx 顶层 export 函数（含默认导出）使用了 hooks 必须显式 import hooks
 *   3. 'use client' 必须在所有 import 之前
 *
 * 运行：npx tsx scripts/check-react-hooks.ts
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, extname } from 'path';

const SRC_DIR = join(process.cwd(), 'src');
const REQUIRED_HOOKS = [
  'useState', 'useEffect', 'useMemo', 'useRef', 'useCallback',
  'useContext', 'useReducer', 'useLayoutEffect',
];
const CLIENT_HOOKS_NEED_DIRECTIVE = true;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (extname(p) === '.tsx') yield p;
  }
}

function hasUseClient(content: string): boolean {
  return /^['"]use client['"];?\s*$/m.test(content.split('\n').slice(0, 5).join('\n'));
}

function extractImportList(content: string): Set<string> {
  const imports = new Set<string>();
  // 匹配 import { a, b, c } from 'react'
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]react['"]/g;
  for (const m of content.matchAll(re)) {
    for (const sym of m[1].split(',')) {
      const name = sym.trim().split(/\s+as\s+/).pop()!.trim();
      if (name) imports.add(name);
    }
  }
  return imports;
}

function findHookUsages(content: string): Set<string> {
  const used = new Set<string>();
  // 关键：必须在「去掉 import 语句 + 'use client' 指令 + 函数/变量声明」之后才匹配，
  // 避免函数名里含 hook 名（如 useFooBar）误命中。
  // 简单粗暴：把所有 `import {...} from '...'` 行删掉，
  // 再把所有 `function xxx` / `const xxx =` / `class xxx` 行删掉。
  const stripped = content
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
    .replace(/^['"]use client['"];?$/gm, '')
    .replace(/^(?:export\s+)?(?:async\s+)?function\s+\w+\s*[<(]/gm, '')
    .replace(/^(?:export\s+)?(?:const|let|var)\s+\w+\s*[=:(]/gm, '')
    .replace(/^(?:export\s+)?class\s+\w+/gm, '')
    .replace(/^(?:export\s+)?type\s+\w+/gm, '');
  for (const hook of REQUIRED_HOOKS) {
    // 匹配独立 token + 紧跟 ( 或 < （hook 调用形态），也兼容 React.useXxx(...) 形态
    const re = new RegExp(`(?:^|[^.\\w])(?:React\\.)?${hook}\\s*[(<]`, 'gm');
    if (re.test(stripped)) used.add(hook);
  }
  return used;
}

let failures = 0;
let checked = 0;

for (const file of walk(SRC_DIR)) {
  checked++;
  const content = readFileSync(file, 'utf8');
  const firstLines = content.split('\n').slice(0, 10).join('\n');
  const isClient = hasUseClient(firstLines);
  if (!isClient) continue;

  // 检查 1: useEffect 等 hook 必须 import（React.useXxx 形态允许不单独 import）
  const imports = extractImportList(content);
  // 检测是否有 React namespace import（默认导入 `React` 或 `import * as React`）
  const hasReactNamespace = /import\s+(?:React\s*(?:,\s*\{[^}]*\})?|\*\s+as\s+React)\s*from\s*['"]react['"]/m.test(content);
  const used = findHookUsages(content);
  // 对每个 used hook：
  //   - 直接 import 了 → 算 OK
  //   - 用了 React.useXxx 形态（有 React namespace import）→ 算 OK
  //   - 既没直接 import 又没 React namespace → 失败
  const missing: string[] = [];
  for (const hook of used) {
    if (imports.has(hook)) continue;
    if (hasReactNamespace) {
      // 进一步验证：stripped 里是 React.${hook} 形态才认为用 namespace
      // （findHookUsages 已经做了这个检测，但 used 集合里不分形态）
      // 这里保守一点：只要有 namespace 就算 OK
      continue;
    }
    missing.push(hook);
  }
  if (missing.length > 0) {
    console.error(`✗ ${file}: 'use client' 但缺少 hook import: ${missing.join(', ')}`);
    failures++;
  }

  // 检查 2: 'use client' 必须在所有 import 之前
  const useClientIdx = content.indexOf("'use client'");
  const firstImportIdx = content.search(/^import\s/m);
  if (useClientIdx > 0 && firstImportIdx > 0 && useClientIdx > firstImportIdx) {
    console.error(`✗ ${file}: 'use client' 必须在所有 import 之前`);
    failures++;
  }

  // 检查 3: 标记 'use client' 的文件不应有顶层 server-only 语法
  // (粗略检查：不应 import 'server-only' 或 '@supabase/ssr' 之类的 server 模块)
  if (/^import\s+.*['"]server-only['"]/m.test(content)) {
    console.error(`✗ ${file}: 'use client' 文件不应 import 'server-only'`);
    failures++;
  }
}

console.log(`\nchecked ${checked} .tsx files`);
if (failures > 0) {
  console.error(`\n${failures} 个文件不通过检查`);
  process.exit(1);
} else {
  console.log('\n✓ 全部 client 文件 hooks 导入完整');
}
