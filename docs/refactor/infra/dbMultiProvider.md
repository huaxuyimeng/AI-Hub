# dbMultiProvider · 数据库多 Provider 配置设计

> 创建于 2026-09-07
> 配套：[`infra/envLayering.md`](./envLayering.md) §6.1 + [`infra/monorepoTopology.md`](./monorepoTopology.md)
> 状态：**设计稿，未落地**

---

## 1. 一句话目标

让 AIHub 在 **开发**（SQLite）+ **生产**（PostgreSQL）两个环境之间**无缝切换**，无需改代码。

---

## 2. 当前现状

| 维度 | 现状 |
|---|---|
| Schema 文件 | `prisma/schema.prisma`（单文件） |
| dev DB | `file:./dev.db`（SQLite） |
| prod DB | PostgreSQL（推测 RDS / Vercel Postgres） |
| 切换方式 | 手工改 `.env` 的 `DATABASE_PROVIDER` + `DATABASE_URL`，然后 `prisma generate` |
| 痛点 | schema.prisma 中 SQLite 特有类型（如 `Json`）与 PostgreSQL 略有差异；某些 raw SQL（如 `DATE(.../1000,'unixepoch','+8 hours')`）只在 SQLite 生效 |

---

## 3. 多 Provider 策略（4 步）

### 3.1 拆分 schema.prisma 为多个

```
prisma/
├── schema.base.prisma           # 共用 schema（model 定义）
├── schema.sqlite.prisma         # SQLite 特有配置
├── schema.postgres.prisma       # PostgreSQL 特有配置
└── schema.prisma                # 入口（generator + datasource）
```

**入口 `schema.prisma`**：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = env("DATABASE_PROVIDER")
  url      = env("DATABASE_URL")
}
```

**共用部分 `schema.base.prisma`**：

```prisma
// 全部 model 定义都放这里
model User { ... }
model Project { ... }
model ApiKey { ... }
// ...
```

### 3.2 编写 schema 合并脚本

```ts
// scripts/merge-schema.ts
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
const variantFile = resolve(`prisma/schema.${provider}.prisma`);
const baseFile = resolve('prisma/schema.base.prisma');
const entryFile = resolve('prisma/schema.prisma');

const entry = readFileSync(entryFile, 'utf-8');
const variant = readFileSync(variantFile, 'utf-8');
const base = readFileSync(baseFile, 'utf-8');

// 拼接：generator + datasource + variant + base
const merged = entry + '\n\n' + variant + '\n\n' + base;
writeFileSync(resolve('prisma/schema.prisma'), merged, 'utf-8');

console.log(`✅ Merged schema for provider: ${provider}`);
```

### 3.3 SQLite 特有配置 `schema.sqlite.prisma`

```prisma
// SQLite 仅支持有限的数据类型
// 例如：Json → TEXT
// 例如：无原生 ARRAY / JSONB
```

> 当前 SQLite 版本在 `schema.prisma` 直接用 `Json` 字段可工作（Prisma 内部序列化为 JSON 字符串）。

### 3.4 PostgreSQL 特有配置 `schema.postgres.prisma`

```prisma
// PostgreSQL 支持更多原生类型
// 例如：Json → JSONB
// 例如：原生 ARRAY、UUID、CITEXT 等

// 启用扩展
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearch", "fullTextIndex"]
}
```

---

## 4. 切换流程（开发者视角）

### 4.1 切换到 PostgreSQL

```bash
# 1. 改 env
echo 'DATABASE_PROVIDER=postgresql' >> .env
echo 'DATABASE_URL=postgresql://user:pass@localhost:5432/aihub' >> .env

# 2. 重新生成 schema + client
pnpm db:merge-schema
pnpm db:generate

# 3. 跑迁移
pnpm db:migrate dev --name init

# 4. 启动
pnpm dev
```

### 4.2 切换到 SQLite

```bash
# 1. 改 env
echo 'DATABASE_PROVIDER=sqlite' >> .env
echo 'DATABASE_URL=file:./dev.db' >> .env

# 2. 重新生成 schema + client
pnpm db:merge-schema
pnpm db:generate

# 3. 启动（自动 db push）
pnpm dev
```

### 4.3 一键切换脚本

```bash
# scripts/switch-db.sh
#!/usr/bin/env bash
set -e

PROVIDER=${1:-sqlite}
DB_URL=${2:-file:./dev.db}

echo "🔄 Switching to $PROVIDER..."
sed -i "s/^DATABASE_PROVIDER=.*/DATABASE_PROVIDER=$PROVIDER/" .env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" .env

pnpm db:merge-schema
pnpm db:generate

echo "✅ Switched to $PROVIDER ($DB_URL)"
```

---

## 5. Raw SQL 兼容性

### 5.1 当前已知的 SQLite 特定 SQL

```ts
// src/lib/news/service.ts:472-484
// SQLite: DATE(publishedAt/1000,'unixepoch','+8 hours')
// PostgreSQL: TO_TIMESTAMP(publishedAt/1000) AT TIME ZONE 'Asia/Shanghai'
```

**解决方案**：用 Prisma 的 `$queryRaw` 包装：

```ts
// packages/db/src/infra/dateFunc.ts
export function beijingDayStartSql(field: string): string {
  if (process.env.DATABASE_PROVIDER === 'postgresql') {
    return `DATE_TRUNC('day', (${field}::bigint / 1000)::timestamp AT TIME ZONE 'Asia/Shanghai')`;
  }
  // SQLite
  return `DATE(${field}/1000, 'unixepoch', '+8 hours')`;
}
```

### 5.2 其他需注意的差异

| 维度 | SQLite | PostgreSQL |
|---|---|---|
| `Json` 字段 | TEXT（Prisma 序列化） | JSONB（原生） |
| `DateTime` | 整数毫秒 | timestamp |
| `@@unique` 多 NULL | 允许（每行独立） | 视为相等（违反） |
| 大小写敏感 | 是 | 否（除非加引号） |
| `mode: 'insensitive'` | 不支持 | 支持 |
| `take: -1` | 反转语义 | 反转语义 |

---

## 6. 多租户中间件兼容

`createTenantPrisma` 中间件需要适配：

```ts
// packages/db/src/infra/createTenantPrisma.ts

const isPostgres = process.env.DATABASE_PROVIDER === 'postgresql';

// PostgreSQL 支持模式隔离（如 aihub_<tenantId>）
// SQLite 仅支持 row-level（tenantId 字段）

export function createTenantPrisma(ctx: Ctx): PrismaClient {
  if (isPostgres && ENABLE_SCHEMA_ISOLATION) {
    return new PrismaClient({
      datasources: {
        db: { url: `${baseUrl}?schema=aihub_${ctx.tenantId}` },
      },
    });
  }
  return new PrismaClient();  // 现有 row-level 实现
}
```

> 默认仍用 row-level（与现状一致）；schema 隔离是 P3 远期增强。

---

## 7. CI / 部署集成

### 7.1 GitHub Actions

```yaml
# .github/workflows/test.yml
jobs:
  test-sqlite:
    runs-on: ubuntu-latest
    env:
      DATABASE_PROVIDER: sqlite
      DATABASE_URL: file:./test.db
    steps:
      - run: pnpm test

  test-postgres:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
    env:
      DATABASE_PROVIDER: postgresql
      DATABASE_URL: postgresql://postgres:test@localhost:5432/test
    steps:
      - run: pnpm test
```

### 7.2 Vercel 部署

```json
// vercel.json
{
  "env": {
    "DATABASE_PROVIDER": "postgresql",
    "DATABASE_URL": "@database-url"   // 引用 Vercel Postgres
  }
}
```

---

## 8. 风险清单

| # | 风险 | 缓解 |
|---|---|---|
| D1 | Schema 拆分后 model 重复定义 | 严格：仅 base 含 model，variant 仅含 provider-specific 配置 |
| D2 | 切换 provider 后 raw SQL 报错 | 集中到 `dbFunctions.ts`，按 provider 分支 |
| D3 | CI 没跑 PostgreSQL → 生产部署挂 | 加 `test-postgres` job |
| D4 | Prisma client 缓存导致旧 client 用 | `pnpm db:generate` 后强制重启 dev server |
| D5 | 数据迁移（SQLite → PostgreSQL） | 用 `prisma migrate` 或手动导出导入 |

---

## 9. 验收清单

- [ ] `schema.base.prisma` 含所有 model（无 provider-specific 字段）
- [ ] `schema.sqlite.prisma` / `schema.postgres.prisma` 仅含配置
- [ ] `pnpm db:merge-schema` 生成正确的 schema.prisma
- [ ] 切换 provider 后 `pnpm db:generate` 无错
- [ ] `pnpm dev` 在两种 provider 下都能启动
- [ ] `pnpm test` 在两种 provider 下都通过
- [ ] CI 包含两种 provider 的测试 job

---

## 10. 过期条件

- 引入 Prisma migrate（替换 db push）
- 添加 MySQL 支持
- 引入 schema isolation（多租户独立 schema）
- 切换 ORM（Drizzle / Kysely）

---

**创建时间**：2026-09-07
**下次更新**：第一次切换到 PostgreSQL 部署前
