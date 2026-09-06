# 术语审核运营 SOP

> 创建时间：2026-09-01
> 来源：37 报告 §2.2.9 P0 卡点
> 目标读者：项目维护者（你）
> 工作量：首次 1-2 小时，后续每周 5-15 分钟

---

## 为什么需要这份 SOP

`TermDictionary.verified=true` 是 `src/lib/news/search.ts` 同义词展开的**唯一过滤条件**。当 `verified=true` 计数 = 0 时：

- `expandQuery()` 返回空数组
- 用户搜索不带任何同义词扩展
- 智能搜索 = 退化为基础 OR 查询
- **D-2 关键词系统功能等于空转**

设计上的"安全锁"（防止 LLM 自动审核出错词）导致**功能被人工审核阻塞**。这份 SOP 是解锁它的标准流程。

---

## 一、首次审核（目标：解锁智能搜索）

### Step 1：确认 LITELLM_BASE_URL 已配置

参见 `.env.example`，本地跑 `LiteLLM Proxy` 或远程代理均可。验证：

```bash
curl $LITELLM_BASE_URL/v1/models -H "Authorization: Bearer $LITELLM_API_KEY"
# 应返回模型列表而非错误
```

### Step 2：抽取首批候选术语（一次性）

```bash
npx tsx scripts/extract-terms.ts
```

- 读最新 30 天新闻标题 → LLM 抽取候选词
- 自动 dedup / canonical 化
- 输出：~20-50 个 `verified=false` 的术语

### Step 3：扩展同义词（一次性）

```bash
npx tsx scripts/expand-synonyms.ts
```

- 对每个未审核术语，让 LLM 生成 3-8 个同义词 / 别名
- 写入 `TermDictionary.aliases` JSON 字段

### Step 4：人工审核（核心）

```bash
npx tsx scripts/review-terms.ts
```

交互式菜单：

| 键 | 动作 |
|---|---|
| `a` | **Approve** → 标记 `verified=true`，立即生效 |
| `d` | **Delete** → 从 TermDictionary 删除 |
| `e` | **Edit** → 手动修改 canonical / aliases |
| `s` | **Skip** → 保留 `verified=false`，下次再看 |
| `q` | **Quit** → 退出，下次继续 |

**审核原则**：

1. **优先 a**：AI 行业常见的术语（GPT / Claude / DeepSeek / RAG / Agent / MCP 等）直接通过
2. **保守 s**：拿不准的术语先 s，等下次有更多上下文再判
3. **果断 d**：明显是噪音（公司全名带地点缩写、临时活动名、特定型号代码）直接删

**目标**：通过 20-30 个，覆盖 80% 用户搜索场景。

### Step 5：评估准确率

```bash
npx tsx scripts/evaluate-terms.ts
```

- 计算本周新扩展的术语的 precision（匹配真实新闻标题的命中率）
- 阈值 ≥ 75% 即合格
- < 75% 说明 LLM 扩 alias 太激进，需要 review-terms 删一批

### Step 6：刷新 + 验证

审核完成后：

1. 强制刷新 next dev（F5）→ TermDictionary 会被 Next.js cache 拦截
2. 进入新闻页 → 搜索框输入"国产大模型" → 应该看到"智能搜索 · 已展开 N 个关键词"提示
3. 搜索结果应该比裸搜索多

---

## 二、周维护（每周日 18:00 UTC 自动跑）

`vercel.json` 配置：

```json
{ "cron": "0 18 * * 0", "path": "/api/cron/refresh-terms" }
```

自动跑：expand + extract + evaluate。新词自动入库 `verified=false`。

**人工操作**：周日晚上或周一早上花 5-15 分钟跑 `review-terms.ts`，处理自动新增的 5-15 个候选。

---

## 三、判断标准速查

| 场景 | 决策 |
|---|---|
| 行业知名 AI 术语（GPT-5 / Claude 4 / DeepSeek-V3 / Agent / RAG / MCP）| ✅ a |
| 公司名（OpenAI / Anthropic / xAI / DeepSeek / 阿里 / 字节）| ✅ a |
| 模型代号（o3 / Sonnet 4.5 / Grok-4）| ✅ a（注意型号归一）|
| 中文俗名（"大模型" / "通用人工智能" / "推理模型"）| ✅ a |
| 产品名（Cursor / ChatGPT / Claude Code / Copilot）| ✅ a |
| 内部代号 / 截图代号 / 测试版本号 | ❌ d |
| 厂商全称（"OpenAI, Inc." / "Anthropic PBC"）| ❌ d（用 "OpenAI" / "Anthropic"）|
| 临时活动名（"DevDay 2026" / "Build 2026"）| ❌ d |
| 拿不准的英文长串（>30 字符、含数字与特殊符号）| ⚠️ e 或 s |

---

## 四、紧急情况

如果 `review-terms.ts` 卡死 / 输出乱码 / 数据库锁：

```bash
# 1. 看数据库状态
npx prisma studio
# 打开 TermDictionary 表

# 2. 手动改 verified
# 找到要改的行，编辑 verified = true / false

# 3. 强制刷新缓存
# 删除 .next/cache 或重启 next dev
```

---

## 七、相关脚本与定期运行

- `scripts/extract-terms.ts` — 从最新新闻抽取候选术语
- `scripts/expand-synonyms.ts` — 自动扩展同义词
- `scripts/review-terms.ts` — 交互式人工审核（a/d/e/s/q）
- `scripts/evaluate-terms.ts` — 每周批处理，准确率评估
- `scripts/eval-news-intent.ts` — 新闻意图搜索准确率评估（33 报告 §1 待办）

建议每周日 19:00（terms 审核完后）跑：
```bash
npx tsx scripts/evaluate-terms.ts && npx tsx scripts/eval-news-intent.ts
```

---

## 六、检查清单

- [ ] `LITELLM_BASE_URL` 已配置且可访问
- [ ] 已跑 `extract-terms.ts`
- [ ] 已跑 `expand-synonyms.ts`
- [ ] `review-terms.ts` 已通过 ≥ 20 个术语
- [ ] `evaluate-terms.ts` precision ≥ 75%
- [ ] 前端搜索框出现"智能搜索"提示
- [ ] `vercel.json` 周日 18:00 cron 配置正确