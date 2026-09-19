# AIHub

> **AI Workbench + AI Briefing Auto-Generation + Multi-Source Information Aggregation** — unify your AI content workflow in one interface.

[English](./README.md) · [简体中文](./README-zh.md)

---

## One-liner

**Let AI help you track AI news, auto-generate briefings, compare model prices, and follow Bilibili creators** — no more juggling between a dozen tools.

---

## Preview

| News Aggregation | Model Rankings | Multi-Agent Meeting |
|---------|---------|-----------|
| Multi-source AI news ranked by confidence | 50+ models side-by-side with cost-performance comparison | Multi-role AI discuss together, output conclusion |

---

## What Problem Does It Solve

| Pain Point | AIHub's Solution |
|------|------------|
| Wasting time scrolling through a dozen AI news sources every day | Aggregate 10+ Chinese & English sources, ranked by confidence — get the gist in 5 minutes |
| Want to compare cost-performance of Claude / GPT / DeepSeek | 3-axis weighted algorithm (capability × price × context window), updated daily |
| Want to follow your favorite Bilibili creators' latest content | WBI signature + Cookie login + RSS fallback, auto-fetch subtitles |
| Spending 2 hours every week making AI industry briefing PPTs | Cron fetches news → LLM generates JSON → IR lint validates → one-click PPTX export |
| Need team collaboration but don't want each person buying accounts | Multi-tenant + RBAC + soft delete, one instance supports multiple teams |

---

## Core Features

### 🤖 AI News Aggregation
Auto-fetch from 10+ sources (机器之心 / 量子位 / AIbase / Unite.AI / Hacker News / 36kr, etc.), scored on **confidence × source quality × vendor tags**. Adaptive parsers for RSS / HTML / API, with intent search and category-based following.

### 📊 AI Model Rankings
Pareto-frontier weighted algorithm (capability 40% + price 30% + context window 30%), daily-updated data on 50+ models. Side-by-side comparison, price trends, related-news linking.

### 📺 Bilibili Creator Tracking
WBI signature reverse-engineering + SESSDATA Cookie login + RSS fallback, fetching specified creators' videos and subtitles. Subtitle semantic analysis helps you quickly understand what creators have been talking about lately.

### 📑 AI Briefing (PPT)
Daily cron job → LLM generates briefing JSON → IR lint validates → render PPTX. Self-built slide-engine (template + IR + lint rules) ensures consistent formatting and compliant content. One-click "Today's AI Industry PPT" export.

### 🗣️ Multi-Role AI Meeting
LangChain / LangGraph-based multi-agent meeting system — product manager / engineer / investor / critic discuss together, SSE streaming output, atomic state machine prevents concurrent duplicate execution.

---

## Technical Highlights

| Highlight | Description |
|------|------|
| **Full TypeScript** | tRPC end-to-end type safety, zero implicit `any` from frontend → backend → database |
| **LangChain / LangGraph** | Streaming batching + state machine + cached token billing (Prompt Cache discount auto-calculated) |
| **Multi-tenant + Soft Delete** | `createTenantPrisma(ctx)` forces tenantId injection; 9 whitelisted models include `deletedAt` |
| **Self-built PPT Engine** | IR intermediate representation → lint rule validation → PPTX template rendering, zero format drift |
| **AI Key Smart Routing** | Single entry `key-resolver.ts`, multi-provider (DeepSeek / 智谱 / Anthropic / Kimi) auto-fallback |
| **CSS Variable Theme System** | 6 preset themes + HSL DIY, accent color one-click switch |

**Stack**: Next.js 14 (App Router) · tRPC 11 · Prisma 6 · PostgreSQL / SQLite · Cloudflare R2 · Upstash Redis · NextAuth.js · `@tabler/icons-react`

---

## Quick Start

```bash
# Clone
git clone https://github.com/huaxuyimeng/AI-Hub.git
cd AI-Hub

# Install
pnpm install

# Environment
cp .env.example .env
# Required: DATABASE_URL, NEXTAUTH_SECRET, CRON_SECRET
# Recommended: AI Provider Key, R2 storage, Upstash Redis, Bilibili SESSDATA

# Database
pnpm prisma migrate dev

# Start
pnpm dev
# → http://localhost:3000
```

---

## Test Coverage

| Test Suite | Cases |
|---------|-------|
| Model Ranking Algorithm | ✅ |
| Usage Billing | ✅ |
| PPT Briefing IR | ✅ 59/59 |
| Meeting Graph State Machine | ✅ 47/47 |
| LangChain Streaming Batching | ✅ 20/20 |
| Meeting Router Integration | ✅ 28/28 |
| Chat Router | ✅ 19/19 |
| Server Context (P0 Protection) | ✅ 4/4 |
| Briefing Postprocessor | ✅ 16/16 |
| **typecheck** | ✅ **Zero errors** |

---

## Project Structure

```
aihub/
├── src/
│   ├── app/                  # Next.js App Router pages
│   │   └── (app)/           #   Workbench /news /rankings /meeting, etc.
│   ├── components/          # Shared UI components
│   ├── features/           # daily-briefing and other business modules
│   ├── lib/                # Core libraries
│   │   ├── ai/              #   routing / key resolver / models / LangChain adapter
│   │   ├── news/            #   multi-source fetch / intent search / health
│   │   ├── bilibili/        #   WBI signature / Cookie / subtitles
│   │   ├── rankings/         #   algorithm / scraper / scheduler
│   │   ├── slide-engine/    #   PPT IR / lint / rendering
│   │   ├── meeting/         #   LangGraph state machine / nodes / streaming
│   │   └── observability/   #   logging / monitoring
│   └── server/              # tRPC routers + context (multi-tenant / RBAC)
├── prisma/                  # schema / migrations / seed
├── landing/                 # Static product demo pages
├── docs/                    # Design docs / implementation records
└── public/                  # Static assets
```

---

## Security Notes

```bash
# You must generate your own secrets after cloning
openssl rand -base64 32   # → NEXTAUTH_SECRET
openssl rand -hex 32      # → CRON_SECRET
```

All credentials, cookies, and session tokens are stored only in local `.env` (intercepted by `.gitignore`, never uploaded).

---

## License

MIT © 2026 AIHub Authors
