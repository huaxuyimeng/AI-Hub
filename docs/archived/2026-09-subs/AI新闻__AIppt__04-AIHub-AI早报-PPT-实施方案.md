# AIHub AI 早报 PPT · 实施方案 v4（已实施，研究报告风格）

> 产出日期：2026-09-01
> 实施日期：2026-09-01（v2）+ 2026-09-01（v3 补丁）+ **2026-09-01（v4 完全重做）**
> 实施状态：✅ **全部完成**
>
> **v4 重大改动**：参考 `D:\1Money\AI新闻\AI日报_2026-08-29` 的研究报告风格完全重做
> - 14 页三幕叙事架构（封面 → 概览 → 两大方向索引+展开 → 验证 → 趋势 → 结尾）
> - 白底 + 4 主色系统（slate-900 / blue-500 / cyan-500 / amber-500）
> - 巨型数字视觉锚点（72-170px）
> - 全新数据模型：`heroMetrics` / `whyMatters` / `whyDoubtful` / `primaryLinks[]` / `verificationTable` / `trends[]` / `sources` 4 列
>
> 用户确认决策：
> - P0 改造范围：全部（P3 信源透明度页 + 置信度标签 + 降级版感知）
> - 置信度计算：自动（基于独立信源数量）
> - 降级下载：用户可选（.md 或 .pptx）
>
> **用户补充决策（实施中确认）：**
> - 置信度数据：复用 + 扩展（`NewsItem.confidence` 已存在，仅二分；扩展为 A/B/C/D 四级）
> - .md 路由：新增 `handleDownloadMarkdown` 纯客户端函数，无需新路由
> - URL 展示：点评框下方，直接粘贴网址（纯文本，无 HTML 标签）
> - 时间窗口：设置页面可配置整点分割时间（默认 08:00）

---

## 一、改造文件清单

| # | 文件 | 改动类型 | 说明 |
|---|---|---|---|
| 1 | `src/lib/daily-report/types.ts` | 修改 | 新增 `ConfidenceLevel` 类型、`SelectionAudit` 接口、`bySource` 字段、扩展 `ItemSchema` |
| 2 | `src/lib/daily-report/generate.ts` | 修改 | 新增 `computeConfidenceLevel()`、`isSameNews()`、`computeBySource()`；注入置信度 + bySource；`windowHour` 参数 |
| 3 | `src/lib/daily-report/build-pptx.ts` | 修改 | 新增 `addSourceTransparency()` P3 页 + `CONFIDENCE_COLORS/LABELS` 常量；修改总页数；URL 展示；柱图最小宽度 |
| 4 | `src/components/daily-report/SlidePreview.tsx` | 修改 | 新增 `SourceTransparencySlide` 组件；修改总页数；ItemSlide 新增置信度 chip + URL 预览 |
| 5 | `src/components/daily-report/BriefingPanel.tsx` | 修改 | 新增 `generateMarkdownReport()`；新增"下载 .md"按钮（仅降级版）；Markdown URL 改为纯文本 |
| 6 | `prisma/schema.prisma` | 修改 | `UserPreferences` 新增 `briefingWindowHour` 字段 |
| 7 | `src/server/routers/preferences.ts` | 修改 | `updateNewsSettings` / `getNewsSettings` 新增 `briefingWindowHour` |
| 8 | `src/app/(app)/settings/page.tsx` | 修改 | 新增"晨报/晚报分割时间"下拉选择（0~23时） |
| 9 | `src/lib/daily-report/collect.ts` | 修改 | 引入 `cleanText` 清洗 HTML；`collectDailyNews` 新增 `windowHour` 参数实现晨报/晚报窗口 |
| 5 | `src/components/daily-report/BriefingPanel.tsx` | 修改 | 0 | +25 |
| 6 | `prisma/schema.prisma` | 修改 | 0 | +20（migration） |

**合计新增：约 350 行**

---

## 二、详细实施方案

### 2.1 第一步：`types.ts` 数据模型扩展

**目标**：为置信度标签和信源透明度页补充数据字段。

**新增内容**：

```typescript
// types.ts 新增

/** 置信度评级（独立信源数量自动判定） */
export type ConfidenceLevel = 'A' | 'B' | 'C' | 'D';

/** 选稿审计（可选，用于可观测性） */
export interface SelectionAudit {
  poolSize: number;
  selectedIndices: number[];
  scores?: Array<{ index: number; score: number; reasons: string[] }>;
  sourceDistribution: Record<string, number>;
  warnings: string[];
}

// DailyReportContentSchema 扩展
export const DailyReportContentSchema = z.object({
  // ... 原有字段 ...
  items: z.array(ItemSchema.extend({
    // 新增字段（向后兼容：旧数据无此字段时默认 B）
    confidenceLevel: z.enum(['A', 'B', 'C', 'D']).optional().default('B'),
    relatedSources: z.array(z.string()).optional().default([]),
  })),
  // 新增：信源构成（用于 P3 柱图）
  bySource: z.record(z.number()).optional(),
  // 新增：选稿审计（可选）
  audit: z.custom<SelectionAudit>().optional(),
});
```

**向后兼容**：置信度字段为 `.optional().default('B')`，旧数据自动兼容。

---

### 2.2 第二步：`generate.ts` 置信度计算逻辑

**目标**：入选新闻自动计算置信度 A/B/C/D，并记录 `bySource`。

**新增函数**：

```typescript
// generate.ts 新增

/** 计算单条新闻的置信度等级 */
function computeConfidenceLevel(item: CollectResult['items'][number], allItems: CollectResult['items']): ConfidenceLevel {
  // 找同标题或相似内容的其他信源
  const relatedSources = allItems
    .filter(other => other !== item && isSameNews(item, other))
    .map(other => other.source);
  
  const uniqueSources = [...new Set([item.source, ...relatedSources])];
  
  if (uniqueSources.length >= 3) return 'A';
  if (uniqueSources.length === 2) return 'B';
  if (uniqueSources.length === 1) return 'C';
  return 'D'; // 矛盾或其他异常
}

/** 判断两条新闻是否为同一事件 */
function isSameNews(a: Item, b: Item): boolean {
  // 简单实现：标题相似度 > 0.6 或 URL 相同
  return a.url === b.url || titleSimilarity(a.title, b.title) > 0.6;
}

/** 统计各信源贡献条数（用于 P3 柱图） */
function computeBySource(items: CollectResult['items']): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of items) {
    map[item.source] = (map[item.source] ?? 0) + 1;
  }
  return map;
}
```

**调用位置**：在 `generateWithLLM` → `picked.map()` 处注入：

```typescript
items: picked.map((p, i) => ({
  // ... 原有字段 ...
  confidenceLevel: computeConfidenceLevel(p, candidates), // 新增
  relatedSources: candidates.filter(c => c !== p && isSameNews(p, c)).map(c => c.source), // 新增
})),
```

**bySource 注入位置**：`content` 构建完成后，新增：

```typescript
// 在 return { version, date, ... } 中新增
bySource: computeBySource(collected.items),
```

---

### 2.3 第三步：`build-pptx.ts` 新增 P3 信源透明度页

**目标**：在"今日要点"后、新闻详情页前，插入 P3 信源透明度页。

**新增函数**：

```typescript
// build-pptx.ts 新增

/** P3：信源透明度页 */
function addSourceTransparency(
  pptx: PptxGenJS,
  content: DailyReportContent,
  p: BriefingPalette,
  pageNo: number,
  totalPages: number,
) {
  const slide = pptx.addSlide();
  slide.background = { color: p.bg };
  sectionHeader(slide, p, '信源透明度');

  // 左侧：置信度评级说明
  const colL = MARGIN;
  const colR = W / 2 + 0.25;
  const colW = W / 2 - MARGIN - 0.25;

  // A/B/C/D 色块
  const levels = [
    { lv: 'A', label: '确证', desc: '≥3 个独立信源', color: '#2E7D32' },
    { lv: 'B', label: '高', desc: '=2 个独立信源', color: '#F57C00' },
    { lv: 'C', label: '中', desc: '=1 个独立信源', color: '#5C6BC0' },
    { lv: 'D', label: '存疑', desc: '多源互相矛盾', color: '#E57373' },
  ];

  slide.addText('置信度评级说明', {
    x: colL, y: 1.8, w: colW, h: 0.3,
    fontSize: 11, fontFace: FONT, bold: true, color: p.fg,
  });

  levels.forEach((lvl, i) => {
    const y = 2.2 + i * 0.5;
    slide.addShape('roundRect', {
      x: colL, y, w: 0.5, h: 0.35, rectRadius: 0.06,
      fill: { color: lvl.color }, line: { type: 'none' },
    });
    slide.addText(lvl.lv, {
      x: colL, y, w: 0.5, h: 0.35,
      fontSize: 12, fontFace: FONT, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
    slide.addText(`${lvl.label}：${lvl.desc}`, {
      x: colL + 0.65, y, w: colW - 0.7, h: 0.35,
      fontSize: 10, fontFace: FONT, color: p.muted, valign: 'middle',
    });
  });

  slide.addText('※ 评级仅依据独立信源数量自动判定，未经人工核实。', {
    x: colL, y: 4.4, w: colW, h: 0.25,
    fontSize: 9, fontFace: FONT, color: p.muted, italic: true,
  });

  // 右侧：信源构成柱图
  slide.addText('今日信源构成', {
    x: colR, y: 1.8, w: colW, h: 0.3,
    fontSize: 11, fontFace: FONT, bold: true, color: p.fg,
  });

  const bySource = content.bySource ?? {};
  const sortedSources = Object.entries(bySource)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // 最多 10 个
  const maxCount = Math.max(...sortedSources.map(([, c]) => c), 1);

  sortedSources.forEach(([source, count], i) => {
    const y = 2.2 + i * 0.42;
    const barW = Math.max(0.1, (colW - 1.6) * (count / maxCount));
    
    slide.addText(source, {
      x: colR, y, w: 1.5, h: 0.3,
      fontSize: 9, fontFace: FONT, color: p.muted, align: 'left', valign: 'middle',
    });
    slide.addShape('rect', {
      x: colR + 1.55, y: y + 0.06, w: barW, h: 0.18,
      fill: { color: p.accent }, line: { type: 'none' },
    });
    slide.addText(String(count), {
      x: colR + colW - 0.6, y, w: 0.6, h: 0.3,
      fontSize: 9, fontFace: FONT, color: p.fg, align: 'right', valign: 'middle',
    });
  });

  pageFooter(slide, p, pageNo, totalPages);
  watermark(slide, content, p);
}
```

**调用位置**：在 `buildBriefingPptx` 函数中，修改 `totalPages` 计算 + 插入调用：

```typescript
// build-pptx.ts 修改

// 原有
const totalPages = 4 + content.items.length;

// 修改为
const totalPages = 5 + content.items.length; // 封面 + 要点 + 信源透明 + items + 趋势 + 末页

// 原有调用顺序
addCover(pptx, content, p, totalPages);
addOverview(pptx, content, p, 2, totalPages);
content.items.forEach((item, i) => addItemSlide(pptx, content, p, item, 3 + i, totalPages));
addInsight(pptx, content, p, 3 + content.items.length, totalPages);
addFinal(pptx, content, p, totalPages);

// 修改为
addCover(pptx, content, p, totalPages);
addOverview(pptx, content, p, 2, totalPages);
addSourceTransparency(pptx, content, p, 3, totalPages); // 新增
content.items.forEach((item, i) => addItemSlide(pptx, content, p, item, 4 + i, totalPages));
addInsight(pptx, content, p, 4 + content.items.length, totalPages);
addFinal(pptx, content, p, totalPages);
```

---

### 2.4 第四步：`build-pptx.ts` 新闻详情页新增置信度标签

**目标**：在每条新闻详情页右上角展示 A/B/C/D 置信度 chip。

**修改位置**：`addItemSlide` 函数中，来源 chip 旁边。

```typescript
// addItemSlide 函数修改

// 在来源 chip + 时间 区域，修改为：

// 来源 chip
const chipW = Math.max(1.1, estimateVisualWidth(item.source) * 0.19 + 0.4);
// ... chip 渲染代码 ...

// 新增：置信度标签（右上角）
const confidenceColors: Record<string, string> = {
  A: '#2E7D32', B: '#F57C00', C: '#5C6BC0', D: '#E57373'
};
const confidenceLabels: Record<string, string> = {
  A: 'A 确证', B: 'B 高', C: 'C 中', D: 'D 存疑'
};
const level = item.confidenceLevel ?? 'B';
const confW = 0.7;
slide.addShape('roundRect', {
  x: W - MARGIN - confW, y: MARGIN, w: confW, h: 0.34, rectRadius: 0.06,
  fill: { color: confidenceColors[level] }, line: { type: 'none' },
});
slide.addText(confidenceLabels[level], {
  x: W - MARGIN - confW, y: MARGIN, w: confW, h: 0.34,
  fontSize: 9, fontFace: FONT, bold: true, color: 'FFFFFF',
  align: 'center', valign: 'middle',
});
```

---

### 2.5 第五步：`SlidePreview.tsx` 对应修改

**目标**：预览组件与 `build-pptx.ts` 完全对齐（所见即所得）。

**修改点 1**：页码计算

```typescript
// 原有
const totalPages = 4 + content.items.length;

// 修改为
const totalPages = 5 + content.items.length;
```

**修改点 2**：新增 P3 信源透明度页预览

```typescript
// 在 OverviewSlide 之后、ItemSlide 之前，插入：

{page === 2 && <SourceTransparencySlide content={content} p={p} pageNo={3} totalPages={totalPages} />}

// 新增组件
function SourceTransparencySlide({ content, p, pageNo, totalPages }: {
  content: DailyReportContent; p: BriefingPalette; pageNo: number; totalPages: number;
}) {
  const c = css(p);
  const bySource = content.bySource ?? {};
  const sortedSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCount = Math.max(...sortedSources.map(([, n]) => n), 1);
  const confidenceLevels = [
    { lv: 'A', label: '确证', desc: '≥3 个独立信源', color: '#2E7D32' },
    { lv: 'B', label: '高', desc: '=2 个独立信源', color: '#F57C00' },
    { lv: 'C', label: '中', desc: '=1 个独立信源', color: '#5C6BC0' },
    { lv: 'D', label: '存疑', desc: '多源互相矛盾', color: '#E57373' },
  ];

  return (
    <>
      <SectionHeader title="信源透明度" p={p} />
      {/* 左侧：置信度说明 */}
      <p className="absolute font-bold" style={{ left: M, top: px(1.8), fontSize: 11, color: c.fg }}>
        置信度评级说明
      </p>
      {confidenceLevels.map((lvl, i) => (
        <div key={lvl.lv} className="absolute flex items-center" style={{ left: M, top: px(2.2) + i * px(0.5), gap: px(0.15) }}>
          <span className="flex items-center justify-center rounded font-bold text-white" style={{ width: px(0.5), height: px(0.35), background: lvl.color, fontSize: 12 }}>
            {lvl.lv}
          </span>
          <span style={{ fontSize: 10, color: c.muted }}>{lvl.label}：{lvl.desc}</span>
        </div>
      ))}
      <p className="absolute italic" style={{ left: M, top: px(4.4), fontSize: 9, color: c.muted }}>
        ※ 评级仅依据独立信源数量自动判定，未经人工核实。
      </p>
      {/* 右侧：信源柱图 */}
      <p className="absolute font-bold" style={{ left: W / 2 + px(0.25), top: px(1.8), fontSize: 11, color: c.fg }}>
        今日信源构成
      </p>
      {sortedSources.map(([source, count], i) => (
        <div key={source} className="absolute flex items-center" style={{ left: W / 2 + px(0.25), top: px(2.2) + i * px(0.42), width: W / 2 - M - px(0.25) }}>
          <span className="shrink-0 truncate" style={{ width: px(1.45), fontSize: 9, color: c.muted }}>{source}</span>
          <div className="relative h-[8px] flex-1 overflow-hidden rounded-sm" style={{ background: c.softBlock }}>
            <div className="h-full" style={{ width: `${(count / maxCount) * 100}%`, background: c.accent }} />
          </div>
          <span className="shrink-0 text-right font-mono" style={{ width: px(0.5), fontSize: 9, color: c.fg }}>{count}</span>
        </div>
      ))}
      <Footer p={p} pageNo={pageNo} totalPages={totalPages} />
      <Watermark content={content} p={p} />
    </>
  );
}
```

**修改点 3**：ItemSlide 新增置信度标签预览

```typescript
// 在 ItemSlide 函数中，来源 chip 旁边新增置信度 chip
const level = item.confidenceLevel ?? 'B';
const confidenceColors: Record<string, string> = {
  A: '#2E7D32', B: '#F57C00', C: '#5C6BC0', D: '#E57373'
};
const confidenceLabels: Record<string, string> = {
  A: 'A 确证', B: 'B 高', C: 'C 中', D: 'D 存疑'
};
// 在时间右侧新增
<span
  className="rounded font-bold text-white"
  style={{ background: confidenceColors[level], fontSize: 9, padding: `${px(0.05)}px ${px(0.1)}px` }}
>
  {confidenceLabels[level]}
</span>
```

---

### 2.6 第六步：`BriefingPanel.tsx` 降级版感知增强

**目标**：降级版（`degraded=true`）时，提供 .md 下载选项。

**修改点 1**：下载按钮改为下拉选择

```tsx
// BriefingPanel.tsx 修改
// 原有下载按钮替换为：

<div className="relative group">
  <button
    type="button"
    onClick={handleDownload}
    disabled={downloadQuery.isFetching}
    className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
  >
    {downloadQuery.isFetching ? '构建文件中…' : '下载'}
  </button>
  {/* Hover 显示选项（仅降级版） */}
  {current?.degraded && (
    <div className="pointer-events-none absolute bottom-full left-0 mb-1 hidden group-hover:block">
      <div className="rounded border border-border bg-background p-2 text-xs shadow-lg">
        <p className="mb-1 text-muted-foreground">降级版可选格式：</p>
        <button
          type="button"
          onClick={() => handleDownload('pptx')}
          className="block w-full rounded px-2 py-1 hover:bg-accent"
        >
          📄 .pptx（原文摘要）
        </button>
        <button
          type="button"
          onClick={() => handleDownload('md')}
          className="block w-full rounded px-2 py-1 hover:bg-accent"
        >
          📝 .md（纯文本版）
        </button>
      </div>
    </div>
  )}
</div>
```

**修改点 2**：`handleDownload` 支持格式参数

```tsx
const handleDownload = async (format: 'pptx' | 'md' = 'pptx') => {
  if (!currentDate) return;
  
  if (format === 'md' && current?.degraded) {
    // 生成 Markdown 内容
    const md = generateMarkdownContent(content!);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `AIHub-AI早报-${currentDate}.md`; a.click();
    URL.revokeObjectURL(url);
    toast.success('Markdown 下载完成');
    return;
  }
  
  // 原有的 .pptx 下载逻辑...
};
```

---

## 三、改造顺序建议

```
Step 1: types.ts（数据模型扩展）         ✅ 已完成
    ↓
Step 2: generate.ts（置信度计算 + bySource） ✅ 已完成
    ↓
Step 3: build-pptx.ts（P3 信源透明度页 + 置信度标签） ✅ 已完成
    ↓
Step 4: SlidePreview.tsx（预览同步 + P3 页预览） ✅ 已完成
    ↓
Step 5: BriefingPanel.tsx（降级版 .md 下载）  ✅ 已完成
    ↓
Step 6: 本地验证（TypeScript 编译 + Lint）   ✅ 已完成
```

---

## 四、验收标准

改造完成后，必须满足：

1. **P3 页存在**：PPT 第 3 页为"信源透明度"，展示 A/B/C/D 说明 + 信源柱图
2. **置信度标签可见**：每条新闻详情页右上角有 A/B/C/D chip（颜色对应级别）
3. **降级可选下载**：降级版时，显示独立的"下载 .md"按钮
4. **预览同步**：SlidePreview 展示 P3 页和置信度标签，与 PPT 下载产物一致
5. **向后兼容**：旧数据（无 confidenceLevel 字段）打开时默认显示 B 级，不报错

---

## 五、预估工期

| Step | 任务 | 预估工时 |
|---|---|---|
| 1 | types.ts 数据模型扩展 | 0.5h |
| 2 | generate.ts 置信度计算 | 1h |
| 3 | build-pptx.ts P3 + 置信度 | 2h |
| 4 | SlidePreview.tsx 预览同步 | 1.5h |
| 5 | BriefingPanel.tsx 降级感知 | 0.5h |
| 6 | 本地验证 + 调优 | 1h |
| **合计** | | **约 6.5 小时** |

---

## 八、实施记录（v2 · 2026-09-01）

### 8.1 实际实施与方案差异

| 方案原定 | 实际实施 | 原因 |
|---|---|---|
| 新增 `downloadMarkdown` 路由（mutation） | 纯客户端 `handleDownloadMarkdown()` | 数据已在前端，通过 `generateMarkdownReport()` 直接生成 `.md` Blob，无需额外请求 |
| 复用 `NewsItem.confidence` | 新增 `isSameNews()` 在候选池中重新计算 | `collect.ts` 的 `CollectedItem` 不含 `crossSources`，需在 `generate.ts` 中通过标题/URL 相似度计算 |

### 8.2 关键实现细节

**置信度计算（`generate.ts`）：**
```typescript
// Step 1 选题：为候选添加 crossSources（通过 isSameNews 在全量池中查找印证信源）
const candidatesWithSources = candidates.map(c => ({
  ...c,
  crossSources: candidates.filter(other =>
    other !== c && isSameNews({ title: c.title, url: c.url }, { title: other.title, url: other.url })
  ).map(other => other.source),
}));

// picked 注入置信度
const relatedSources = (p.crossSources ?? []).filter(s => s !== p.source);
const confidenceLevel = computeConfidenceLevel({ source: p.source, crossSources: p.crossSources });
```

**P3 信源透明度页（`build-pptx.ts`）：**
- 总页数从 `4 + items.length` 改为 `5 + items.length`
- 新增 `addSourceTransparency()` 函数（~65行）
- 插入位置：封面(P1) → 要点(P2) → **信源透明(P3)** → 新闻详情(P4~) → 趋势 → 末页

**降级版 Markdown 下载（`BriefingPanel.tsx`）：**
- 新增 `generateMarkdownReport()` 函数（~60行）
- 降级版时显示独立的"下载 .md"按钮（非下拉菜单，保持简洁）

### 8.3 向后兼容设计

### 8.4 验收清单（v2 P0 改造）

- [x] P3 信源透明度页（`addSourceTransparency`）
- [x] 新闻详情页置信度标签（`addItemSlide` + `CONFIDENCE_COLORS/LABELS`）
- [x] 预览同步（`SlidePreview.tsx` → `SourceTransparencySlide`）
- [x] 降级版 .md 下载（`BriefingPanel.tsx` → 独立按钮）
- [x] TypeScript 编译通过（`pnpm exec tsc --noEmit`）
- [x] Lint 无错误

### 8.5 v3 补丁实施记录（2026-09-01 下午）

| # | 问题/需求 | 根因/方案 | 涉及文件 |
|---|---|---|---|
| B1 | 图一：新闻摘要含 HTML 标签（`<div align='right'>`等） | 根因三元：① `collect.ts` 未清洗（已修复）② `generate.ts` step1 prompt 喂入脏摘要，LLM 复制 HTML 到输出 ③ PPT/预览输出层无二次保险 | `collect.ts`（采集层清洗）+ `build-pptx.ts`（输出二次保险）+ `SlidePreview.tsx`（预览二次保险）+ `BriefingPanel.tsx`（.md 导出清洗） |
| B2 | 图二：P3 右侧信源柱图空白 | 数据少时 bar 宽度过窄（0.1in）+ 空数据无兜底提示 | `build-pptx.ts`、`SlidePreview.tsx` |
| F1 | ，一手来源 URL 未在 PPT 中展示 | 设计规格书要求但实现缺失 | `build-pptx.ts`、`SlidePreview.tsx`、`BriefingPanel.tsx` |
| F2 | 早报/晚报时间窗口硬编码 8:00，无法自定义 | 用户无法设置晨报/晚报分割时间 | Prisma schema、`preferences.ts`、`settings/page.tsx`、`collect.ts`、`generate.ts`、`daily-report.ts` |

**B1 修复（四层防御）：**
- 采集层（`collect.ts`）：`cleanText(truncate(r.summary))` + `cleanText(r.title)` — 防止脏数据进入 LLM prompt
- 输出层（`build-pptx.ts`）：`addItemSlide` 顶部统一声明 `cleanTitle/Summary/Comment/Source`，所有 `addText` 调用全部使用清洗后版本 — 二次保险，无论数据来自 DB/LLM 均有效
- 预览层（`SlidePreview.tsx`）：同步引入 `cleanText`，所有 JSX 插值均使用清洗后版本
- 导出层（`BriefingPanel.tsx`）：`generateMarkdownReport` 中所有 `item.*` 字段均 `cleanText`

**B2 修复（`build-pptx.ts` + `SlidePreview.tsx`）：**
- 柱图最小宽度：`Math.max(0.15, ...)`（原 0.1in）
- 空数据兜底：显示"（今日无收录数据）"提示文字

**F1 实现（`build-pptx.ts` + `SlidePreview.tsx`）：**
```typescript
// URL 在点评框下方；无点评时在摘要区底部
const commentBottomY = item.comment ? dividerY + 2.75 + 0.85 : dividerY + 2.55;
if (item.url) {
  const urlText = item.url.length > 58 ? `${item.url.slice(0, 57)}…` : item.url;
  slide.addText(`🔗 ${urlText}`, { ... }); // 纯文本，无 HTML
}
```

**F2 实现（时间窗口自定义）：**
- Prisma：`UserPreferences.briefingWindowHour Int @default(8)`
- 路由：`generate`/`regenerate` 读取用户偏好，传给 `generateDailyReport(windowHour)`
- `collectDailyNews(now, windowHour=8)`：北京时间 < windowHour → 晨报（昨天 windowHour ~ 今天 windowHour）；≥ windowHour → 晚报（今天 windowHour ~ 明天 windowHour）
- 设置页：下拉选择 00:00 ~ 23:00，显示晨报/晚报标注

### 8.6 v3 验收清单

- [x] **摘要 HTML 清洗（四层防御：采集→生成→PPT输出→预览）**：旧数据 + LLM 生成内容均有效
- [x] 信源柱图最小宽度 + 空状态兜底
- [x] 来源 URL 纯文本展示（截断至 58 字符）
- [x] 预览同步 URL 显示
- [x] 时间窗口设置 UI（下拉 00~23 时）
- [x] `briefingWindowHour` 持久化到 UserPreferences
- [x] `collectDailyNews` 动态时间窗口
- [x] Prisma schema push（`prisma db push`）
- [x] TypeScript 编译通过（linter 无诊断）
- [ ] **待验证**：实际生成含 URL + 无 HTML 乱码的 PPT

---

**文档状态**：✅ v3 补丁已实施
**下次 review**：首次真实数据生成后（约 24 小时）

