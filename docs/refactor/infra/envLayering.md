# envLayering · 环境分层设计

> 创建于 2026-09-07
> 状态：**设计稿，未落地**
> 配套：[`monorepoTopology.md`](./monorepoTopology.md)

---

## 1. 一句话目标

把环境变量按 **敏感级别 + 作用域** 分层管理，避免：

- 私密 key 误入 git
- 团队成员本地配置互相覆盖
- 生产/开发配置混杂

---

## 2. 分层方案（5 层）

```
优先级从高到低（后者覆盖前者）：

1. .env.base              公共默认值（git tracked）
2. .env.development       开发公共（git tracked，仅团队共享 dev 配置）
3. .env.local             本地覆盖（git ignored，个人配置）
4. .env.production        生产覆盖（git ignored，仅部署时注入）
5. .env.secret            私密变量（git ignored，仅部署时注入真实 key）
```

### 2.1 加载顺序

```bash
# Node 启动时按此顺序加载（后加载覆盖前加载）
dotenv -e .env.base
dotenv -e .env.development      # NODE_ENV=development 时
dotenv -e .env.local           # 永远加载（个人配置）
dotenv -e .env.production      # NODE_ENV=production 时
dotenv -e .env.secret          # 永远最后加载（部署时手动注入）
```

### 2.2 git 状态矩阵

| 文件 | git 状态 | 谁写 | 谁读 |
|---|---|---|---|
| `.env.base` | ✅ tracked | 团队 commit | 所有环境 |
| `.env.development` | ✅ tracked | 团队 commit | 仅 dev |
| `.env.production` | ❌ ignored | 部署时手动 | 仅 prod |
| `.env.local` | ❌ ignored | 开发者手动 | 仅本地 |
| `.env.secret` | ❌ ignored | 部署时手动 | 所有 |

### 2.3 `.gitignore` 模板

```gitignore
# Local / Secret / Production env files
.env.local
.env.secret
.env.production

# Keep examples (committed for documentation)
!.env.base.example
!.env.development.example
!.env.local.example
!.env.production.example
!.env.secret.example
```

---

## 3. 各层职责边界

### 3.1 `.env.base`（公共默认值）

- **谁能改**：所有人
- **何时改**：新增公共配置项时
- **示例**：
  ```
  DATABASE_PROVIDER=sqlite
  DATABASE_URL=file:./dev.db
  NODE_ENV=development
  NEXTAUTH_URL=http://localhost:3000
  ```

### 3.2 `.env.development`（开发公共）

- **谁能改**：所有人
- **何时改**：dev 工具链调整时（如 Redis 端口）
- **示例**：
  ```
  REDIS_URL=redis://localhost:6379
  R2_BUCKET=aihub-dev
  LOG_LEVEL=debug
  ```

### 3.3 `.env.local`（本地覆盖）

- **谁能改**：开发者本人
- **何时改**：个人 dev 偏好
- **示例**：
  ```
  DATABASE_URL=file:./my-personal.db
  LOG_LEVEL=trace
  AIHUB_AI_MOCK=1
  ```

### 3.4 `.env.production`（生产覆盖）

- **谁能改**：部署管理员
- **何时改**：生产配置变更时
- **示例**：
  ```
  DATABASE_PROVIDER=postgresql
  DATABASE_URL=postgresql://user:pass@host:5432/db
  NODE_ENV=production
  ```

### 3.5 `.env.secret`（私密变量）

- **谁能改**：仅 owner
- **何时改**：API key 轮换时
- **示例**：
  ```
  DEEPSEEK_API_KEY=sk-xxx
  ANTHROPIC_API_KEY=sk-ant-xxx
  GOOGLE_GENERATIVE_AI_API_KEY=AIza-xxx
  NEXTAUTH_SECRET=base64-xxx
  R2_ACCESS_KEY_ID=xxx
  R2_SECRET_ACCESS_KEY=xxx
  ```

---

## 4. env 加载器实现

### 4.1 单 Node 进程

```ts
// packages/config/src/envLoader.ts
import { config as dotenv } from 'dotenv';
import { resolve } from 'node:path';

const ENV_LAYERS = [
  '.env.base',
  process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development',
  '.env.local',      // 永远加载（个人配置）
  '.env.secret',     // 永远最后加载
];

export function loadEnv(rootDir = process.cwd()) {
  for (const file of ENV_LAYERS) {
    const path = resolve(rootDir, file);
    dotenv({ path, override: false });  // 不覆盖已有值
  }
}
```

**关键点**：

- `override: false`：后加载的**不会覆盖**先加载的（但 secret 例外，强制最后加载并 override=true）
- 顺序很关键：**先 base → 再 dev/prod → 再 local → 最后 secret**

### 4.2 Next.js 集成

```js
// next.config.js
import './packages/config/src/envLoader';
```

或在 `package.json` 的 `scripts.dev` 前置：

```json
"dev": "tsx packages/config/src/envLoader.ts && next dev"
```

---

## 5. 与现有 `.env.example` 的关系

**当前**：`根目录 .env.example`（一份）→ **目标**：5 份对应层

迁移路径：

```
.env.example          → 拆为：
                          .env.base.example
                          .env.development.example
                          .env.local.example
                          .env.production.example
                          .env.secret.example
```

迁移步骤：

1. 在 `docs/refactor/env/` 创建 5 份 `.example` 模板（详见 §6）
2. 在 README 顶部说明"5 层加载顺序"
3. 用户确认后，git mv `.env.example` → `.env.base.example`
4. 增量补齐其余 4 份

---

## 6. 5 份 `.example` 模板（首批）

### 6.1 `.env.base.example`

```bash
# 公共默认值（git tracked）
# 所有环境都会加载

# === Runtime ===
NODE_ENV=development
NEXTAUTH_URL=http://localhost:3000
PORT=3000

# === Database ===
DATABASE_PROVIDER=sqlite            # sqlite | postgresql
DATABASE_URL=file:./dev.db

# === AI Provider Routing ===
# deepseek-v4-flash 是默认模型；其他 provider 通过 key 启用
AIHUB_DEFAULT_MODEL=deepseek-v4-flash
AIHUB_AI_MOCK=1                      # dev 模式无 key 时走 mock

# === Logging ===
LOG_LEVEL=info                       # trace | debug | info | warn | error
LOG_FORMAT=json                      # json | pretty
```

### 6.2 `.env.development.example`

```bash
# 开发公共配置（git tracked）
# 仅 NODE_ENV=development 时加载

REDIS_URL=redis://localhost:6379
R2_BUCKET=aihub-dev
R2_ENDPOINT=http://localhost:9000
R2_PUBLIC_URL=http://localhost:9000/aihub-dev

# Cron jobs（本地启动方式）
ENABLE_LOCAL_CRON=1
```

### 6.3 `.env.local.example`

```bash
# 本地覆盖（git ignored）
# 复制此文件为 .env.local 后修改

# 个人偏好示例
LOG_LEVEL=trace
DATABASE_URL=file:./my-personal.db
# AIHUB_AI_MOCK=1     # 强制走 mock（即使有 key）
```

### 6.4 `.env.production.example`

```bash
# 生产覆盖（git ignored）
# 部署时由 CI / 运维手动注入

NODE_ENV=production
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://user:pass@host:5432/aihub
NEXTAUTH_URL=https://aihub.example.com

# 生产性能 / 监控
LOG_LEVEL=warn
ENABLE_OTEL=1
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

### 6.5 `.env.secret.example`

```bash
# 私密变量（git ignored）
# 仅部署时手动注入，**绝不能 commit**

# === AI Providers ===
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
OPENAI_API_KEY=
LITELLM_BASE_URL=

# === Auth ===
NEXTAUTH_SECRET=                     # openssl rand -base64 32

# === Cloudflare R2 ===
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ACCOUNT_ID=

# === Upstash Redis（生产） ===
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# === Alerting（Slack） ===
SLACK_WEBHOOK_URL=

# === Cron Security ===
CRON_SECRET=                         # openssl rand -hex 32
```

---

## 7. 安全检查清单

- [ ] `.gitignore` 含 `.env.local` / `.env.secret` / `.env.production`
- [ ] CI 阶段跑 `git-secrets` 或 `trufflehog` 扫描历史 commit
- [ ] 任何 PR 修改 `.env.base.example` 必须额外 review
- [ ] `.env.secret` 仅部署时注入，**不在 docker image 中**
- [ ] 定期轮换 `NEXTAUTH_SECRET` 与 `CRON_SECRET`（每 90 天）

---

## 8. 落地顺序

| 阶段 | 动作 |
|---|---|
| P0 | 创建 5 份 `.example` 模板（仅文件，不改加载逻辑） |
| P0.5 | 在 README 增加"5 层加载顺序"说明 |
| P1 | 实现 `packages/config/src/envLoader.ts` |
| P1 | git mv `.env.example` → `.env.base.example` |
| P2 | Next.js `next.config.js` 集成 envLoader |
| P3 | 部署脚本（Docker / Vercel）按层注入 |

任一动作需单独报告 + 用户点头。

---

## 9. 过期条件

- 引入 6+ 层（如 `.env.staging`）→ 拆出独立的 `envLayering.staging.md`
- 切换部署平台（如 Vercel → Cloudflare Pages）→ 更新 §4.2 集成方式
- 引入运行时加密（如 SOPS / Vault）→ 拆出独立 `secretManager.md`

---

**创建时间**：2026-09-07
**下次更新**：P1 envLoader 实现后
