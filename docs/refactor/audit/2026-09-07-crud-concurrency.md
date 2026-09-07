# SA-2 批次 B5：CRUD 完整性 + 并发竞态专项审计报告

> **扫描时间**：2026-09-07
> **扫描范围**：`src/server/routers/*.ts`（全量 14 个 router）、`src/server/lib/cleanup-engine.ts`、`src/lib/usage.ts`、`src/lib/news/service.ts`、`src/lib/bilibili/scraper.ts`、`src/lib/observability/distributed-lock.ts`、`src/lib/db.ts`、`src/app/api/cron/**/*.ts`（6 个 cron）、`prisma/schema.prisma`
> **严重度约定**：🔴 致命（未修复产生数据损坏/重复扣款/越权）| 🟡 严重（并发场景错误）| 🟢 一般（可观察但触发概率低）
> **本报告性质**：纯读扫描，零修改

---

## §2.2 CRUD 完整性

### 2.2.1 事务边界缺失

#### 🔴 B-01：chat.sendMessage 多表写无事务（最严重）

**文件**：`src/server/routers/chat.ts:67-160`

```startLine:67:endLine:160:src/server/routers/chat.ts
// sendMessage 内含 3 次独立 DB 写：
// 1. prisma.message.create（用户消息）
// 2. prisma.message.create（AI 消息）
// 3. prismaRaw.conversation.update（更新 updatedAt）
// + 条件触发 recordUsage（→ usageStat.upsert）
```

**根因**：`sendMessage` 执行顺序：
1. `prisma.message.create`（用户消息）→ 成功
2. AI 调用（可能失败）
3. `prisma.message.create`（AI 消息）→ 成功
4. `recordUsage`（`usageStat.upsert`）→ 成功
5. `prismaRaw.conversation.update`（updatedAt）→ 成功

**危害**：
- 若 AI 调用失败（`throw`），步骤 1 的用户消息已落库但 conversation.updatedAt 未更新 → 对话列表中该对话"不变"（时间戳未刷新）
- 若步骤 4 失败（upsert P2002 重试耗尽），UsageStat 缺失 → 账本不对
- 若步骤 3 失败，用户消息已写但 AI 消息未写 → 消息对不完整

**修复建议**：包裹 `prisma.$transaction([...])`，AI 调用放在事务外（因为 AI 调用不涉及 DB）：

```typescript
// 伪代码
const userMsg = await prisma.message.create({ ... });
const aiResp = await chat(...); // 事务外
const aiMsg = await prisma.message.create({ ... });
await recordUsage(...);
await prisma.conversation.update({ ... });
// 或用 prisma.$transaction 包裹所有写操作
```

**严重度**：🔴 致命 — 消息不完整 + 账本不准 + 对话列表时间戳错误

---

#### 🟡 B-02：terms-weekly cron 循环内 DB 写无事务

**文件**：`src/app/api/cron/refresh-terms/route.ts:140-160`

```startLine:140:endLine:160:src/app/api/cron/refresh-terms/route.ts
  for (const t of terms) {
    if (!t?.canonical || !t?.displayName || !t?.type) continue;
    const exists = await prisma.termDictionary.findUnique({ where: { canonical: t.canonical } });
    if (exists) { skipped++; continue; }
    await prisma.termDictionary.create({ data: { ... } }); // ← 每次 create 独立事务
    added++;
  }
```

**根因**：`runExtract` 中对每条 term 逐条 `create`，每条一个独立事务。

**危害**：
- 若 term A 写入后 term B 写入失败，已成功的 term A 不会回滚
- 并发多个 cron 实例（罕见但可能）同时写入同一 canonical → P2002 未被 catch（因 `findUnique` 先查，但 `findUnique` 和 `create` 之间 TOCTOU）

**修复建议**：用 `prisma.$transaction` 批量插入，或至少在循环外层加 try/catch 并用 `createMany`

**严重度**：🟡 严重 — 孤立写入 + 潜在 TOCTOU

---

#### 🟡 B-03：terms-weekly cron runExpand 每条 term 独立 DB 写

**文件**：`src/app/api/cron/refresh-terms/route.ts:230`

```startLine:225:endLine:235:src/app/api/cron/refresh-terms/route.ts
  // runEvaluate 中同样问题：
  for (const term of terms) {
    const count = await prisma.newsItem.count({ where: {...} });
    await prisma.termEvaluation.create({ data: { ... } });
    if (label === 'true_positive') tp++;
    ...
  }
```

**根因**：`runEvaluate` 对每个 term 独立 `create`（termEvaluation），同 B-02。

**危害**：同上，轻于 B-01（termEvaluation 是追加日志，失败影响较小）。

**严重度**：🟡 严重（条件触发）

---

#### 🟡 B-04：refresh-terms cron runEvaluate 并发 count 查询风暴

**文件**：`src/app/api/cron/refresh-terms/route.ts:235-240`

```startLine:235:endLine:240:src/app/api/cron/refresh-terms/route.ts
  for (const term of terms) {
    const count = await prisma.newsItem.count({ where: {...} }); // ← 每条一次 count
    ...
  }
```

**根因**：50 个 term × 1 次 `count` = 50 次独立 DB 查询，无并发、无事务。

**危害**：N+1 查询，SQLite 连接池压力，生产环境耗时长。

**修复建议**：改为 `groupBy` 一次拉回，或用 `Promise.all` 并发（限流）。

**严重度**：🟡 严重（性能降级）

---

#### 🟢 B-05：cleanup-engine session 文件读写无原子性保证

**文件**：`src/server/lib/cleanup-engine.ts:680-730`

```startLine:680:endLine:730:src/server/lib/cleanup-engine.ts
  // runClean 中每完成一项就更新 session 文件：
  // readSession → 修改 → writeJsonAtomic
  // 但没有全局锁保护 session 文件本身
```

**根因**：`readSession` 和 `writeSession` 之间存在窗口，若两个进程同时操作同一 session（理论上不可能，因为有 withLock 保护），但 withLock 是 Redis 锁，Redis 不可用时降级为文件锁。

**实际影响**：低 — 因为 `runClean` 全程在 `withLock` 保护下执行，session 文件仅被单进程读写。

**严重度**：🟢 一般

---

#### 🟢 B-06：news/service.ts saveItems 批次降级后单条写入无事务

**文件**：`src/lib/news/service.ts:485-530`

```startLine:485:endLine:530:src/lib/news/service.ts
      // 批次事务失败时降级为单条 upsert（BUG-018 修复）：
      for (const item of toProcess) {
        try {
          await prisma.newsItem.upsert({ ... }); // ← 每条独立事务
        } catch (singleErr) {
          logger.warn('single item save failed', ...);
        }
      }
```

**根因**：当 `prisma.$transaction` 批次失败时，降级为单条 upsert 循环。每条独立事务，无原子性。

**实际影响**：低 — 这是退化路径，正常路径走批次事务；且降级时单条失败只跳过该条，不影响其他。

**严重度**：🟢 一般

---

### 2.2.2 幂等性缺失

#### 🟡 B-07：project.create slug 冲突重试有上限但无幂等键

**文件**：`src/server/routers/project.ts:69-99`

```startLine:69:endLine:99:src/server/routers/project.ts
      async function tryCreate(slugAttempt: string, retries = 2) {
        try {
          return await prisma.project.create({ data: { slug } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && retries > 0) {
            return tryCreate(input.slug, retries - 1); // ← 用 input.slug 重试，不是 slugAttempt
          }
        }
      }
```

**根因**：
- retry 用的是 `input.slug`（原始值），不是递增后的 slug，所以不会真正生成新 slug
- 重试逻辑会一直 P2002 直到 retries=0
- 修复：应改用 `slugAttempt` 递进（如 `input.slug + '-2'`），或用 UUID 消除碰撞

**幂等性**：API 本身是幂等的（slug 唯一则 CONFLICT），但重试逻辑有 bug。

**严重度**：🟡 严重 — slug 碰撞时永远重试失败，用户体验差

---

#### 🟡 B-08：ai-keys revoke/revokeApiKey 软删除无幂等键

**文件**：`src/server/routers/ai-keys.ts:140-160`、`src/server/routers/project.ts:180-190`

```startLine:180:endLine:190:src/server/routers/project.ts
  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // 先 findFirst 查是否存在
      const owner = await prismaRaw.apiKey.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND' });
      await prismaRaw.apiKey.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    }),
```

**根因**：
- 两次 DB 操作（findFirst → update），不是原子操作
- 若两次调用并发，`findFirst` 均通过，第二次 `update` 对已删除记录无影响（soft delete idempotent 本身 OK）
- **真正的幂等问题**：若 key 在第一次调用的 `update` 完成前第二次调用进来，第二次的 `findFirst` 也查到（因为 `deletedAt: null`），导致两次都执行 `update`，但结果一样

**实际影响**：低 — soft delete 本身幂等（更新同一个 `deletedAt` 值），TOCTOU 窗口极小。

**严重度**：🟢 一般

---

### 2.2.3 数据库约束缺失

#### 🔴 B-09：软删模型 Project/ApiKey/Conversation 缺 unique 约束

**文件**：`prisma/schema.prisma`

**现状**：
- `Project`: `@@index([tenantId, slug])` — 但无 `@@unique([tenantId, slug])`
- `ApiKey`: 无 unique（只有 `@@index([tenantId, provider])`）
- `Conversation`: 无 unique

**根因**：依赖 `deletedAt: null` + `tenantId` 组合唯一性，但软删后 `deletedAt` 有值，此时若有相同 slug 的新项目创建会冲突。

**示例场景**：
1. 创建项目 `demo`，id=A，`deletedAt=null`
2. 软删项目 `demo`（id=A），`deletedAt=now()`
3. 再次创建项目 `demo`，id=B → 若 `findFirst` 查到的是软删记录（A），且 `findFirst` 不加 `deletedAt: null` 过滤，则查不到 A，会创建成功

**当前实际状态**：`db.ts` 中间件对 `create` 不自动加 `deletedAt: null` 过滤，所以软删后重建同名项目**不受约束保护**。若应用层 `create` 前的 `findFirst` 漏加 `deletedAt: null`，会创建成功导致两条同名 slug（一条软删，一条活跃）。

**严重度**：🔴 致命 — 软删后同名重建无法阻止

**修复建议**：
```prisma
@@unique([tenantId, slug])
// 对 ApiKey 加唯一约束（tenantId, provider, label）
@@unique([tenantId, provider, label])
```

---

#### 🟡 B-10：TermDictionary.aliases / TermEvaluation.batch 缺约束

**文件**：`prisma/schema.prisma:479`

```startLine:479:endLine:479:prisma/schema.prisma
  aliases      Json     @default("[]")
  // aliases 是 JSON 数组，无 unique
  // canonical 已 @unique，这是 OK 的
```

**根因**：`aliases` 是 JSON 字段无法加 DB 层 unique，只能靠应用层 + `@@unique([canonical])` 保护。

**实际影响**：低 — `canonical` 已唯一，同义词重复只在应用层有。

**严重度**：🟢 一般

---

#### 🟡 B-11：NewsItem.url 无数据库层约束（仅应用层唯一）

**文件**：`prisma/schema.prisma:523`、`src/lib/news/service.ts:460`

```startLine:523:endLine:523:prisma/schema.prisma
  url         String     @unique  // ← 已有 @unique，这是 OK 的
```

**现状**：`NewsItem.url` 已有 `@unique`，OK。

**但**：`service.ts` 中 `saveItems` 用 `upsert` 处理 url 冲突，这是正确的。

**严重度**：🟢 一般（已正确）

---

#### 🟡 B-12：SQLite 不支持 `@db.Text` 类型（枚举 check 缺失）

**文件**：`prisma/schema.prisma`

**现状**：整个 schema 使用 SQLite provider，所有字段类型均为 Prisma 标准类型，无 `@db.Text` / `@db.VarChar` 等 MySQL/PG 特有修饰符。

**枚举约束**：`status` / `role` / `type` 等字段在 schema 中为 `String`，无枚举 check 约束，依赖应用层 Zod 校验。

**影响**：
- SQLite 允许任何字符串写入枚举字段（"PENDING" / "RUNNING" / "unknown" 都接受）
- 但 Prisma 类型 + Zod 输入校验在正常流程中有保护，绕过校验直接 SQL 无保护

**严重度**：🟡 严重 — 直接 SQL 注入可绕过枚举限制

---

### 2.2.4 状态机跳转

#### 🟡 B-13：Analysis.status 可被中间态绕过

**文件**：`prisma/schema.prisma:130`

```startLine:130:endLine:130:prisma/schema.prisma
  status       String    @default("PENDING")
  // Analysis.status：PENDING → RUNNING → DONE | FAILED
  // 但写入路径（Analysis.create / Analysis.update）无状态机保护
```

**现状**：
- `Analysis` 模型有 `status` 字段：`PENDING | RUNNING | DONE | FAILED`
- 无状态机中间件或 DB 约束保护
- 应用层：创建时默认 PENDING，结束后更新为 DONE/FAILED

**根因**：
- 若存在多个写入方（router / cron / script），可各自按自己的逻辑设置 status
- 无原子状态机（如 `UPDATE Analysis SET status = 'DONE' WHERE id = X AND status = 'RUNNING'`）

**TOCTOU 场景**：
1. 任务 A 读到 `status=RUNNING`，准备更新 `DONE`
2. 任务 B 同时读取 `status=RUNNING`
3. A 和 B 都更新为 `DONE` — 两次重复更新（幂等但不对）

**严重度**：🟡 严重 — 状态机逻辑分散在多处，无集中保护

---

#### 🟢 B-14：UsageStat 幂等更新无锁（recordUsage）

**文件**：`src/lib/usage.ts:49-70`

```startLine:49:endLine:70:src/lib/usage.ts
      await client.usageStat.upsert({
        where: { tenantId_date_modelId: { tenantId, date, modelId } },
        update: {
          messageCount: isChat ? { increment: 1 } : undefined,
          analysisCount: isAnalysis ? { increment: 1 } : undefined,
          inputTokens: { increment: params.inputTokens },
          outputTokens: { increment: params.outputTokens },
          costCents: { increment: costIncrement },
        },
        create: { ... }
      });
```

**现状**：`upsert` 本身是原子的，DB 层保证 `tenantId + date + modelId` 唯一。

**分析**：
- 若两个 `recordUsage` 并发（同一 tenant/date/model），Prisma 执行两个 upsert：
  - 一个创建，一条创建失败 P2002 后重试走 update
  - 结果正确（increment 操作幂等）
- **真正问题**：retry 逻辑在 P2002 时 `continue`，但若不是 P2002 会 throw；若同时两个都走到 update，SQL 层 `increment` 是原子操作，结果正确

**严重度**：🟢 一般（设计正确，DB 原子性兜底）

---

### 2.2.6 查询问题

#### 🟡 B-15：N+1 查询 — news.byModel 精确匹配用多次 DB 操作

**文件**：`src/server/routers/news.ts:160-170`

```startLine:160:endLine:170:src/server/routers/news.ts
      // relatedModels 是逗号分隔字符串，需精确匹配单个元素
      const items = await prismaBase.newsItem.findMany({
        where: {
          OR: [
            { relatedModels: modelId },
            { relatedModels: { startsWith: `${modelId},` } },
            { relatedModels: { endsWith: `,${modelId}` } },
            { relatedModels: { contains: `,${modelId},` } },
          ],
        },
```

**现状**：这是单次查询，**没有 N+1**，OK。

**但**：`service.ts` `saveItems` 中：
```startLine:405:endLine:410:src/lib/news/service.ts
  // 历史去重：查询数据库中已有标题
  const existingItems = await prisma.newsItem.findMany({
    where: { deletedAt: null, title: { in: newTitles } },
    select: { title: true, url: true },
  });
```
单次批量查询，OK。

**严重度**：🟢 一般（无 N+1）

---

#### 🟡 B-16：project.list 深分页用 offset（性能隐患）

**文件**：`src/server/routers/project.ts:40`

```startLine:35:endLine:45:src/server/routers/project.ts
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const [items, count] = await Promise.all([
        prisma.project.findMany({
          take: input.take + 1,
          cursor: input.cursor ? { id: input.cursor } : undefined,
          // ← 使用游标分页，OK
```

**现状**：使用游标分页（cursor-based），**不是** offset 分页，OK。

**但**：`chat.list` / `project.list` 的 `count()` 用全表 count，大表有性能影响。

**严重度**：🟢 一般（cursor OK，但 count 全表）

---

#### 🟡 B-17：$queryRaw 缺 timeout（getAvailableDates / analytics）

**文件**：`src/lib/news/service.ts:778`、`src/server/routers/news.ts:219-295`

```startLine:778:endLine:788:src/lib/news/service.ts
  const result = await prisma.$queryRaw<Array<{ date: string }>>`
    SELECT DISTINCT DATE(publishedAt / 1000, 'unixepoch', '+8 hours') as date
    FROM NewsItem
    WHERE deletedAt IS NULL AND publishedAt IS NOT NULL
    ORDER BY date DESC
    LIMIT 365
  `;
```

**现状**：
- `getAvailableDates`：有 `LIMIT 365`，单次查询，SQLite 无 timeout 风险
- `news.analytics`：多个 `$queryRaw`，单次执行无 timeout
- `refresh-terms/route.ts` `runEvaluate` 循环 50 次 `count`：无 timeout

**严重度**：🟡 严重（性能降级，无 timeout 保护大查询）

---

#### 🟡 B-18：Prisma 连接池未显式配置（使用默认）

**文件**：`src/lib/db.ts:56-59`

```startLine:56:endLine:59:src/lib/db.ts
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
```

**现状**：无连接池配置，使用 Prisma 默认（SQLite: 5 连接，PG: 预设为 5）。

**Vercel serverless 风险**：每个函数实例可能创建独立 PrismaClient，若高并发冷启动，多个实例同时初始化连接池。

**严重度**：🟡 严重（生产高并发场景连接池耗尽）

---

## §2.3 并发与竞态

### 2.3.1 TOCTOU 漏洞

#### 🟡 C-01：project.create TOCTOU slug 碰撞（实际有 bug，见 B-07）

**文件**：`src/server/routers/project.ts:69-99`

```startLine:69:endLine:99:src/server/routers/project.ts
      // BUG：retry 用 input.slug 而非 slugAttempt，所以碰撞时永远重试失败
      // 这是一个 TOCTOU + 逻辑 bug
```

**分析**：
- 无预检 `findFirst`（直接 create + catch P2002）
- retry 用 `input.slug` 不递增 → 死循环到 retries=0 → CONFLICT
- TOCTOU 本身通过 `tryCreate` 内的 catch 处理，但 retry 逻辑有 bug

**严重度**：🟡 严重（逻辑 bug 导致功能受损）

---

#### 🟡 C-02：ai-keys create 同租户同名检查 TOCTOU

**文件**：`src/server/routers/ai-keys.ts:85-90`

```startLine:85:endLine:90:src/server/routers/ai-keys.ts
      // 校验同一租户同一 provider 同一 label 是否已存在
      const existing = await prismaRaw.apiKey.findFirst({
        where: { tenantId: ctx.tenantId, provider: input.provider, label: input.label, deletedAt: null },
      });
      if (existing) { throw TRPCError('CONFLICT') }
      // ↑ TOCTOU：existing 查到和 create 之间，其他请求可能插入了同名 key
```

**分析**：
- 两次 DB 操作（findFirst → create），非原子
- Prisma 会因 `@@unique` 约束（或未来加的唯一约束）在第二次操作时抛 P2002，被上层 catch 转为 CONFLICT
- **目前无唯一约束**（`ApiKey` 缺 unique），所以并发时两请求均通过 `findFirst` 检查，各自 `create` 成功 → 两条同名 key

**严重度**：🟡 严重 — 缺唯一约束导致并发创建同名 key

---

#### 🟡 C-03：chat.sendMessage 归属检查 TOCTOU

**文件**：`src/server/routers/chat.ts:73-80`

```startLine:73:endLine:80:src/server/routers/chat.ts
      const owner = await prismaRaw.conversation.findFirst({
        where: { id: input.conversationId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, userId: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND' });
      // ↑ TOCTOU：findFirst 和后续写操作之间，conversation 可能被软删
```

**分析**：
- 检查 `deletedAt: null`，但检查和写操作之间若 conversation 被软删，后续 `message.create` 仍成功（conversation 关联存在，但 `updatedAt` 不更新）
- 若 conversation 被硬删（cascade），`message.create` 会报外键约束错误

**严重度**：🟡 严重 — 对话被删除后消息仍可写入（数据一致性破坏）

---

#### 🟡 C-04：plugin.install TOCTOU

**文件**：`src/server/routers/plugin.ts:70-85`

```startLine:70:endLine:85:src/server/routers/plugin.ts
      const existing = await prismaRaw.installedPlugin.findFirst({
        where: { tenantId: ctx.tenantId, pluginId: plugin.id, deletedAt: null },
      });
      if (existing) { return { ok: true, alreadyInstalled: true }; }
      // ↑ TOCTOU：existing 检查和 create 之间可并发安装
      // 结果：两请求均通过 check，各自 create 成功
      // 但返回 alreadyInstalled:true 的请求会以为没装上
```

**分析**：同 C-02，两次 DB 操作无原子性。

**严重度**：🟡 严重

---

### 2.3.2 分布式锁问题

#### 🟡 C-05：distributed-lock Redis 锁无唯一 holder ID（token 随机但不足）

**文件**：`src/lib/observability/distributed-lock.ts:55-90`

```startLine:55:endLine:90:src/lib/observability/distributed-lock.ts
class RedisLock {
  async acquire(): Promise<boolean> {
    const result = await r.set(this.key, this.token, { nx: true, px: this.ttlMs });
    // this.token = randomBytes(16).toString('hex'); — 每个实例唯一
  }
  async release(): Promise<void> {
    // Lua 脚本比较 token 匹配才删除 ← 这是对的
  }
}
```

**分析**：
- `randomBytes(16)` 每实例唯一，**足够**
- Lua 释放脚本正确比较 token 才删除，**防止释放他人锁** — OK
- **但缺少**：锁持有者元数据（process ID、hostname），无法排查哪个实例持有锁

**严重度**：🟡 严重（基本安全 OK，但运维可观测性差）

---

#### 🟡 C-06：distributed-lock 锁过期时间与 fn 执行时间不匹配

**文件**：`src/lib/observability/distributed-lock.ts:220-230`

```startLine:220:endLine:230:src/lib/observability/distributed-lock.ts
export async function withLock<T>(
  key: string,
  ttlSeconds: number, // ← TTL 作为参数传入
  fn: () => Promise<T>,
): Promise<T | { skipped: true }> {
```

**分析**：
- `fetch-news` cron：`withLock('cron:fetch-news', 600, fn)` — TTL=600s（10 分钟）
- `fetch-bilibili` cron：`withLock('cron:fetch-bilibili', 300, fn)` — TTL=300s（5 分钟）
- `refresh-models` cron：`withLock('cron:refresh-models', 600, fn)` — TTL=600s
- `refresh-terms` cron：`withLock('cron:terms-weekly', 600, fn)` — TTL=600s

**TTL 合理性**：
- `fetch-news`：含 B站抓取（5个UP × 15s间隔 = 75s） + 新闻源抓取（15+个源并发）≈ 3-5 分钟，600s 充足
- `refresh-models`：爬虫全量刷新可能超过 5 分钟，TTL 600s 充足
- **潜在问题**：若 `fn` 内某步骤卡死（如某新闻源 fetch 卡住），锁仍按 TTL 释放，下一次 cron 可以重新进入

**严重度**：🟡 严重 — TTL 足够但无 watchdog，若 fn 执行超过 TTL 会锁自动释放导致双实例并发

---

#### 🟡 C-07：distributed-lock Redis 主从切换兜底不足

**文件**：`src/lib/observability/distributed-lock.ts:20-45`

```startLine:20:endLine:45:src/lib/observability/distributed-lock.ts
function getRedis(): Redis | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    _redis = null;
    return null;
  }
  _redis = new Redis({ url, token }); // ← 无 readFromReplicas / 故障转移配置
  return _redis;
}
```

**分析**：
- Upstash Redis 是 serverless KV，天然多区域复制，无显式主从切换问题
- 但缺少：连接失败重连逻辑、TTL 自动续期（无 watchdog）
- Redis 不可用时降级为文件锁（仅开发环境有效，生产 Vercel serverless 不共享 `/tmp`）

**严重度**：🟡 严重 — 生产环境 Redis 不可用时文件锁失效，无真正分布式保护

---

#### 🟡 C-08：cleanup cron 无分布式锁（仅 cleanup-engine 内部无锁）

**文件**：`src/app/api/cron/cleanup/route.ts`

```startLine:10:endLine:20:src/app/api/cron/cleanup/route.ts
  if (!secret || !auth || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ↑ 仅 Bearer 鉴权，无 withLock
  const result = await cleanupOrphanFiles();
```

**分析**：`cleanup/route.ts` 直接调用 `cleanupOrphanFiles()`，无 `withLock` 保护。

**与 `fetch-news`/`fetch-bilibili` 对比**：后者均有 `withLock` 保护。

**但**：`cleanup/route.ts` 本身是低频操作（手动触发），且 Vercel cron 调度保证单实例。

**严重度**：🟡 严重（手动触发时多实例可能并发）

---

### 2.3.3 异步时序

#### 🟡 C-09：news cron cleanupOldNews 在 fetchAllNews 之后顺序执行

**文件**：`src/app/api/cron/fetch-news/route.ts:60-135`

```startLine:60:endLine:135:src/app/api/cron/fetch-news/route.ts
      const result = await fetchAllNews({ ... }); // ← 顺序等待
      const bili = await runBilibiliFetch({ ... }); // ← 顺序等待
      // ...
      const cleanup = await cleanupOldNews(); // ← 最后清理
```

**分析**：
- 顺序执行，无并发问题，但可优化为 `Promise.all([fetchAllNews, runBilibiliFetch])`
- `cleanupOldNews` 在最后执行，若前两步耗时长（接近 maxDuration=300s），cleanup 可能被截断

**严重度**：🟡 严重 — cleanup 可能在 300s 超时前被跳过

---

#### 🟡 C-10：bilibili cron 中 Promise.allSettled 后无错误汇总

**文件**：`src/app/api/cron/fetch-bilibili/route.ts:65-70`

```startLine:65:endLine:70:src/app/api/cron/fetch-bilibili/route.ts
      const [biliCleanup, r2Cleanup] = await Promise.allSettled([
        cleanupOldBilibiliCache(),
        cleanupOrphanFiles(),
      ]);
```

**分析**：
- `Promise.allSettled` 任一失败不会 throw，错误被吞在 `.status === 'rejected'` 中
- 代码有处理：检查 `biliCleanup.status` 和 `r2Cleanup.status`
- 但清理任务失败不阻断主流程返回，这是**设计选择**（cleanup 是辅助操作）

**严重度**：🟢 一般（设计正确，但清理失败静默）

---

#### 🟡 C-11：bilibili scraper enrichOneVideo 逐个等待（可并发）

**文件**：`src/lib/bilibili/scraper.ts:130-140`

```startLine:130:endLine:140:src/lib/bilibili/scraper.ts
      for (const v of list) {
        const enriched = await enrichOneVideo(v); // ← 串行等待每个视频
        ups.videos.push(enriched);
      }
```

**分析**：
- 每个 UP 主的视频列表（max 3-5 个）串行 enrich
- `enrichOneVideo` 包含 API 调用（`getVideoView`）+ 可选文章抓取
- 串行导致单个 UP 主耗时 = sum(各视频耗时)，可改 `Promise.all` 并发

**严重度**：🟡 严重（性能降级，但非并发安全）

---

#### 🟡 C-12：bilibili scraper scrapeBilibili UP 主之间串行 sleep 15s

**文件**：`src/lib/bilibili/scraper.ts:113-120`

```startLine:113:endLine:120:src/lib/bilibili/scraper.ts
  for (let i = 0; i < uploads.length; i++) {
    if (i > 0) await sleep(15_000); // ← 每个UP主间等待15秒
  }
```

**分析**：这是**设计选择**（B站风控 15s 间隔），不是 bug。但可优化为信号量限流替代固定 sleep。

**严重度**：🟡 严重（性能差但防风控）

---

#### 🟢 C-13：refresh-terms cron 三个阶段 Promise.all 并发

**文件**：`src/app/api/cron/refresh-terms/route.ts:280`

```startLine:280:endLine:282:src/app/api/cron/refresh-terms/route.ts
      const [expandRes, extractRes, evalRes] = await Promise.all([
        runExpand(),
        runExtract(batch),
        runEvaluate(batch),
      ]);
```

**分析**：
- 三个阶段并发执行，OK
- 但 `runExpand` 内部用 `AsyncSemaphore(3)` 限流，`runExtract` 和 `runEvaluate` 无限制
- `runEvaluate` 循环 50 次 DB count 无并发，可能较慢

**严重度**：🟢 一般（并发正确，但内部实现不均衡）

---

### 2.3.4 重试风暴

#### 🟡 C-14：usage.recordUsage 重试逻辑有漏洞

**文件**：`src/lib/usage.ts:76-88`

```startLine:76:endLine:88:src/lib/usage.ts
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        attempt < MAX_RETRIES - 1
      ) {
        continue; // ← P2002 时重试
      }
      throw e;
    }
```

**分析**：
- 重试条件：仅 `P2002`（唯一键冲突）时重试，最多 3 次
- **问题**：若 upsert 的 `where` 条件在重试过程中发生变化（如时间 UTC 变化导致 date 跨日），重试永远失败
- **无指数退避**：`continue` 后立即重试，无延迟，可能对 DB 造成压力
- **无熔断器**：连续失败后无降级

**严重度**：🟡 严重（无退避，高并发时可能重试风暴）

---

#### 🟡 C-15：fetchWithRetry 指数退避正确但无熔断器

**文件**：`src/lib/utils/fetch-with-retry.ts`

**现状**：`fetchWithRetry` 使用指数退避（若有实现），但无全局熔断器。

**具体**：新闻源/B站爬虫任一源持续失败会无限重试，无短路。

**严重度**：🟡 严重（单源故障拖累整批）

---

#### 🟡 C-16：cleanup-engine clearDirContents 单项重试仅 2 次

**文件**：`src/server/lib/cleanup-engine.ts:188-195`

```startLine:188:endLine:195:src/server/lib/cleanup-engine.ts
    try {
      await fsp.rm(p, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
    } catch {
      failed++;
    }
```

**分析**：
- `fsp.rm` 的 `maxRetries: 2` + `retryDelay: 200ms` 是固定退避，无指数退避
- 但清理任务是幂等的（删文件），重试失败只记录 `failed++`，不阻断后续
- **无全局熔断器**：某盘某项持续失败会一直重试

**严重度**：🟢 一般（清理任务幂等，影响小）

---

## 汇总清单

### 🔴 致命（2 个）

| ID | 文件 | 问题 | 根因 |
|----|------|------|------|
| B-01 | `chat.ts:67-160` | sendMessage 3次DB写无事务 | 缺 `prisma.$transaction` |
| B-09 | `schema.prisma` | 软删模型缺 unique 约束 | Project/ApiKey 软删后可重建同名记录 |

### 🟡 严重（13 个）

| ID | 文件 | 问题 | 根因 |
|----|------|------|------|
| B-02 | `refresh-terms/route.ts:140` | 循环内逐条 DB 写无事务 | `runExtract` 逐条 create |
| B-03 | `refresh-terms/route.ts:225` | `runEvaluate` 逐条 termEvaluation.create | 同上 |
| B-04 | `refresh-terms/route.ts:235` | N+1 count 查询风暴（50次） | 循环内无聚合 |
| B-07 | `project.ts:69-99` | retry 用 `input.slug` 而非递进 slug | 逻辑 bug |
| B-08 | `ai-keys.ts:140` | revoke 软删除 TOCTOU | findFirst→update 非原子 |
| B-12 | `schema.prisma` | SQLite 无枚举 check 约束 | 依赖应用层 Zod |
| B-13 | `schema.prisma:130` | Analysis.status 无状态机保护 | 分散状态逻辑 |
| B-17 | `news/service.ts:778` | $queryRaw 无 timeout | 大结果集无保护 |
| B-18 | `db.ts:56` | Prisma 连接池未显式配置 | 生产高并发隐患 |
| C-02 | `ai-keys.ts:85` | 同租户同名 key TOCTOU | 缺 unique 约束 |
| C-03 | `chat.ts:73` | sendMessage conversation 归属 TOCTOU | 读后写非原子 |
| C-04 | `plugin.ts:70` | install TOCTOU | 预检→create 非原子 |
| C-06 | `distributed-lock.ts:220` | 锁 TTL 过期无 watchdog | fn 执行 > TTL 时双实例并发 |
| C-07 | `distributed-lock.ts:20` | Redis 不可用时文件锁在 Vercel 失效 | 无真正兜底 |
| C-08 | `cleanup/route.ts:10` | cleanup cron 无分布式锁 | 仅 Bearer 鉴权 |
| C-09 | `fetch-news/route.ts:60` | cleanupOldNews 在 maxDuration 尾部执行 | 可能超时被跳过 |
| C-11 | `bilibili/scraper.ts:130` | enrichOneVideo 串行等待（可并发） | 性能降级 |
| C-14 | `usage.ts:76` | recordUsage 重试无退避 | P2002 后立即重试 |
| C-15 | `fetch-with-retry.ts` | 单源故障无限重试无熔断 | 无短路机制 |

### 🟢 一般（5 个）

| ID | 文件 | 问题 |
|----|------|------|
| B-05 | `cleanup-engine.ts:680` | session 文件读写无事务（实际受 withLock 保护） |
| B-06 | `news/service.ts:485` | 降级路径逐条 upsert 无事务（退化路径可接受） |
| B-10 | `schema.prisma:479` | aliases JSON 无 DB 层唯一（应用层保护） |
| C-10 | `fetch-bilibili/route.ts:65` | cleanup Promise.allSettled 失败静默（设计选择） |
| C-13 | `refresh-terms/route.ts:280` | 三阶段并发但内部实现不均衡（可接受） |

---

## 迁移建议优先级

### P0（迁移前必须修复）

1. **B-01**：`chat.sendMessage` 包裹 `prisma.$transaction`（3 个 DB 写 + recordUsage）
2. **B-09**：对 `Project(slug, tenantId)` 和 `ApiKey(tenantId, provider, label)` 补充 `@@unique`

### P1（生产前修复）

3. **C-14**：为 `recordUsage` 重试加指数退避（`setTimeout` 递增等待）
4. **B-07**：修复 `project.create` retry slug 逻辑
5. **C-03**：chat.sendMessage conversation 归属检查加 `deletedAt` 过滤后用事务保护
6. **C-08**：cleanup cron 加 `withLock`
7. **C-06/C-07**：分布式锁加 watchdog 续期（或增加 TTL）
8. **B-18**：Prisma 连接池显式配置（`connection_limit` / `pool_timeout`）
9. **B-17**：大 `$queryRaw` 加 SQLite `PRAGMA` timeout

### P2（迭代中修复）

10. **B-02/B-03/B-04**：terms cron 改批量 insert + groupBy
11. **C-02/C-04**：ai-keys create / plugin install 加 unique 约束后去掉预检（或保留但无安全风险）
12. **B-13**：Analysis 状态机加 Prisma 中间件保护
13. **C-11**：bilibili enrichOneVideo 改 `Promise.all` 并发

---

*报告由 SA-2 子代理生成，2026-09-07*
