# Architecture — Help & Grow

## Overview

**Help & Grow** is an **AI Native Expert Network**: a multi-platform product where people act as **both experts and learners**—offering domain knowledge as services and learning from others—supported by **AI matching**, **mem9-backed context**, and a long-term direction toward **service as agent** (always-on digital experts that learn from their human counterpart and facilitate real sessions). It serves web, Telegram Mini App, and WeChat Mini Program from one Next.js API layer on Vercel. See [docs/BRAND.md](docs/BRAND.md) for positioning and vision.

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
           ┌───────▼┐ ┌───▼───┐ ┌▼────────┐
           │ Prisma  │ │Stripe │ │AI Provs │
           │ (DB)    │ │(Pay)  │ │(Qwen/   │
           │         │ │       │ │ Gemini/ │
           │ Supa/   │ │Connect│ │ OpenAI) │
           │ TiDB    │ │Webhook│ │         │
           └─────────┘ └───────┘ └─────────┘
```

## Business Domains

| Domain | Responsibility | Key Files |
|--------|---------------|-----------|
| **Auth** | Multi-platform authentication (Auth.js / NextAuth v5, Telegram, WeChat) | `src/auth.ts`, `src/lib/request-auth.ts`, `src/lib/telegram-server.ts` |
| **Experts** | Profile management, domains, availability, pricing | `src/app/api/experts/`, `src/app/api/expert/` |
| **Bookings** | Session scheduling, timezone handling, conflict detection | `src/app/api/bookings/`, `src/lib/booking-utils.ts` |
| **Payments** | Stripe checkout, TON crypto, WeChat Pay, free sessions | `src/lib/stripe.ts`, `src/app/api/webhooks/stripe/` |
| **Reviews** | Post-session ratings with expert suggestions | `src/app/api/reviews/` |
| **AI** | Expert matching, profile generation, chat, image gen, TTS/ASR | `src/lib/ai/`, `src/lib/chat-engine.ts` |
| **Onboarding** | Multi-step expert registration wizard | `src/app/api/onboarding/` |
| **Notifications** | Telegram bot + WeChat template messages | `src/lib/telegram-bot.ts`, `src/lib/wechat-notify.ts` |
| **Memory** | Per-expert persistent context via mem9 | `src/lib/integrations/mem9.ts` |

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

Provider selection: `AI_PROVIDER=dedalus|qwen|gemini|openai` (defaults to **qwen** when unset; runtime registry in `src/lib/ai/index.ts`).

## Database

- **Primary**: PostgreSQL (e.g. Supabase) in production
- **ORM**: Prisma 7 with `@prisma/adapter-pg` only; `DATABASE_URL` must be Postgres (`mysql://` rejected)
- **Schema**: `prisma/schema.prisma` — `scripts/switch-db.mjs` enforces `provider = "postgresql"`

### HiClaw shadow service (sidecar)

- **Location:** `hiclaw/service/` (Express, Node). Not part of the Vercel serverless bundle unless separately deployed.
- **Role:** Offline-expert path — shadow generation, optional evaluator loop, session handoffs, waiting room for human approval.
- **Data store:** **`store.js`** — Postgres via HTTP SQL (`DB9_HTTP_SQL_URL` + token) or TCP `pg` (`DB9_DATABASE_URL` / `HICLAW_POSTGRES_URL`). Align the **same** Postgres (or replicate) with Vercel routes that update HiClaw `sessions` (`/api/webhook/onchain`, `/api/reputation/:expertId`).
- **Doc:** [hiclaw/README.md](hiclaw/README.md) · [docs/design-docs/hiclaw-agent-harness-db9.md](docs/design-docs/hiclaw-agent-harness-db9.md) · [postgres-cutover-runbook.md](docs/exec-plans/active/postgres-cutover-runbook.md)

### Key Models

| Model | Purpose |
|-------|---------|
| User | All users (founders, experts, admins) with multi-platform IDs |
| Expert | Extended profile linked to User — pricing, schedule, Stripe Connect |
| ExpertDomain | Many-to-many expert ↔ domain mapping |
| AvailableSlot | Explicit availability windows |
| Booking | Session records with payment tracking |
| Review | Post-session ratings and expert suggestions |

## Payment Architecture

1. **Stripe** (primary): Checkout Sessions → webhook creates Booking → cron charges remainder
2. **TON**: TonConnect wallet → on-chain transfer → manual confirmation
3. **WeChat Pay**: JSAPI → webhook confirms payment
4. **Free**: Direct booking creation when expert price is 0

Stripe uses Connected Accounts (Express) for marketplace payouts with configurable platform fee.

## Memory Architecture (mem9)

Each expert gets a persistent cloud memory space via [mem9.ai](https://mem9.ai) that enriches AI interactions with accumulated context—foundational for the **service as agent** vision (a digital expert that keeps learning from the human expert and the platform).

```
Expert onboarded → ensureExpertSpace() → mem9 space created
                → seedExpertProfile()  → bio, domains, services stored as memories
                                         ↓
Booking created  → storeBookingEvent()  → session details added to memory
Review received  → storeReviewEvent()   → rating + comment added to memory
                                         ↓
AI match query   → searchExpertMemories() → relevant memories injected into prompt
AI chat          → searchExpertMemories() → context-aware responses
```

**Key files:**
- `src/lib/integrations/mem9.ts` — Low-level API client (create space, store, search, get, update)
- `src/lib/integrations/mem9-lifecycle.ts` — Fire-and-forget helpers for business events
- `Expert.mem9SpaceId` — Prisma field linking expert to their memory space

**Design principles:**
- All mem9 calls are fire-and-forget (`.catch(() => {})`) — never block primary flows
- Memory accumulates over time: profile seed → bookings → reviews → richer AI matching
- Search results are injected as additional context into AI provider prompts

## WeChat Mini Program

- **Framework**: Taro 4.x (React)
- **Location**: `wechat/`
- **Pages**: Home, Discover, Expert, Book, Dashboard, Onboarding, Profile
- **Auth**: `wx.login()` → backend `code2session` → JWT stored in Taro storage
- **API calls**: Same backend via `TARO_APP_API_BASE` with `x-wechat-token` header
- **Build**: `npm run build:weapp` in `wechat/` → `node scripts/wechat-upload.js` (loads `miniprogram-ci` from `wechat/node_modules` — run `npm install` in `wechat/` first)
