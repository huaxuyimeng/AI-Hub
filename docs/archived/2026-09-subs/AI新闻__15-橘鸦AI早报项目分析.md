# 橘鸦AI早报项目分析

> **分析日期**：2026-08-30  
> **信息来源**：用户提供 + GitHub 项目页面  
> **分析目的**：为 PPT/卡片生成功能提供参考

---

## 1. 项目概览

### 1.1 橘鸦AI早报 (juya-ai-daily)

| 属性 | 值 |
|------|-----|
| **RSS 订阅** | https://imjuya.github.io/juya-ai-daily/rss.xml |
| **GitHub** | https://github.com/imjuya/juya-ai-daily |
| **文字版存档** | https://github.com/imjuya/juya-ai-daily/tree/master/BACKUP |
| **GitHub Pages** | https://imjuya.github.io/juya-ai-daily |
| **内容形态** | 文字版 + 视频版 |

**⚠️ RSS 可用性测试（2026-08-30）**：
- **状态**：❌ 不可访问（HTTP 404）
- **测试结果**：
  - RSS 链接：404 Not Found
  - GitHub Pages 主页：404 Not Found
- **可能原因**：
  - GitHub Pages 未启用
  - 仓库为私有
  - 项目结构变更
- **当前配置**：已添加到 `sources.ts`，但设置为 `enabled: false`

**注意事项**：
- RSS 基于 GitHub Pages 分发，可能受网络环境影响
- 微信公众号仍是文字版最及时的更新渠道
- **建议**：等待项目 RSS 功能正式发布后再启用

### 1.2 视频卡片生成工具 (juya-news-card)

| 属性 | 值 |
|------|-----|
| **GitHub** | https://github.com/imjuya/juya-news-card |
| **Prompt 版本** | https://github.com/imjuya/juya-news-card/blob/main/claude-style-prompt.md |
| **核心功能** | 文字/文章 → HTML 卡片 → 图片 |
| **支持方式** | 前端预览、CLI、API |

---

## 2. 核心设计理念

### 2.1 内容优先策略

```
文字版（核心）
    ↓
视频版（基于文字版合成）
    ↓
卡片画面（HTML 渲染）
```

**关键洞察**：
1. **文字是内容的核心**，视频只是表现形式
2. 视频画面采用 HTML 生成，而非传统视频编辑
3. 适合移动端（90% 用户用手机观看），需要大字显示

### 2.2 AI 辅助布局

```
原始文本（长度不一）
    ↓ AI 提炼要点
卡片数量 + 每条字数
    ↓ AI 控制字号
居中布局
    ↓ 浏览器渲染
16:9 图片
```

**技术挑战**：
- 每条资讯文本长度不一
- 需要在 16:9 区域内完整呈现
- 成本限制：无法使用顶级模型

---

## 3. 技术方案详解

### 3.1 文字转卡片流程

```
┌─────────────────────────────────────────────────────┐
│  Step 1: AI 整理内容                                  │
│  输入：一段文字/文章                                    │
│  输出：符合格式的文本（要点提炼）                          │
├─────────────────────────────────────────────────────┤
│  Step 2: HTML 合成                                    │
│  输入：格式化文本 + 主题模板                             │
│  输出：HTML 网页（符合格式要求）                          │
├─────────────────────────────────────────────────────┤
│  Step 3: 图片渲染                                     │
│  输入：HTML 网页                                       │
│  输出：通过浏览器渲染为图片                               │
└─────────────────────────────────────────────────────┘
```

### 3.2 主题模板系统

项目中提供多种主题：
- **claudeStyle**（打磨最精细）
- 其他主题（持续完善中）

**Prompt 可分离**：
```markdown
# claude-style-prompt.md

提供一个不依赖项目的 prompt，
可在任意 AI 对话中使用，
用于生成指定样式的 HTML 网页
```

### 3.3 使用方式

| 方式 | 说明 |
|------|------|
| **前端预览** | 实时修改，直接导出 |
| **CLI** | 命令行批量处理 |
| **API** | 程序化调用 |
| **独立 Prompt** | 在任意 AI 对话中使用（可能匹配不上图标） |

---

## 4. 对 AIHub 的参考价值

### 4.1 PPT/卡片生成功能

| 参考点 | 应用场景 |
|--------|----------|
| **文字转图片** | 新闻摘要卡片生成 |
| **HTML 模板** | 可编辑的主题样式系统 |
| **AI 辅助布局** | 自动调整字号和卡片数量 |
| **多格式输出** | PNG/JPG/WebP |

### 4.2 可能的集成方案

```typescript
// 方案 1: 新闻卡片生成
async function generateNewsCard(news: NewsItem): Promise<Buffer> {
  // 1. AI 提炼要点
  const summary = await ai.summarize(news.content, { maxLength: 200 });
  
  // 2. 合成 HTML（使用模板）
  const html = renderTemplate('claudeStyle', {
    title: news.title,
    summary: summary,
    source: news.source.name,
    time: news.publishedAt,
  });
  
  // 3. 渲染为图片
  return await puppeteer.screenshot(html, { format: 'png' });
}

// 方案 2: 批量生成 PPT
async function generateNewsPPT(newsList: NewsItem[]): Promise<Buffer> {
  const cards = await Promise.all(newsList.map(generateNewsCard));
  return await combineIntoPPT(cards);
}
```

### 4.3 依赖建议

```json
{
  "dependencies": {
    "puppeteer": "^21.0.0",        // 浏览器渲染
    "html-to-image": "^1.11.0",    // 前端方案（替代）
    "playwright": "^1.40.0"        // 跨浏览器
  }
}
```

---

## 5. 实施建议

### 5.1 短期方案（MVP）

1. **复用 Prompt 方案**
   - 参考 `claude-style-prompt.md`
   - 在 AI 对话中生成 HTML
   - 手动复制到浏览器渲染

2. **集成现有工具**
   - 调用 juya-news-card API（如果公开）
   - 或 fork 项目自建

### 5.2 长期方案

1. **自建卡片生成服务**
   ```typescript
   // src/lib/card-generator/
   // ├── templates/           # HTML 模板
   // │   ├── claude-style.html
   // │   ├── dark-mode.html
   // │   └── minimal.html
   // ├── renderer.ts          # 渲染引擎
   // ├── summarizer.ts       # AI 摘要
   // └── api.ts              # REST API
   ```

2. **主题系统**
   - 支持用户自定义模板
   - 提供预设主题（学术风、科技风等）

### 5.3 技术难点

| 难点 | 可能的解决方案 |
|------|----------------|
| **字号自适应** | AI 根据内容长度预测最佳字号 |
| **跨平台兼容** | 使用 Tailwind CSS + PostCSS |
| **性能优化** | Puppeteer 冷启动慢，考虑使用 `chrome-aws-lambda` |
| **中文渲染** | 确保字体支持（Cnfonts） |

---

## 6. 项目致谢

> juya-ai-daily 基于 [yihong0618/gitblog](https://github.com/yihong0618/gitblog) 项目构建。  
> juya-news-card 项目的开源得到 **Deep Grey** 和 **JianrenJun** 的帮助和代码贡献。

---

## 7. 相关链接

### 橘鸦AI早报
- **RSS 订阅**：https://imjuya.github.io/juya-ai-daily/rss.xml
- **GitHub**：https://github.com/imjuya/juya-ai-daily
- **备份存档**：https://github.com/imjuya/juya-ai-daily/tree/master/BACKUP

### 视频卡片生成
- **GitHub**：https://github.com/imjuya/juya-news-card
- **Prompt**：https://github.com/imjuya/juya-news-card/blob/main/claude-style-prompt.md

### 参考项目
- **yihong0618/gitblog**：https://github.com/yihong0618/gitblog

---

## 8. 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2026-08-30 | 初始创建文档 |

---

**维护者**：AI Agent  
**文档版本**：v1.0
