# SA-3 错误处理 + 边界条件专项审查报告

**审查日期**：2026-09-07
**审查范围**：src/**/*.ts(x)，重点 server/lib、components
**严重度阈值**：🔴 致命 → 🟡 严重 → 🟢 一般
**执行方式**：仅读扫描，禁止修改

---

## §2.4 错误处理

### 2.4.1 静默吞错

#### 扫描结果

| 文件 | 行 | 模式 | 严重度 |
|---|---|---|---|
| `src/components/app-shell.tsx` | 340, 357, 367 | `} catch {}`（3处） | 🟡 严重 |
| `src/components/discovery/discovery-store.ts` | 314, 323, 330 | `} catch { return null; }` + `} catch {}` | 🟡 严重 |
| `src/server/lib/cleanup-engine.ts` | 144, 155, 166, 185, 192, 248, 332, 491, 516, 529, 558, 570, 760, 773, 789, 798, 886, 891, 902 | `} catch {` 空块 | 🔴 致命 |
| `src/lib/bilibili/api.ts` | 185, 256, 308, 350 | `} catch {` | 🟡 严重 |
| `src/server/routers/bilibili.ts` | 180 | `} catch { return false; }` | 🟢 一般 |
| `src/lib/news/parsers/*.ts` | 多处 | `} catch { return null; }` | 🟢 一般 |
| `src/features/daily-briefing/lib/build-pptx.ts` | 145, 818 | `} catch { return null; }` | 🟢 一般 |
| `src/server/routers/usage.ts` | 176 | `} catch {`（含降级逻辑） | 🟢 一般 |
| `src/app/api/auth/register/route.ts` | 49, 69 | `} catch { return true; }` | 🟡 严重 |
| `src/app/api/upload/file/route.ts` | 103, 151 | `} catch {` | 🟡 严重 |
| `src/app/api/upload/bg/route.ts` | 44 | `} catch {` | 🟡 严重 |
| `src/app/api/cron/refresh-terms/route.ts` | 137 | `} catch {` | 🟡 严重 |
| `src/lib/themes.ts` | 334 | `} catch { console.warn }` | 🟢 一般 |
| `src/server/routers/analysis.ts` | 155 | `} catch { throw TRPCError }` | 🟢 一般 |
| `src/lib/cleanup-db.ts` | 68 | `} catch { // ignore }` | 🟢 一般 |
| `src/features/daily-briefing/server/router.ts` | 26, 34 | `} catch {` | 🟡 严重 |
| `src/app/layout.tsx` | 13 | `} catch {` | 🟡 严重 |

#### 🔴 致命问题详情

**`src/server/lib/cleanup-engine.ts`**（19处空 catch）

该文件是清理引擎核心，充斥大量 `} catch {` 空块：

```ts
// L144 - try 块内含幂等操作：即使清理失败也返回默认状态
async function pathExists(p: string): Promise<boolean> {
  try { await fsp.access(p); return true; } catch { return false; }
}

// L155 - 读取目录失败时返回 0（无法区分"真的空"和"读取失败"）
async function dirSize(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  // ...
}

// L166 - 递归子目录出错，静默跳过（size 统计可能严重偏低）
try { if (e.isDirectory()) total += await dirSize(p); } catch { /* 无权限的跳过 */ }

// L789-902 - buildReport / driveFreeBytes 等多处 catch 静默吞错
```

**影响**：清理结果可能不准确（size 统计缺失），用户以为"清理了 X GB"实际更多或更少。

#### 🟡 严重问题详情

**`src/components/app-shell.tsx`（3处空 catch）**
```ts
L340: } catch {}   // localStorage 读取
L357: } catch {}   // localStorage 写入
L367: } catch {}   // localStorage 写入
```
**影响**：localStorage 出错时 UI 状态可能不一致，但不会崩溃。

**`src/components/discovery/discovery-store.ts`**
```ts
L314: } catch { return null; }   // JSON 解析失败返回 null
L323: } catch {}                  // localStorage 保存
L330: } catch {}                  // localStorage 删除
```
**影响**：会话数据持久化失败时静默丢失，不影响主流程但用户数据丢失。

**`src/app/api/auth/register/route.ts`**
```ts
L49, 69: } catch { return true; }  // Redis 限流失败时 fail-open
```
**注**：代码注释明确说明 "fail-open 避免 Redis 故障锁死注册"，这是**有意识的容错设计**，非真正的静默吞错。但建议记录 `logger.warn`。

**`src/app/api/upload/file/route.ts`**
```ts
L103, 151: } catch { return NextResponse.json({ error: '...' }, { status: 500 }); }
```
**影响**：虽然有错误返回，但原始错误被吞掉，调试困难。

#### 未发现

- ❌ `catch { console.log }` 无 throw：无
- ❌ `.catch(console.` 模式：无

---

### 2.4.2 错误信息质量

#### ✅ 做得好的

1. **`src/app/api/upload/bg/route.ts`** — 有 BUG-11 修复注释，错误 sanitize 后才返回
2. **`src/server/routers/analysis.ts`** — 正确区分 dev mock 与 production throw
3. **`src/server/lib/cleanup-engine.ts`** — `sanitizeError()` 防止堆栈泄露

#### ⚠️ 需要改进的

| 文件 | 行 | 问题 |
|---|---|---|
| `src/app/api/auth/register/route.ts` | 49, 69 | `} catch { return true; }` 无日志 |
| `src/app/api/upload/file/route.ts` | 103, 151 | 返回通用错误，但无 `logger.error` 记录 |
| `src/server/lib/cleanup-engine.ts` | 全部 19 处 | 静默吞错，无日志，调试成本高 |
| `src/features/daily-briefing/server/router.ts` | 26, 34 | catch 内无日志，错误溯源困难 |

#### 错误信息泄露检查

| 文件 | 行 | 内容 | 泄露风险 |
|---|---|---|---|
| `src/app/api/upload/bg/route.ts` | 44 | `logger.error` + `sanitizeError()` | ✅ 已修复 |
| `src/app/api/auth/register/route.ts` | 49, 69 | 无错误日志 | ✅ 无泄露 |
| `src/app/api/upload/file/route.ts` | 103, 151 | 仅 `error: 'Invalid form data'` 等通用消息 | ✅ 无泄露 |

---

### 2.4.3 外部调用容错

#### fetch 超时设置

| 文件 | 行 | 模式 | 超时 |
|---|---|---|---|
| `src/features/daily-briefing/lib/build-pptx.ts` | 131-132 | `setTimeout + AbortController` | ✅ 5000ms |
| `src/lib/utils/fetch-with-retry.ts` | 46-51 | `setTimeout + AbortController` | ✅ 可配置 |
| `src/lib/bilibili/api.ts` | - | `fetchWithRetry` 封装 | ✅ 10s timeout |
| `src/app/login/page.tsx` | 40 | `fetch()` 无 AbortController | 🟡 严重 |
| `src/app/(app)/projects/[id]/page.tsx` | 315 | `fetch()` 无 AbortController | 🟡 严重 |
| `src/components/theme/theme-switcher.tsx` | 115 | `fetch()` 无 AbortController | 🟡 严重 |
| `src/components/theme-provider.tsx` | 195 | `fetch()` 无 AbortController | 🟡 严重 |
| `src/lib/observability/alert.ts` | 18 | `fetch()` 无 AbortController | 🟡 严重 |

**说明**：`fetch()` 在 Node.js/Next.js 环境中无默认超时，request 可以无限挂起。

#### Prisma 超时

| 文件 | 行 | 设置 | 状态 |
|---|---|---|---|
| `src/server/lib/cleanup-engine.ts` | 204 | `{ timeout: 60_000 }` | ✅ 有设置 |
| 其他 Prisma 调用 | - | 默认 | 🟢 可接受（通常足够快） |

#### 文件读写异常

| 文件 | 行 | 模式 | 评价 |
|---|---|---|---|
| `src/server/lib/cleanup-engine.ts` | 144, 155, 166, 185, 192 | 空 catch | 🔴 致命 |
| `src/lib/cleanup.ts` | 61, 133 | `} catch {` | 🟡 严重 |
| `src/lib/themes.ts` | 334 | `} catch { console.warn }` | 🟢 有日志 |
| `src/app/layout.tsx` | 13 | `} catch {` | 🟡 严重 |

#### 第三方服务降级

| 文件 | 第三方 | 降级策略 |
|---|---|---|
| `src/lib/bilibili/api.ts` | B站 API | ✅ `getVideoView` 失败返回 `null`，调用方按 UP 主降级 |
| `src/lib/news/parsers/*.ts` | 新闻源 | ✅ `SourceFetchOutcome` 标准化，失败返回空数组 |
| `src/server/routers/analysis.ts` | LiteLLM | ✅ dev/mock fallback，production throw |

---

## §2.5 边界条件与逻辑错误

### 2.5.1 边界值

#### 空数组处理

| 文件 | 行 | 模式 | 风险 |
|---|---|---|---|
| `src/components/app-shell.tsx` | - | 无直接空数组检查 | 🟢 可接受 |
| `src/components/rankings/StatsOverview.tsx` | - | `m.valueScore > 0` | ✅ 有检查 |
| `src/lib/slide-engine/layout/capacity.ts` | 23, 26, 29 | `!= null` | ✅ 有检查 |
| `src/lib/slide-engine/layout/measure.ts` | 36, 52, 105 | `!= null` | ✅ 有检查 |

#### 除零检查

| 文件 | 行 | 代码 | 检查 |
|---|---|---|---|
| `src/components/news/NewsAnalyticsModal.tsx` | 398 | `d.count / total` | ✅ `total > 0` |
| `src/components/news/NewsAnalyticsModal.tsx` | 439, 484 | `(d.count / total) * 100` | ✅ `total > 0 ?` |
| `src/server/routers/news.ts` | 332 | `highQualityCount / total` | ✅ `total > 0 ?` |
| `src/features/daily-briefing/components/SlidePreview.tsx` | 558 | `d.count / total` | ✅ 有防御 |

**结论**：项目中除法操作均有零值保护。

#### parseInt / parseFloat NaN 检查

| 文件 | 行 | 代码 | NaN 检查 |
|---|---|---|---|
| `src/lib/bilibili/api.ts` | 194 | `parseInt(x, 10) \|\| 0` | ✅ 有默认值 0 |
| `src/lib/news/parsers/ai-bot-daily.ts` | 57, 58 | `parseInt(match[1], 10)` | ⚠️ 无显式 NaN 检查（依赖正则） |
| `src/lib/news/parsers/maomu.ts` | 43, 52, 60, 69, 70 | `parseInt(...)` | ⚠️ 无显式 NaN 检查 |
| `src/lib/slide-engine/render/pptx/renderer.ts` | 26 | `parseInt(c)` | ⚠️ 无显式 NaN 检查 |
| `src/lib/text.ts` | 35, 39 | `parseInt(code, 16/10)` | ⚠️ 无显式 NaN 检查 |
| `src/app/(app)/settings/page.tsx` | 654, 706 | `parseInt(e.target.value)` | ⚠️ 无显式 NaN 检查 |
| `src/lib/cleanup.ts` | 90 | `parseInt(env, 10) \|\| 0` | ✅ 有默认值 |
| `src/lib/cleanup-db.ts` | 148 | `parseInt(env, 10)` | ⚠️ 无显式 NaN 检查 |

#### 分页边界

| 文件 | 行 | 代码 | 边界处理 |
|---|---|---|---|
| `src/app/(app)/news/page.tsx` | 267 | `if (page === 0)` | ✅ 有边界检查 |
| `src/server/routers/news.ts` | - | Prisma take/skip | ✅ 有分页逻辑 |

#### 时区问题

| 文件 | 行 | 代码 | 时区风险 |
|---|---|---|---|
| `src/lib/news/parsers/maomu.ts` | 54 | `d.setHours(d.getHours() - hours)` | 🟡 隐式本地时区 |
| `src/app/(app)/workbench/page.tsx` | 43 | `new Date().getHours()` | 🟡 本地时区 |
| `src/lib/observability/distributed-lock.ts` | 127 | `toISOString()` | ✅ UTC |
| `src/server/routers/usage.ts` | 148, 198 | `toISOString()` | ✅ UTC |
| `src/server/routers/news.ts` | 多处 | `toISOString()` | ✅ UTC |

**注**：`maomu.ts` 的 `d.setHours()` 在跨时区服务器上可能产生不一致结果，建议统一用 `toISOString()` 或 moment.js。

---

### 2.5.2 循环与索引

| 文件 | 行 | 问题 | 风险 |
|---|---|---|---|
| `src/server/routers/usage.ts` | 198 | `models.reduce((max, m) => (m.updatedAt > max ? m.updatedAt : max), models[0]!.updatedAt)` | 🟢 有 `!` 断言 |
| `src/lib/slide-engine/templates/briefing/slides/authors.ts` | 161 | `// count` 注释 | ⚠️ 需确认循环逻辑 |

**未发现明显 `<` vs `<=` 错误**。

---

### 2.5.3 类型与语义

#### `==` vs `===`

| 文件 | 行 | 代码 | 风险 |
|---|---|---|---|
| `src/app/(app)/chat/page.tsx` | 363 | `!= null` | ✅ 正确 |
| `src/app/(app)/projects/[id]/page.tsx` | 430, 588, 590, 605 | `!= null` | ✅ 正确 |
| `src/server/routers/news.ts` | 260 | `!= ''` | ✅ 正确 |
| `src/lib/slide-engine/layout/measure.ts` | 36 | `== null` | ✅ 正确 |
| `src/lib/sanitize.ts` | 93, 96 | `== null` | ✅ 正确 |

**结论**：未发现 `==` 或 `!=` 混用问题。

#### null vs undefined

| 文件 | 行 | 模式 | 评价 |
|---|---|---|---|
| 全局 | - | `??` / `?.` 链式调用 | ✅ 良好实践 |
| `src/lib/bilibili/api.ts` | 194 | `\|\| 0` 默认值 | ✅ 良好 |

---

### 2.5.4 过拟合

#### Magic Number

| 文件 | 行 | 值 | 风险 |
|---|---|---|---|
| `src/features/daily-briefing/lib/build-pptx.ts` | 131 | `5000` (ms) | ⚠️ 无常量 |
| `src/lib/utils/fetch-with-retry.ts` | - | `timeoutMs` 参数 | ✅ 已参数化 |
| `src/server/lib/cleanup-engine.ts` | 204 | `60_000` (ms) | ✅ 有命名常量 |
| `src/lib/cleanup.ts` | 90 | `?? '7'` (天) | ✅ 有环境变量 |
| `src/lib/cleanup-db.ts` | 148 | `?? '90'` (天) | ✅ 有环境变量 |
| `src/app/api/cron/refresh-terms/route.ts` | - | `maxDuration = 300` | ✅ 有常量化 |

**未发现严重过拟合**。

---

## 问题汇总

### 🔴 致命（必须修复）

| ID | 文件 | 行 | 问题 |
|---|---|---|---|
| EH-F1 | `src/server/lib/cleanup-engine.ts` | 144,155,166,185,192,248,332,491,516,529,558,570,760,773,789,798,886,891,902 | 19处空 catch，静默吞错且无日志 |

### 🟡 严重（建议修复）

| ID | 文件 | 行 | 问题 |
|---|---|---|---|
| EH-F2 | `src/components/app-shell.tsx` | 340,357,367 | 3处空 catch（localStorage） |
| EH-F3 | `src/components/discovery/discovery-store.ts` | 314,323,330 | localStorage 读写空 catch |
| EH-F4 | `src/features/daily-briefing/server/router.ts` | 26,34 | 空 catch 无日志 |
| EH-F5 | `src/app/api/upload/file/route.ts` | 103,151 | 空 catch 返回错误但无日志 |
| EH-F6 | `src/app/api/upload/bg/route.ts` | 44 | 空 catch 无日志 |
| EH-F7 | `src/app/api/cron/refresh-terms/route.ts` | 137 | 空 catch 无日志 |
| EH-F8 | `src/app/layout.tsx` | 13 | 空 catch 无日志 |
| EH-F9 | `src/lib/bilibili/api.ts` | 185,256,308,350 | 4处空 catch |
| EH-F10 | `src/lib/cleanup.ts` | 61,133 | 空 catch |
| BC-F1 | `src/app/login/page.tsx` | 40 | fetch 无 AbortController |
| BC-F2 | `src/app/(app)/projects/[id]/page.tsx` | 315 | fetch 无 AbortController |
| BC-F3 | `src/components/theme/theme-switcher.tsx` | 115 | fetch 无 AbortController |
| BC-F4 | `src/components/theme-provider.tsx` | 195 | fetch 无 AbortController |
| BC-F5 | `src/lib/observability/alert.ts` | 18 | fetch 无 AbortController |
| BC-F6 | `src/lib/news/parsers/maomu.ts` | 54 | `setHours` 隐式本地时区 |

### 🟢 一般（记录）

| ID | 文件 | 行 | 问题 |
|---|---|---|---|
| EH-G1 | `src/server/routers/bilibili.ts` | 180 | `return false` 有语义，附有输入验证 |
| EH-G2 | `src/lib/cleanup-db.ts` | 68 | `// ignore` 注释，语义清晰 |
| BC-G1 | `src/lib/news/parsers/*.ts` | 多处 | parseInt 无显式 NaN 检查（但正则保证） |
| BC-G2 | `src/app/(app)/settings/page.tsx` | 654,706 | parseInt 无显式 NaN 检查 |

---

## 迁移决策

| 决策 | 问题数 | 动作 |
|---|---|---|
| 🔴 致命 | 1 | **必须修复后迁移**（cleanup-engine.ts 19处空 catch） |
| 🟡 严重 | 15 | **建议修复后迁移**（日志补充 + AbortController） |
| 🟢 一般 | 4 | **可直接迁移**（已有合理防御或降级） |

---

## 建议修复优先级

### P0（阻断迁移）

1. **`src/server/lib/cleanup-engine.ts`** — 全部 19 处空 catch 改为：
   ```ts
   } catch (err) {
     logger.warn('[cleanup-engine] ...', { error: err instanceof Error ? err.message : String(err) });
     return <sensible-default>;
   }
   ```

### P1（高优先级）

1. **fetch 缺少 AbortController**（5处）— 建议封装到 `fetch-with-retry.ts` 或统一加超时
2. **`src/app/api/auth/register/route.ts`** — catch 块加 `logger.warn('Redis rate limit check failed, allowing')`
3. **`src/components/app-shell.tsx`** — localStorage catch 加 `console.warn`（SSR 友好）

### P2（中优先级）

1. **`src/lib/news/parsers/maomu.ts`** — `d.setHours()` 改用 `dayjs` 或显式 UTC 操作
2. **各 `parseInt` 调用** — 补 `isNaN()` 检查或保持 `|| 0` 默认值模式

---

**报告完成时间**：2026-09-07 21:57
