/**
 * Prism.js ambient 类型声明
 *
 * prismjs 1.30.x 的官方 @types/prismjs 在某些版本下未正确导出 dynamic import 类型。
 * 本文件为 CodeBlock 组件提供最小化类型声明。
 */

declare module 'prismjs' {
  // 我们的 use case 仅用 highlightElement，其他字段留 any
  const Prism: {
    highlightElement(el: Element): void;
    languages: Record<string, unknown>;
    [key: string]: unknown;
  };
  export default Prism;
  export = Prism;
}

// prismjs/components/* 子模块默认导出 undefined（副作用：注册语言）
declare module 'prismjs/components/prism-typescript';
declare module 'prismjs/components/prism-tsx';
declare module 'prismjs/components/prism-jsx';
declare module 'prismjs/components/prism-python';
declare module 'prismjs/components/prism-go';
declare module 'prismjs/components/prism-rust';
declare module 'prismjs/components/prism-java';
declare module 'prismjs/components/prism-css';
declare module 'prismjs/components/prism-sql';
declare module 'prismjs/components/prism-bash';
declare module 'prismjs/components/prism-yaml';
declare module 'prismjs/components/prism-json';
declare module 'prismjs/components/prism-markdown';
declare module 'prismjs/components/prism-c';
declare module 'prismjs/components/prism-cpp';
declare module 'prismjs/components/prism-csharp';
declare module 'prismjs/components/prism-markup';
declare module 'prismjs/components/prism-dockerfile';
