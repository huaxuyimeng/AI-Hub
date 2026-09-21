# AIHub

> **AI Workbench + AI Briefing Auto-Generation + Multi-Source Information Aggregation** — unify your AI content workflow in one interface.

[English](./README.md) · [简体中文](./README-zh.md)
---
Demo Document URL: https://huaxuyimeng.github.io/ai-hub-landing/ or https://ai-hub-landing.vercel.app/
---

## One-liner

**Let AI help you track AI news, auto-generate briefings, compare model prices, and follow Bilibili creators** — no more juggling between a dozen tools.

---

## Project Features

- **Unified Workbench** — news aggregation, model rankings, Bilibili tracking, AI briefings, and multi-agent meetings in one app
- **Multi-source News Aggregation** — auto-fetch from 10+ Chinese & English sources, scored on confidence × source quality × vendor tags
- **Model Rankings with Cost-Performance Algorithm** — Pareto-frontier weighted (capability 40% + price 30% + context window 30%), daily-updated, 50+ models
- **Bilibili Creator Tracking** — WBI signature reverse-engineering + SESSDATA Cookie login + RSS fallback, with subtitle semantic analysis
- **PPT Briefing Pipeline** — daily cron → LLM-generated JSON → IR lint validation → PPTX export, with self-built slide-engine
- **Multi-Role AI Meeting** — LangChain/LangGraph-based, multi-agent (PM / engineer / investor / critic) discussion, SSE streaming output
- **Multi-tenant + RBAC** — `createTenantPrisma(ctx)` forces tenantId injection; 9 whitelisted models include soft delete
- **Full TypeScript** — tRPC end-to-end type safety, zero implicit `any` from frontend → backend → database
- **AI Key Smart Routing** — single entry `key-resolver.ts`, multi-provider (DeepSeek / 智谱 / Anthropic / Kimi) auto-fallback
- **Production-Ready Engineering** — 180+ test cases, zero typecheck errors, comprehensive docs

---

## Tech Stack

### Frontend
| Tech | Version | Note |
|------|---------|------|
| Next.js | 14 | App Router |
| TypeScript | 5 | Full type safety |
| React | 18 | Server + Client Components |
| tRPC | 11 | End-to-end typed API |
| Tailwind / CSS Vars | - | 6 preset themes + HSL DIY |
| @tabler/icons-react | - | Unified icon library |

### Backend / AI
| Tech | Version | Note |
|------|---------|------|
| tRPC | 11 | Type-safe RPC, end-to-end with frontend |
| Prisma | 6 | ORM + multi-tenant + soft delete |
| NextAuth.js | 4 | GitHub OAuth + dev default account |
| LangChain Core | 0.3 | Streaming batching via custom adapter (`src/lib/ai/langchain-adapter`) |
| LangGraph | 0.2 | Multi-agent meeting state machine (`src/lib/meeting/graph.ts`) |
| OpenAI SDK | 4.65 | Direct calls + `ChatOpenAI` for smart routing |
| Anthropic SDK | 0.123 | `ChatAnthropic` integration |
| Google Generative AI | 0.24 | Gemini support |
| Zod | 3.23 | Runtime validation (env, tRPC inputs, IR schemas) |
| Superjson | 2.2 | tRPC transformer (Date / BigInt) |

> Note: AI routing goes through **direct SDK calls** (OpenAI / Anthropic / Google Generative AI), not LiteLLM proxy. Multi-provider auto-fallback lives in `src/lib/ai/router.ts` and `src/lib/ai/key-resolver.ts`.

### Storage / Infrastructure
| Tech | Version | Note |
|------|---------|------|
| PostgreSQL | 14+ | Production database |
| SQLite | - | Development fallback |
| Cloudflare R2 SDK (`@aws-sdk/client-s3`) | 3.654 | File storage (PPTX, avatars) |
| Upstash Redis | 1.34 | Cache + rate limiting + distributed lock |
| OpenTelemetry | 0.53 | APM tracing (`auto-instrumentations-node`) |
| Playwright | 1.62 | E2E testing |
| pptxgenjs | 4.0 | PPTX generation for daily briefings |
| tsx | 4.19 | TypeScript script runner for cron + tests |

### Notable Internal Modules
| Module | Path | Purpose | Doc |
|--------|------|---------|-----|
| slide-engine | `src/lib/slide-engine/` | PPT IR + lint + render (PPTX/HTML) | [`refactor/modules/slideEngine.md`](./docs/refactor/modules/slideEngine.md) |
| meeting | `src/lib/meeting/` | LangGraph multi-agent + streaming | [`refactor/modules/` + `docs/AI模块/langchain系列/`](./docs/AI%E6%A8%A1%E5%9D%97/langchain%E7%B3%BB%E5%88%97/) |
| news | `src/lib/news/parsers/` | Multi-source adapters (RSS/HTML/API) | [`refactor/modules/news.md`](./docs/refactor/modules/news.md) · [PRD](./docs/prd/modules/01-news-aggregator-prd.md) |
| bilibili | `src/lib/bilibili/` | WBI signature + Cookie + subtitle | [`refactor/modules/bilibili.md`](./docs/refactor/modules/bilibili.md) |
| rankings | `src/lib/rankings/` | Weighted algorithm + scraper | [`refactor/modules/rankings.md`](./docs/refactor/modules/rankings.md) · [PRD](./docs/prd/modules/02-rankings-prd.md) |
| ai langchain-adapter | `src/lib/ai/langchain-adapter/` | Streaming batching + usage callback | [`docs/AI模块/langchain系列/`](./docs/AI%E6%A8%A1%E5%9D%97/langchain%E7%B3%BB%E5%88%97/) |
| rag | `src/lib/rag/` | Retrieval-augmented generation | [`refactor/modules/rag.md`](./docs/refactor/modules/rag.md) |
| multimodal | `src/lib/multimodal/` | Multi-modal result fusion | [`refactor/modules/multimodal.md`](./docs/refactor/modules/multimodal.md) |
| observability | `src/lib/observability/` | Logging + distributed lock + alert | [`refactor/modules/observability.md`](./docs/refactor/modules/observability.md) |

---

## TL;DR

AIHub is a personal-grade AI information platform that bundles **news aggregation / model rankings / Bilibili creator tracking / automated PPT briefings / multi-agent meetings** into one workbench.

**Full Stack**: Next.js 14 (App Router) + React 18 + TypeScript 5. Backend is tRPC 11 (end-to-end type safety) + Prisma 6 ORM. Storage is PostgreSQL (dev fallback to SQLite) + Cloudflare R2 (files) + Upstash Redis (cache & rate-limit, distributed lock). AI routing via **direct SDK calls** — `@langchain/core` 0.3 + `@langchain/anthropic` / `@langchain/openai` for streaming batching, plus raw `openai` / `@anthropic-ai/sdk` / `@google/generative-ai` SDKs for direct multi-provider access (DeepSeek / Anthropic / Gemini). Auth is NextAuth.js (GitHub OAuth + local dev default account). UI uses CSS-variable-based theme system (6 presets + HSL DIY) with `@tabler/icons-react`. E2E testing via Playwright; APM via OpenTelemetry.

**Positioning**: Graduation-project MVP (live at https://github.com/huaxuyimeng/AI-Hub), also usable as a personal AI toolbox.

---

## Project Structure

```
aihub/
├── src/
│   ├── app/                  # Next.js App Router pages
│   │   ├── (app)/           #   Workbench: /news /rankings /meeting /projects
│   │   ├── api/             #   REST endpoints (cron / upload / news)
│   │   └── privacy/ terms/  #   Compliance pages
│   ├── components/          # Shared UI (app-shell, theme-*, news/*, rankings/*)
│   ├── features/            # Business modules (daily-briefing PPT engine, etc.)
│   ├── lib/                 # Core libraries
│   │   ├── ai/              #   LiteLLM routing / key resolver / model discovery / LangChain
│   │   ├── news/            #   Multi-source fetch / intent search / health
│   │   ├── bilibili/        #   WBI signature / Cookie / subtitle
│   │   ├── rankings/        #   Algorithm / scraper / scheduler
│   │   ├── slide-engine/    #   PPT IR / lint / rendering
│   │   ├── meeting/         #   LangGraph state machine / nodes / streaming
│   │   └── observability/   #   Logging / monitoring
│   └── server/              # tRPC routers + context (multi-tenant / RBAC)
├── prisma/                  # schema / migrations / seed
├── landing/                 # Static product demo pages
├── docs/                    # Design docs / implementation records
└── public/                  # Static assets
```

---

## Quick Start

### Environment Requirements

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+ (or SQLite for dev)
- (Optional) Cloudflare R2 account
- (Optional) Upstash Redis account
- (Optional) Bilibili SESSDATA Cookie

### Step 1: Initialize Database

```bash
# Option A: Use SQLite for development
# Default DATABASE_URL in .env.example points to local SQLite

# Option B: Use PostgreSQL
createdb aihub
psql -d aihub -f prisma/seed.sql
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Configure Environment

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` — Database connection string
- `NEXTAUTH_SECRET` — NextAuth session encryption
- `CRON_SECRET` — Cron endpoint authentication

Recommended variables:
- At least one AI Provider Key (DeepSeek / 智谱 / Anthropic / Kimi)
- `R2_*` — Cloudflare R2 file storage
- `UPSTASH_*` — Upstash Redis cache
- `BILIBILI_SESSDATA` — Bilibili creator tracking

### Step 4: Run Migrations

```bash
pnpm prisma migrate dev
```

### Step 5: Start Dev Server

```bash
pnpm dev
# → http://localhost:3000
```

---

## Test Account

| Username | Password | Role | Note |
|----------|----------|------|------|
| `admin@local` | `admin123` | Administrator | Full access |
| `user@local` | `user123` | Regular User | Workbench access |

Run `pnpm seed` to populate demo data. (See `prisma/seed.ts`)

---

## API Overview

### News
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/news.list` | List news with filters (source, category, confidence) |
| GET | `/api/news.byId` | News detail |
| POST | `/api/news.refresh` | Manual trigger fetch |

### Rankings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rankings.list` | Top models by weighted score |
| GET | `/api/rankings.byModel` | Model detail + price history |
| POST | `/api/rankings.refresh` | Daily scraper trigger |

### Briefing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/briefing.generate` | Generate today's PPT |
| GET | `/api/briefing.history` | Recent briefings |

### Meeting (Multi-Agent)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/meeting.create` | Create meeting with participants |
| GET | `/api/meeting.stream` | SSE streaming output |
| POST | `/api/meeting.conclude` | Finalize meeting |

### Bilibili
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bilibili.followed` | List followed creators |
| POST | `/api/bilibili.refresh` | Refresh videos + subtitles |

Full API documentation in `docs/API.md`.

---

## Security Mechanisms

- **Multi-tenant Isolation** — every DB call goes through `createTenantPrisma(ctx)` which forces `tenantId` injection; missing tenant = rejected
- **RBAC Permission Control** — front-end route guards + back-end interceptors, three roles (USER / MERCHANT-style / ADMIN)
- **Soft Delete** — 9 whitelisted models include `deletedAt` (User / Project / ApiKey / Conversation / Score / InstalledPlugin / PluginAuditLog / UsageStat)
- **AI Key Resolution** — single entry `src/lib/ai/key-resolver.ts`, components cannot read env directly
- **Cron Authentication** — all cron endpoints require `CRON_SECRET` header
- **Unified Error Handling** — tRPC error formatter maps internal errors to safe messages
- **CORS Whitelist** — explicit origins only, no wildcard in production

---

## Production Deployment Checklist

Before deploying to production, you **must** modify:

**Environment Variables:**
- `NEXTAUTH_SECRET` — at least 32-character random string
- `CRON_SECRET` — at least 32-character random string
- `DATABASE_URL` — use strong password
- AI Provider Keys — rotate regularly

**Security Hardening:**
- Enable HTTPS, disable HTTP
- Remove demo accounts (`admin@local`, `user@local`)
- Configure CORS whitelist with your actual frontend domain
- Review `.env.example` for any leaked secrets (none should exist)

Generate secrets via:
```bash
openssl rand -base64 32   # → NEXTAUTH_SECRET
openssl rand -hex 32      # → CRON_SECRET
```

---

## Development Guide

### Adding a New Module (Example: "AI Tool Directory")

**1. Database**
- Add model to `prisma/schema.prisma`
- Run `pnpm prisma migrate dev --name add-tool-directory`

**2. Backend (tRPC)**
- Create router in `src/server/routers/tools.ts`
- Register in `src/server/router.ts`

**3. Frontend (App Router)**
- Create page in `src/app/(app)/tools/page.tsx`
- Add nav entry in `src/components/app-shell/nav-config.ts`

**4. Tests**
- Add unit test in `src/lib/tools/__tests__/`
- Add integration test in `src/server/routers/tools.test.ts`

### Debugging Tips

- Backend logs: `src/lib/observability/logger.ts` — debug level for AI calls
- Type checking: `pnpm typecheck`
- Single test: `npx tsx src/path/to/file.test.ts`

---

## Test Coverage

| Test Suite | Cases |
|-----------|-------|
| typecheck | 0 errors |
| Model Ranking Algorithm | All pass |
| Usage Billing | All pass |
| PPT Briefing IR | 59/59 |
| Meeting Graph State Machine | 47/47 |
| LangChain Streaming Batching | 20/20 |
| Meeting Router Integration | 28/28 |
| Chat Router | 19/19 |
| Server Context (P0 Protection) | 4/4 |
| Briefing Postprocessor | 16/16 |

Run all tests:
```bash
pnpm typecheck
npx tsx src/lib/rankings/algorithm.test.ts
npx tsx src/lib/meeting/__tests__/meeting-graph.test.ts
npx tsx src/lib/ai/__tests__/langchain-stream.test.ts
npx tsx src/server/context.test.ts
```

---

## Build & Deploy

### Frontend Build
```bash
pnpm build
# Output: .next/ directory
```

### Docker (Optional)
```bash
docker build -t aihub .
docker run -p 3000:3000 aihub
```

### Nginx Reverse Proxy Example

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## FAQ

**Q1: Backend throws "Communications link failure"?**
A: Check if PostgreSQL/SQLite is running. Verify `DATABASE_URL` in `.env`.

**Q2: AI provider returns 401?**
A: Provider API key is invalid or expired. Check `src/lib/ai/key-resolver.ts` and rotate key.

**Q3: Bilibili tracking returns 403?**
A: `BILIBILI_SESSDATA` cookie expired. Re-login and update.

**Q4: PPT generation fails lint?**
A: Check `src/lib/slide-engine/lint-rules/` for the failed rule. Usually means LLM-generated JSON doesn't match IR schema.

**Q5: How to add new AI provider?**
A: Implement adapter in `src/lib/ai/router.ts`, register in provider list, add corresponding env var.

---

## License

MIT © 2026 AIHub Authors
