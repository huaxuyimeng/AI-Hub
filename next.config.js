/** @type {import('next').NextConfig} */
// C30：兼容 Next.js 14.x (experimental) 与 15.x (顶层字段)
// 14.2 仍用 experimental.serverComponentsExternalPackages；升级到 15 后迁移到顶层 serverExternalPackages。
// 这里采用运行时检测自动选择
const pkg = require('next/package.json');
const major = parseInt(pkg.version.split('.')[0], 10);
const prismaPkgs = ['@prisma/client', 'prisma'];
// pptxgenjs v4 是 pure ESM，jszip 也是，Next.js 14 Webpack 无法在 server bundle 里正确 resolution
const nativePkgs = ['pptxgenjs', 'jszip'];

const nextConfig = major >= 15
  ? {
      // 15.x：顶层字段
      serverExternalPackages: [...prismaPkgs, ...nativePkgs],
    }
  : {
      // 14.x：experimental 嵌套
      experimental: {
        serverComponentsExternalPackages: [...prismaPkgs, ...nativePkgs],
      },
    };

module.exports = nextConfig;