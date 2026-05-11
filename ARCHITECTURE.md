# Architecture — Help & Grow

## Overview

**Help & Grow** is an **AI Native Expert Network**: a multi-platform product where people act as **both experts and players**—**sharing** domain judgment as services and learning from others (**coaches** when they offer help)—supported by **AI matching**, **expert memory via mem9 or pgvector**, and a long-term direction toward **service as agent** (always-on digital experts that learn from their human counterpart and facilitate real meetups). It serves web and Telegram from Vercel today. WeChat uses Tencent-friendly infrastructure. Current WeChat work is converging on a premium, voice-first expert experience rather than a generic AI chatbot surface. See [docs/BRAND.md](docs/BRAND.md) for positioning and vision.

## System Diagram

```
┌─────────────┐  ┌─────────────────┐  ┌──────────────────┐
│ Web Browser  │  │ Telegram MiniApp│  │ WeChat MiniProg  │
│ (Next.js SSR)│  │ (React SPA)     │  │ (Taro + React)   │
└──────┬───────┘  └───────┬─────────┘  └───────┬──────────┘
       │                  │                     │
       └──────────────────┼─────────────────────┘
                          │
                ┌─────────▼──────────┐
                │  Next.js API Layer  │  (Vercel Serverless)
                │  /api/*             │
                └──┬──────┬──────┬───┘
                   │      │      │
           ┌──────────┐ ┌───▼───┐ ┌▼──────────────┐
           │ Prisma + │ │Stripe │ │AI Providers   │
           │ Postgres │ │(Pay)  │ │(Qwen/Gemini/  │
           │ DB       │ │       │ │ OpenAI/Z.ai/  │
           │          │ │Connect│ │ Dedalus)      │
           └──────────┘ └───────┘ └───────────────┘
```

**Database status (since 2026-05-03):** Web/Telegram production runs on Google Cloud SQL (`hg-postgres-prod`, `asia-southeast1`). Operations runbook: [docs/exec-plans/active/postgres-cutover-runbook.md](docs/exec-plans/active/postgres-cutover-runbook.md); archived migration record: [docs/exec-plans/archive/supabase-to-cloudsql-migration.md](docs/exec-plans/archive/supabase-to-cloudsql-migration.md).

## Business Domains

| Domain | Responsibility | Key Files |
|--------|---------------|-----------|
| **Auth** | Multi-platform authentication (Auth.js / NextAuth v5, Telegram, WeChat) | `src/auth.ts`, `src/lib/request-auth.ts`, `src/lib/telegram-server.ts` |
| **Experts** | Profile management, services, availability, pricing | `src/app/api/experts/`, `src/app/api/expert/` |
| **Meetups** (Prisma: `Booking`) | Meetup scheduling, timezone handling, conflict detection | `src/app/api/bookings/`, `src/lib/booking-utils.ts` |
| **Payments** | Stripe checkout, TON crypto, WeChat Pay, free sessions | `src/lib/stripe.ts`, `src/app/api/webhooks/stripe/` |
| **Appreciations** (Prisma: `Review`) | Post-meetup ratings with coach follow-up | `src/app/api/reviews/` |
| **AI** | Expert matching, profile generation, chat, image gen, TTS/ASR | `src/lib/ai/`, `src/lib/chat-engine.ts` |
| **Onboarding** | Multi-step expert registration wizard | `src/app/api/onboarding/` |
| **Notifications** | Telegram bot + WeChat template messages | `src/lib/telegram-bot.ts`, `src/lib/wechat-notify.ts` |
| **Memory** | Per-expert persistent context via mem9 hosted `v1alpha2`; optional pgvector mirror | `src/lib/integrations/mem9.ts`, `src/lib/integrations/pgvector-memory.ts` |

## Layer Architecture

Within each domain, code follows these layers (dependencies flow downward only):

```
Types       — Prisma models, TypeScript interfaces, Zod schemas
    ↓
Config      — Environment variables, feature flags, constants
    ↓
Repository  — Prisma queries, data access (src/lib/)
    ↓
Service     — Business logic, orchestration (src/lib/)
    ↓
API Route   — HTTP handlers, request validation (src/app/api/)
    ↓
UI          — React pages and components (src/app/, src/components/)
```

**Rules:**
- UI may call API Routes (via fetch) but never imports from Service or Repository directly
- API Routes validate inputs then delegate to Service layer
- Service layer is framework-agnostic — no Next.js imports
- Cross-domain dependencies go through explicit interfaces

## Authentication Architecture

```
Request → resolveUserId(request)
              ├─ Check x-wechat-token header → JWT verify → wechatOpenId → User
              ├─ Check x-telegram-init-data header → HMAC verify → telegramId → User
              └─ Check Auth.js session cookie → auth() → User
```

All API routes use `resolveUserId()` for unified multi-platform auth.

## AI Provider Architecture

```
src/lib/ai/
├── index.ts          — Factory: reads AI_PROVIDER env, returns provider
├── types.ts          — AIProvider interface, shared types
├── base-provider.ts  — Shared utilities
├── prompts.ts        — Prompt templates
├── gemini.ts         — Google Gemini implementation
├── qwen.ts           — Alibaba Qwen/DashScope implementation
├── openai.ts         — OpenAI implementation
└── search.ts         — Search grounding utilities
```

Provider selection: `AI_PROVIDER=dedalus|qwen|gemini|openai|zai|ollama` (defaults to **qwen** when unset; the local compose stack uses **ollama**; runtime registry lives in `src/lib/ai/index.ts`).

## Expert Avatar Control Plane

The long-term service architecture is moving toward a capability-routed control plane rather than a single hard-wired multi-agent stack.

```
Experience surfaces
  → Service control plane
  → Capability fabric
  → Orchestration adapters
  → Runtime / context infrastructure
```

### Capability fabric

Named capabilities are the main product abstraction:

- voice reply
- realtime talk
- meeting capture
- memo / reflection
- online content learning
- service matching
- conversion support

Each capability resolves four selectors:

- `orchestrator`
- `runtimeProfile`
- `modelProfile`
- `memoryProfile`

Precedence is platform default → expert override → capability override.

### Adapter posture

- **Scion** is the container-oriented, isolated execution option for future swarm and concurrent agent workloads.
- **Local fallback** is always required: Docker + Ollama + Postgres/pgvector, with mem9 optional.

See [docs/design-docs/pluggable-expert-avatar-control-plane.md](docs/design-docs/pluggable-expert-avatar-control-plane.md).

## Database

- **Primary**: PostgreSQL in production — Google Cloud SQL (`hg-postgres-prod`, `asia-southeast1`) since 2026-05-03.
- **ORM**: Prisma 7 with `@prisma/adapter-pg` only; `DATABASE_URL` must be Postgres (`mysql://` rejected)
- **Schema**: `prisma/schema.prisma` — `scripts/switch-db.mjs` enforces `provider = "postgresql"`

### On-chain attestation state

- **Location:** `POMPCredential` table in the main app Postgres (`prisma/schema.prisma`). No sidecar, no separate store.
- **Fields:** `onChainVerified` (bool) and `txHash` track Alchemy-delivered EAS attestations; one credential row per Booking.
- **Update path:** `/api/webhook/onchain` ingests EAS `Attested` logs and updates `POMPCredential` idempotently via Prisma.
- **Reads:** `/api/reputation/:expertId` aggregates POMPCredential + Booking via Prisma — no second database to keep in sync.

### Key Models

| Model | Purpose |
|-------|---------|
| User | Account identity with multi-platform IDs; `role` is authorization only (`USER` or `ADMIN`) |
| Expert | Coach capability/profile linked to User — pricing, schedule, Stripe Connect |
| AvailableSlot | Explicit availability windows |
| Booking | Player ↔ coach meetup records with payment tracking (product copy: **meetup**) |
| Review | Appreciation + coach follow-up (product copy: avoid “review”) |

## Payment Architecture

1. **Stripe** (primary): Checkout Sessions → webhook creates Booking → cron charges remainder
2. **TON**: TonConnect wallet → on-chain transfer → manual confirmation
3. **WeChat Pay**: JSAPI → webhook confirms payment
4. **Free**: Direct `Booking` creation when expert price is 0

Stripe uses Connected Accounts (Express) for marketplace payouts with configurable platform fee.

## Memory Architecture (mem9 + pgvector)

Each expert gets a persistent cloud memory space via [mem9.ai](https://mem9.ai) that enriches AI interactions with accumulated context—foundational for the **service as agent** vision (a digital expert that keeps learning from the human expert and the platform).

```
Expert onboarded → ensureExpertSpace() → mem9 space created
                → seedExpertProfile()  → bio and services stored as memories
                                         ↓
Meetup scheduled → `storeBookingEvent()` → meetup details added to memory
Appreciation saved → `storeReviewEvent()` → rating + comment added to memory (tags: appreciation)
                                         ↓
AI match query   → searchExpertMemories() → relevant memories injected into prompt
AI chat          → searchExpertMemories() → context-aware responses
```

**Key files:**
- `src/lib/integrations/mem9.ts` — Low-level hosted API client. Provisions per-expert keys through `POST /v1alpha1/mem9s`; daily memory operations use `/v1alpha2/mem9s/...` with `X-API-Key` and `X-Mnemo-Agent-Id`.
- `src/lib/integrations/mem9-lifecycle.ts` — Fire-and-forget helpers for business events
- `src/lib/integrations/pgvector-memory.ts` — Optional local/Postgres mirror for memory search and backfill
- `Expert.mem9SpaceId` — Prisma field storing the expert's mem9 hosted API key / memory space key

**Design principles:**
- All mem9 calls are fire-and-forget (`.catch(() => {})`) — never block primary flows
- Memory accumulates over time: profile seed → meetups → appreciations → richer AI matching
- Search results are injected as additional context into AI provider prompts
- Postgres remains source of truth; pgvector handles current semantic pre-rank, with Zilliz as a future vector-index provider boundary

## WeChat Mini Program

- **Framework**: Taro 4.x (React)
- **Location**: `wechat/`
- **Pages**: Home, Discover, Expert, Book, Dashboard, Onboarding, Profile
- **Auth**: `wx.login()` → backend `code2session` → JWT stored in Taro storage
- **API calls**: Same backend via `TARO_APP_API_BASE` with `x-wechat-token` header
- **Current product posture**: premium discovery + expert-profile browsing + voice-first preview; no text-chat shell on the public expert consult surface
- **Current deployment target**: international WeChat Mini Program (`TARO_APP_REGION=intl`, AppID `wx09d0eb079596060d`) backed by Tencent CloudBase env `cn-wechat-d1gzncs8i34827c98` and Hunyuan. The mainland-CN app is a future separate AppID/company path. A separate Tencent Cloud International Singapore setup (`infra/tencent-intl/`, SG PostgreSQL/COS/VPC) was removed on 2026-05-05 and is not part of the active architecture.
- **Build / upload**: `npm run build:weapp:intl` in `wechat/`; from repo root `npm run wechat:upload:intl` builds `wechat/dist-intl` and uploads via `miniprogram-ci` (Node 20; local key `wechat/private.*.key` or `WECHAT_CI_KEY_PATH`). CI: `.github/workflows/wechat-ci.yml` builds/uploads the intl app on `main` + manual dispatch with secret `WECHAT_CI_PRIVATE_KEY`.
