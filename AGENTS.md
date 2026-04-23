# AGENTS.md — Help & Grow

> This file is the **table of contents** for agents working in this repo.
> It is intentionally short (~100 lines). Detailed docs live in `docs/`.

## Brand (read first)

- **Product:** **Help & Grow** — **AI Native Expert Network**
- **Vision:** *Service as agent* — a digital expert that learns continuously from the human expert (social, meetings, reflection, memos), stays online, evolves with them, answers on-platform, and facilitates the expert.
- **Ethos:** Everyone is **both expert and player** (and **coach** when sharing); we foster **learning by doing** and **growing by helping**. Full copy: [docs/BRAND.md](docs/BRAND.md).

## Quick Start

- **Framework**: Next.js 15 (App Router) + TypeScript
- **Database**: Prisma 7 with PostgreSQL only (`@prisma/adapter-pg`); `DATABASE_URL` must be Postgres-shaped (or use Vercel-synced `POSTGRES_PRISMA_URL` — see [vercel-supabase-marketplace.md](docs/references/vercel-supabase-marketplace.md))
- **Hosting**: Vercel (serverless). The live `expert-network` project is owned by the **Help And Grow** Vercel team, but default Git-based iteration and deploys follow **`jlzxwt8/expert-network`** unless the user explicitly asks to sync the public `Help-And-Grow/expert-network` mirror.
- **Clients**: Web browser, Telegram Mini App, WeChat Mini Program (Taro)
- **UI smoke**: Playwright (`npm run test:ui`) with local dev-login (`DEV_AUTH_EMAIL`, optional `DEV_AUTH_ROLE`). On GitHub Actions, set repo secret **`E2E_DATABASE_URL`** (Postgres for `db:push` + auth); if unset, install/test steps are skipped and the workflow still **succeeds** (see `.github/workflows/ui-smoke.yml`).

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
e2e/                 ← Playwright: `smoke/`, `booking/`, `auth/` (`npm run test:e2e`, `npm run test:e2e:ci`)
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
| Security | [docs/SECURITY.md](docs/SECURITY.md) | Auth, data handling, secrets; [Vercel env / rotation](docs/references/vercel-env-and-secret-rotation.md) |
| Design docs | [docs/design-docs/](docs/design-docs/) | Indexed design decisions |
| Exec plans | [docs/exec-plans/](docs/exec-plans/) | Active plans, completed, tech debt |
| Product specs | [docs/product-specs/](docs/product-specs/) | Feature specifications |
| References | [docs/references/](docs/references/) | LLM-friendly external references + [documentation maintenance](docs/references/documentation-maintenance.md) + [multi-tenant Vercel / dashboard URLs](docs/references/multi-repo-strategy.md) |
| Vercel + Supabase DB | [docs/references/vercel-supabase-marketplace.md](docs/references/vercel-supabase-marketplace.md) | Marketplace Postgres env names, `POSTGRES_PRISMA_URL` → Prisma mapping |
| Memos | [docs/memos/](docs/memos/) | Investor & GTM briefs |
| Generated | [docs/generated/](docs/generated/) | Auto-generated DB schema docs |

## Key Conventions

1. **Authentication**: All API routes use `resolveUserId(request)` from `src/lib/request-auth.ts` — supports Auth.js (NextAuth v5), Telegram, and WeChat in one call. Config: `src/auth.ts`.
2. **AI providers**: `AI_PROVIDER` still supports multiple adapters in code (`dedalus`, `gemini`, `qwen`, `openai`, `zai`, `ollama`, `byteplus`, `volcengine`), but the public **Help-And-Grow/expert-network** deployment is standardized on **Alibaba Cloud Qwen / DashScope**. Default when unset: **`qwen`**. The containerized local stack defaults to **`ollama`**. Keep public docs, deployment config, and admin controls aligned with Alibaba/Qwen unless a task explicitly targets private experimentation. See `src/lib/ai/index.ts` and `src/lib/vendor-ai-stack-site.ts`.
3. **Expert memory backend**: `MEMORY_BACKEND=mem9|pgvector|hybrid`. Local/on-prem defaults should be **`pgvector`** with `EMBEDDING_PROVIDER=ollama`; mem9 remains optional for cloud/hybrid runs. See `src/lib/integrations/mem9-lifecycle.ts` and `src/lib/integrations/pgvector-memory.ts`.
4. **Payments**: Stripe (primary), TON (crypto), WeChat Pay. Webhook at `/api/webhooks/stripe`. H&G token redemption at checkout.
5. **Database switching**: Run `node scripts/switch-db.mjs` — Prisma is PostgreSQL-only and the script enforces `provider = "postgresql"` in `prisma/schema.prisma`.
6. **WeChat Mini Program**: Lives in `wechat/`, built with Taro. Uses the same backend API with `x-wechat-token` auth header.
7. **MCP server**: `/api/mcp` exposes expert search/match/availability as MCP tools for AI agents.
8. **Public API**: `/api/v1/` namespace provides auth-free GET endpoints for agent/skill consumption.
9. **POMP (Proof of Meet Protocol)**: Every completed meetup (`Booking` row) creates **two EAS attestations** on Base (schema in `src/lib/pomp-eas-schema.ts`) via `src/lib/pomp-credential.ts` + `@ethereum-attestation-service/eas-sdk`. Register schema once: `scripts/register-pomp-eas-schema.mjs`.
10. **H&G Token**: ERC-20 token (`contracts/src/HelpGrowToken.sol`) on Base. **Players** earn tokens 1:1 with SGD paid; redeem at 100 tokens = 1 SGD discount. On-chain burn via `redeemDiscount()`. See `src/lib/hg-token.ts`.
11. **Smart Contracts**: Foundry-based (`contracts/`). Deploy via `forge script script/Deploy.s.sol` (HelpGrowToken on Base Sepolia/Mainnet).
12. **HiClaw Agent System**: Node service in `hiclaw/service/` — **manager**, **shadowWorker** (generator), **evaluatorWorker** (quality loop), optional **plannerWorker** (sprint contract), **store** (Postgres via `HICLAW_POSTGRES_URL`, falling back to `DATABASE_URL`), **waitingRoom**. Local-first defaults are **Ollama + Postgres/pgvector**; mem9 is optional and the service falls back to `expert_memory_embeddings` when mem9 is off. Details: [`hiclaw/README.md`](hiclaw/README.md).
13. **On-chain Sync**: `/api/webhook/onchain` ingests **EAS `Attested`** logs (Alchemy webhook) and updates HiClaw `sessions` in Postgres (incl. `eas_attestation_uid`). `/api/reputation/:expertId` aggregates from the same store.
14. **Reputation Dashboard**: `/reputation` — expert stats from HiClaw DB + EASScan links; **player** H&G balance via wagmi + ledger API.
15. **AI Voice Chat**: Two modes controlled by `VOICE_CHAT_MODE` env var (`async` | `realtime` | `both`). **Async** (default): **Qwen / DashScope** handles transcription, reply generation, and TTS in `src/lib/voice-chat-session.ts`, with **5-reply free cap**, `POST /api/voice-chat/message`; opening voice greeting `POST /api/voice-chat/greeting`. On Web, entering the voice-chat surface now immediately tries to read the welcome message aloud, falling back to device speech when generated audio cannot autoplay; manual replay remains available. WeChat keeps grouped voice drafts (up to 3 clips) with one confirmed send per question bundle. **Realtime**: timed **AI chat** with a **3-min cap**, `POST /api/voice-chat/start` + `/stop`, plus text turns through `POST /api/voice-chat/message` with audio disabled for that surface, except the opening greeting may still be read aloud on entry. Config endpoint: `GET /api/voice-chat/config`. Realtime readiness now depends on **`DASHSCOPE_API_KEY`**.
16. **Expert detail contract**: `/api/experts/[id]` keeps legacy flags (`hasAudio`, `hasVoiceChat`, `hasClonedVoice`) but now also returns `experienceCapabilities` for voice-intro availability, async voice quota, premium realtime status, and canonical web continuation URLs.

## Documentation (key changes)

When you ship **user-visible behavior**, **new env vars**, **API contracts**, **schema/DDL**, or **architecture** changes, update docs in the same effort: `.env.example` / domain READMEs / `AGENTS.md` pointers / `ARCHITECTURE.md` / relevant `docs/design-docs/` status. Full checklist: [docs/references/documentation-maintenance.md](docs/references/documentation-maintenance.md). Cursor: `.cursor/rules/documentation-maintenance.mdc`.

## Coding Standards

- Parse data at boundaries — validate inputs with Zod or runtime checks
- Prefer shared utilities in `src/lib/` over hand-rolled helpers
- API routes return `NextResponse.json()` with consistent error shapes
- Use `export const maxDuration` for long-running serverless functions
- All notification calls (Telegram, WeChat) must be `.catch(() => {})` to not block responses
- Debug APIs under `/api/debug/*` must stay admin-gated; production reads require `DEBUG_API_ENABLED=1`, and destructive mutations additionally require `DEBUG_MUTATION_ENABLED=1`

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
| tRPC (typed API) | `src/trpc/root.ts`, `src/trpc/procedures/*.ts`, `src/app/api/trpc/[trpc]/route.ts`, `src/components/trpc-provider.tsx` — procedure table in [tech-stack-improvements.md §3](docs/design-docs/tech-stack-improvements.md#3-incremental-work-status) |
| Optional pgvector memory | `USE_PGVECTOR_MEMORY`, `src/lib/integrations/pgvector-memory.ts`, admin `/api/admin/migrate` SQL |
| Work on POMP/token features | `src/lib/pomp-credential.ts`, `src/lib/pomp-eas-schema.ts`, `src/lib/hg-token.ts`, `contracts/src/` |
| Modify smart contracts | `contracts/src/`, deploy via `contracts/script/Deploy.s.sol` |
| Work on HiClaw agents | `hiclaw/README.md`, `hiclaw/service/src/` (manager, shadowWorker, evaluatorWorker, plannerWorker, store, waitingRoom) |
| On-chain sync/reputation | `src/lib/tidb.ts`, `src/app/api/webhook/onchain/`, `src/app/api/reputation/` |
| Manage AI provider on Vercel | `/admin/ai-provider`, `src/app/api/admin/ai-provider/route.ts`, `src/lib/vercel-admin.ts` |
| Modify MCP server tools | `src/app/api/mcp/route.ts` |
| AI voice chat feature | `src/lib/voice-chat-config.ts` (toggle), `src/app/api/voice-chat/` (config/message/start/stop), `src/lib/voice-chat-session.ts`, `src/components/voice-chat-panel.tsx` (async), `src/components/voice-chat-modal.tsx` (realtime), `ten-agent/` (Phase B) |
| Premium live consultation | `docs/design-docs/premium-live-consultation.md`, `src/app/api/trtc/token/route.ts`, `src/lib/trtc.ts`, `prisma/schema.prisma` |
| Run browser smoke tests | `playwright.config.ts`, `e2e/`, `npm run test:ui`, `.github/workflows/ui-smoke.yml`; production URL smoke: `npm run test:e2e:ci`, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| E2E docs | [e2e/README.md](e2e/README.md) |
| Vercel OpenTelemetry / trace drains | `src/instrumentation.ts`, [docs/references/vercel-open-telemetry.md](docs/references/vercel-open-telemetry.md) |
| Vercel env (dev / preview / prod) | [docs/references/vercel-environments-solo-pm.md](docs/references/vercel-environments-solo-pm.md) |
| Update product specs | `docs/product-specs/` |

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->
