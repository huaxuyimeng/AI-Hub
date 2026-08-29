// PostCSS 配置：Tailwind v3 通过 PostCSS 编译 globals.css 里的 @tailwind 指令
// 缺失此文件 = Tailwind 不生效 = @tailwind 不展开 = body 显示成纯白无样式
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};