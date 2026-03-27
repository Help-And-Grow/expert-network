# AGENTS.md — Help & Grow

> This file is the **table of contents** for agents working in this repo.
> It is intentionally short (~100 lines). Detailed docs live in `docs/`.

## Brand (read first)

- **Product:** **Help & Grow** — **AI Native Expert Network**
- **Vision:** *Service as agent* — a digital expert that learns continuously from the human expert (social, meetings, reflection, memos), stays online, evolves with them, answers on-platform, and facilitates the expert.
- **Ethos:** Everyone is **both expert and learner**; we foster **learning by doing** and **growing by helping**. Full copy: [docs/BRAND.md](docs/BRAND.md).

## Quick Start

- **Framework**: Next.js 15 (App Router) + TypeScript
- **Database**: Prisma 7 with PostgreSQL only (`@prisma/adapter-pg`); `DATABASE_URL` must be `postgresql://`
- **Hosting**: Vercel (serverless)
- **Clients**: Web browser, Telegram Mini App, WeChat Mini Program (Taro)

## Repository Layout

```
AGENTS.md            ← You are here
ARCHITECTURE.md      ← Domain map, dependency layers, tech decisions
contracts/           ← Foundry smart contracts (HelpGrowToken)
docs/                ← Full knowledge base (see below)
hiclaw/              ← HiClaw multi-agent service (ECS deployment)
prisma/              ← Database schema and migrations
scripts/             ← Build-time helpers (switch-db, wechat-upload)
src/
  app/               ← Next.js pages + API routes
  components/        ← React components (shadcn/ui primitives in ui/)
  lib/               ← Core business logic, integrations, AI providers
  hooks/             ← Custom React hooks
wechat/              ← WeChat Mini Program (Taro + React)
```

## Documentation Map

See `docs/` for full details:

| Document | Location | What it covers |
|----------|----------|----------------|
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | Domains, layers, dependency rules |
| Design system | [docs/DESIGN.md](docs/DESIGN.md) | UI conventions, component patterns |
| Frontend | [docs/FRONTEND.md](docs/FRONTEND.md) | Page structure, routing, state |
| Plans | [docs/PLANS.md](docs/PLANS.md) | Current roadmap and priorities |
| Brand | [docs/BRAND.md](docs/BRAND.md) | Name, positioning, vision, voice |
| Product sense | [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md) | User personas, product principles |
| Quality | [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md) | Per-domain quality grades |
| Reliability | [docs/RELIABILITY.md](docs/RELIABILITY.md) | Error handling, SLOs, monitoring |
| Security | [docs/SECURITY.md](docs/SECURITY.md) | Auth, data handling, secrets |
| Design docs | [docs/design-docs/](docs/design-docs/) | Indexed design decisions |
| Exec plans | [docs/exec-plans/](docs/exec-plans/) | Active plans, completed, tech debt |
| Product specs | [docs/product-specs/](docs/product-specs/) | Feature specifications |
| References | [docs/references/](docs/references/) | LLM-friendly external references + [documentation maintenance](docs/references/documentation-maintenance.md) |
| Memos | [docs/memos/](docs/memos/) | Investor & GTM briefs |
| Generated | [docs/generated/](docs/generated/) | Auto-generated DB schema docs |

## Key Conventions

1. **Authentication**: All API routes use `resolveUserId(request)` from `src/lib/request-auth.ts` — supports Auth.js (NextAuth v5), Telegram, and WeChat in one call. Config: `src/auth.ts`.
2. **AI providers**: Swappable via `AI_PROVIDER` env var (`dedalus`, `gemini`, `qwen`, `openai`). Default when unset: `gemini`. See `src/lib/ai/index.ts`.
3. **Payments**: Stripe (primary), TON (crypto), WeChat Pay. Webhook at `/api/webhooks/stripe`. H&G token redemption at checkout.
4. **Database switching**: Run `node scripts/switch-db.mjs` — reads `DB_PROVIDER` and patches `prisma/schema.prisma`.
5. **WeChat Mini Program**: Lives in `wechat/`, built with Taro. Uses the same backend API with `x-wechat-token` auth header.
6. **MCP server**: `/api/mcp` exposes expert search/match/availability as MCP tools for AI agents.
7. **Public API**: `/api/v1/` namespace provides auth-free GET endpoints for agent/skill consumption.
8. **POMP (Proof of Meet Protocol)**: Every completed booking creates **two EAS attestations** on Base (schema in `src/lib/pomp-eas-schema.ts`) via `src/lib/pomp-credential.ts` + `@ethereum-attestation-service/eas-sdk`. Register schema once: `scripts/register-pomp-eas-schema.mjs`.
9. **H&G Token**: ERC-20 token (`contracts/src/HelpGrowToken.sol`) on Base. Learners earn tokens 1:1 with SGD paid; redeem at 100 tokens = 1 SGD discount. On-chain burn via `redeemDiscount()`. See `src/lib/hg-token.ts`.
10. **Smart Contracts**: Foundry-based (`contracts/`). Deploy via `forge script script/Deploy.s.sol` (HelpGrowToken on Base Sepolia/Mainnet).
11. **HiClaw Agent System**: Node service in `hiclaw/service/` — **manager**, **shadowWorker** (generator), **evaluatorWorker** (quality loop), optional **plannerWorker** (sprint contract), **store** (MySQL via `TIDB_DATABASE_URL` **or** Postgres via `HICLAW_POSTGRES_URL` / `DB9_DATABASE_URL`), **waitingRoom**. Shadow stack uses **mem9** + **DashScope Qwen-Max**; session handoffs and `evaluator_critiques` on `sessions` / dedicated table. Details: [`hiclaw/README.md`](hiclaw/README.md). Design: [`docs/design-docs/hiclaw-agent-harness-db9.md`](docs/design-docs/hiclaw-agent-harness-db9.md).
12. **On-chain Sync**: `/api/webhook/onchain` ingests **EAS `Attested`** logs (Alchemy webhook) and updates HiClaw `sessions` in Postgres (incl. `eas_attestation_uid`). `/api/reputation/:expertId` aggregates from the same store.
13. **Reputation Dashboard**: `/reputation` — expert stats from HiClaw DB + EASScan links; mentee H&G balance via wagmi + ledger API.

## Documentation (key changes)

When you ship **user-visible behavior**, **new env vars**, **API contracts**, **schema/DDL**, or **architecture** changes, update docs in the same effort: `.env.example` / domain READMEs / `AGENTS.md` pointers / `ARCHITECTURE.md` / relevant `docs/design-docs/` status. Full checklist: [docs/references/documentation-maintenance.md](docs/references/documentation-maintenance.md). Cursor: `.cursor/rules/documentation-maintenance.mdc`.

## Coding Standards

- Parse data at boundaries — validate inputs with Zod or runtime checks
- Prefer shared utilities in `src/lib/` over hand-rolled helpers
- API routes return `NextResponse.json()` with consistent error shapes
- Use `export const maxDuration` for long-running serverless functions
- All notification calls (Telegram, WeChat) must be `.catch(() => {})` to not block responses

## Where to Look

| Task | Start here |
|------|-----------|
| Add a new API endpoint | `src/app/api/` — follow existing route patterns |
| Modify database schema | `prisma/schema.prisma` then `prisma generate` |
| Change AI behavior | `src/lib/ai/` — edit the relevant provider |
| Update WeChat Mini Program | `wechat/src/pages/` |
| Add a new business domain | See [ARCHITECTURE.md](ARCHITECTURE.md) for layer rules |
| Fix a payment issue | `src/lib/stripe.ts`, `src/app/api/webhooks/stripe/` |
| Background jobs (Inngest) | `src/inngest/`, `src/app/api/inngest/route.ts`, `src/lib/jobs/charge-remainder-cron.ts` |
| tRPC (typed API) | `src/trpc/root.ts`, `src/app/api/trpc/[trpc]/route.ts`, `src/components/trpc-provider.tsx` |
| Optional pgvector memory | `USE_PGVECTOR_MEMORY`, `src/lib/integrations/pgvector-memory.ts`, admin `/api/admin/migrate` SQL |
| Work on POMP/token features | `src/lib/pomp-credential.ts`, `src/lib/pomp-eas-schema.ts`, `src/lib/hg-token.ts`, `contracts/src/` |
| Modify smart contracts | `contracts/src/`, deploy via `contracts/script/Deploy.s.sol` |
| Work on HiClaw agents | `hiclaw/README.md`, `hiclaw/service/src/` (manager, shadowWorker, evaluatorWorker, plannerWorker, store, waitingRoom) |
| On-chain sync/reputation | `src/lib/tidb.ts`, `src/app/api/webhook/onchain/`, `src/app/api/reputation/` |
| Modify MCP server tools | `src/app/api/mcp/route.ts` |
| Update product specs | `docs/product-specs/` |
