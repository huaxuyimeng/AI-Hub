---
name: addParser
description: 新增新闻解析器到 @aihub/news 包的 parsers/ 目录。在用户提到「加个新闻源」「接入 Reddit」「支持 HackerNews 之类」时必须触发。绝不直接写 parser.ts——必须先调研源结构（HTML/RSS/API）并产出协议分析报告。
---

# Add Parser Skill

## 1. 调用流程（严格顺序）

### Phase 1：源调研（必做）

1. 抓取源首页 + 列表页 + 详情页
2. 列出可解析字段：title / url / publishedAt / summary / coverUrl / author / tags
3. 判定源类型：RSS / HTML / JSON API
4. 列出限流与反爬机制（UA / cookie / IP 限流 / Cloudflare）

### Phase 2：协议分析报告

输出 5 段：

1. **源类型**：RSS / HTML / API / 混合
2. **抓取频率建议**：每 cron 一次 / 每 6 小时 / 每天
3. **解析策略**：正则 / cheerio / JSON.parse
4. **降级方案**：抓取失败时回退到 RSSHub 实例
5. **测试数据**：附 5 条典型样本（含日期变体）

### Phase 3：实施

- 文件 `packages/news/src/infra/parsers/<name>.ts`
- 实现 `Parser` 接口（types.ts）
- 注册到 `parsers/index.ts`
- 加源定义到 `infra/sources.ts`（厂家字典若需要）

## 2. 边界规则

- ❌ parser **严禁** import `../service`（防循环）
- ✅ parser 输出 `ParsedItem[]`
- ✅ 抓取失败返回 `{ items: [], errors: [...] }`

## 3. 验收清单

- [ ] 单测覆盖 5 条样本（含 HTML 实体、日期格式、空字段）
- [ ] 抓取超时 ≤ 10s
- [ ] 单测不依赖网络（mock fetch）
- [ ] 与 service.ts 集成后无循环依赖

## 4. 过期条件

- 源改版（HTML 结构变化）
- 源限流变更（需要 IP 池）

---

**创建时间**：2026-09-07
