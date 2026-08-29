/** @type {import('next').NextConfig} */
// C30：兼容 Next.js 14.x (experimental) 与 15.x (顶层字段)
// 14.2 仍用 experimental.serverComponentsExternalPackages；升级到 15 后迁移到顶层 serverExternalPackages。
// 这里采用运行时检测自动选择
const pkg = require('next/package.json');
const major = parseInt(pkg.version.split('.')[0], 10);
const prismaPkgs = ['@prisma/client', 'prisma'];

const nextConfig = major >= 15
  ? {
      // 15.x：顶层字段
      serverExternalPackages: prismaPkgs,
    }
  : {
      // 14.x：experimental 嵌套
      experimental: {
        serverComponentsExternalPackages: prismaPkgs,
      },
    };

module.exports = nextConfig;