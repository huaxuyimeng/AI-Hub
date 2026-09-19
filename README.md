# AIHub

> **AI Workbench + AI Briefing Auto-Generation + Multi-Source Information Aggregation** — unify your AI content workflow in one interface.

[English](./README.md) · [简体中文](./README-zh.md)

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

### Backend
| Tech | Version | Note |
|------|---------|------|
| tRPC | 11 | Type-safe RPC |
| Prisma | 6 | ORM + multi-tenant |
| NextAuth.js | 5 | GitHub OAuth + dev default account |
| LangChain | - | Streaming batching |
| LangGraph | - | Multi-agent state machine |
| LiteLLM | - | AI proxy + multi-provider |

### Storage / Infrastructure
| Tech | Note |
|------|------|
| PostgreSQL | Production |
| SQLite | Development |
| Cloudflare R2 | File storage (PPTX, avatars) |
| Upstash Redis | Cache + rate limiting |
| Cron Jobs | Daily briefings + cleanup |

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
