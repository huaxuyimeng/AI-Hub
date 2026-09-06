# 前端 UI 测试计划

**测试目标**：验证 150 条新闻的展示效果  
**页面路径**：`/news`  
**组件文件**：`src/app/(app)/news/page.tsx`

---

## 测试前准备

### 1. 确认数据可用

```bash
# 查询当前新闻数量
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.newsItem.count().then(c => console.log('Total news:', c)).finally(() => p.\$disconnect())"
```

### 2. 启动开发服务器

```bash
cd d:\1Money\aihub
npm run dev
# 或
pnpm dev
```

### 3. 访问页面

```
http://localhost:3000/news
```

---

## 测试用例

### TC1: 页面加载

| 步骤 | 预期结果 |
|------|----------|
| 1. 访问 `/news` | 页面正常加载，无白屏 |
| 2. 查看头部 | 显示"AI 新闻推送" + 总数 + 今日数量 |
| 3. 查看按钮 | "立即抓取"按钮可见且可点击 |

**数据来源**：
```typescript
statsQuery.data?.total ?? 0  // 总数
statsQuery.data?.today ?? 0  // 今日数量
```

---

### TC2: 新闻列表展示

| 检查项 | 预期结果 |
|--------|----------|
| **数量** | 默认展示最多 100 条（limit: 100） |
| **排序** | 按发布时间倒序（最新在前） |
| **卡片内容** | 标题、摘要、来源、时间、分类标签 |
| **样式** | 卡片间距 2（space-y-2），悬停效果 |

**关键代码**：
```typescript:135:143:src/app/(app)/news/page.tsx
{items.map((item) => (
  <NewsCard key={item.id} item={item} />
))}
```

---

### TC3: 分类筛选

| 分类 | 预期行为 |
|------|----------|
| **全部** | 显示所有新闻 |
| **AI Coding** | 仅显示编程相关（copilot、代码等） |
| **具身智能** | 仅显示机器人相关 |
| **AI政策** | 仅显示政策法规相关 |

**数量显示**：
```typescript:107:118:src/app/(app)/news/page.tsx
{CATEGORIES.map((cat) => (
  <button
    key={cat}
    type="button"
    onClick={() => setCategory(cat)}
    className={...}
  >
    {cat}
    {categoryCounts[cat] !== undefined && ` ${categoryCounts[cat]}`}
  </button>
))}
```

---

### TC4: 搜索功能

| 输入 | 预期结果 |
|------|----------|
| "GPT" | 标题或摘要含"GPT"的新闻 |
| "Claude" | 标题或摘要含"Claude"的新闻 |
| "开源" | 标题或摘要含"开源"的新闻 |
| 清空搜索 | 恢复完整列表 |

**实现方式**：
```typescript:40:46:src/app/(app)/news/page.tsx
const newsQuery = trpc.news.list.useQuery(
  {
    date,
    category: category === '全部' ? undefined : category,
    search: search.trim() || undefined,
    limit: 100,
  },
```

---

### TC5: 日期筛选

| 操作 | 预期结果 |
|------|----------|
| 默认状态 | 显示"所有日期" |
| 选择今天 | 仅显示今日新闻 |
| 选择昨天 | 仅显示昨日新闻 |
| 切换回"所有日期" | 恢复完整列表 |

**日期来源**：
```typescript:122:131:src/app/(app)/news/page.tsx
{datesQuery.data && datesQuery.data.length > 0 && (
  <select
    value={date ?? ''}
    onChange={(e) => setDate(e.target.value || undefined)}
    className="rounded-md border bg-card px-3 py-1.5 text-xs"
  >
    <option value="">所有日期</option>
    {datesQuery.data.slice(0, 30).map((d) => (
      <option key={d} value={d}>{d}</option>
    ))}
```

---

### TC6: 立即抓取功能

| 操作 | 预期结果 |
|------|----------|
| 点击"立即抓取" | 按钮变为"抓取中…"并禁用 |
| 抓取成功 | Toast 提示"抓取完成，共 X 条" |
| 列表更新 | 新闻列表自动刷新 |
| 抓取失败 | Toast 提示"抓取失败，请稍后重试" |

**代码位置**：
```typescript:56:63:src/app/(app)/news/page.tsx
const refreshMutation = trpc.news.refresh.useMutation({
  onSuccess: (data: { totalItems: number }) => {
    toast.success(`抓取完成，共 ${data.totalItems} 条`);
    newsQuery.refetch();
    statsQuery.refetch();
    datesQuery.refetch();
  },
  onError: () => toast.error('抓取失败，请稍后重试'),
```

---

### TC7: 自动抓取（首次进入）

| 场景 | 预期行为 |
|------|----------|
| 数据库为空（0 条） | 自动触发一次抓取 |
| 数据库接近空（< 5 条） | 自动触发一次抓取 |
| 数据库有数据（≥ 5 条） | 不触发自动抓取 |

**实现代码**：
```typescript:66:72:src/app/(app)/news/page.tsx
useEffect(() => {
  if (!hasAutoRefreshed.current && !newsQuery.isLoading && (newsQuery.data?.items.length ?? 0) < 5) {
    hasAutoRefreshed.current = true;
    refreshMutation.mutate();
  }
}, [newsQuery.isLoading, newsQuery.data?.items.length]);
```

---

### TC8: 空状态处理

| 场景 | 显示文案 |
|------|----------|
| 数据库完全为空 | "暂无新闻数据，点击右上角「立即抓取」开始" |
| 筛选无结果 | "当前筛选下没有匹配的新闻" |

---

### TC9: 性能测试

| 指标 | 预期值 |
|------|--------|
| **首屏加载** | < 2 秒 |
| **列表渲染** | 100 条 < 500ms |
| **分类切换** | < 100ms |
| **搜索响应** | 实时（无防抖） |

---

### TC10: 响应式设计

| 屏幕宽度 | 预期布局 |
|----------|----------|
| **桌面** (≥ 1024px) | 最大宽度 6xl，左右留白 |
| **平板** (768-1023px) | 自适应宽度 |
| **手机** (< 768px) | 全宽，按钮堆叠 |

---

## 关键数据结构

### NewsItem

```typescript
interface NewsItem {
  id: string;
  title: string;
  url: string;
  summary?: string;
  content?: string;
  publishedAt: Date | null;
  publishPrecision: 'exact' | 'date' | null;
  crawledAt: Date;
  category?: string;
  source: {
    name: string;
  };
}
```

---

## 测试检查清单

- [ ] 页面正常加载，无控制台错误
- [ ] 头部显示正确的统计数据
- [ ] 新闻列表展示 100 条（或实际数量）
- [ ] 分类筛选工作正常，数量正确
- [ ] 搜索功能实时响应
- [ ] 日期筛选工作正常
- [ ] "立即抓取"按钮功能正常
- [ ] Toast 提示正常显示
- [ ] 空状态文案正确
- [ ] 响应式布局在不同屏幕下正常

---

## 截图位置

建议截图保存到：
```
docs/screenshots/
├── news-list-full.png       # 完整列表
├── news-filter-category.png # 分类筛选
├── news-search.png          # 搜索功能
├── news-refresh.png         # 抓取进行中
└── news-empty.png           # 空状态
```

---

## 下一步

测试通过后，可以继续：
1. 修复失败源（The Verge AI、极客公园）
2. 添加分布式锁
3. P2 差异化功能（B站爬虫）
