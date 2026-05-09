# AGENTS.md — Help & Grow

> This file is the **table of contents** for agents working in this repo.
> It is intentionally short (~100 lines). Detailed docs live in `docs/`.

## Brand (read first)

- **Product:** **Help & Grow** — **AI Native Expert Network**
- **Vision:** *Service as agent* — a digital expert that learns continuously from the human expert (social, meetings, reflection, memos), stays online, evolves with them, answers on-platform, and facilitates the expert.
- **Ethos:** Everyone is **both expert and player** (and **coach** when sharing); we foster **learning by doing** and **growing by helping**. Full copy: [docs/BRAND.md](docs/BRAND.md).

## Quick Start

- **Framework**: Next.js 15 (App Router) + TypeScript
- **Database**: Prisma 7 with PostgreSQL only (`@prisma/adapter-pg`). Production runs on **Google Cloud SQL** (instance `hg-postgres-prod`, db `helpgrow`, region `asia-southeast1`). `DATABASE_URL` is marked Sensitive in Vercel; `vercel env pull` returns it empty. Apply migrations via Cloud SQL Studio or `gcloud sql connect` (see "PR & Verification Workflow" below).
- **Hosting**: Vercel (serverless). The live `expert-network` project is owned by the **Help And Grow** Vercel team, but default Git-based iteration and deploys follow **`jlzxwt8/expert-network`** unless the user explicitly asks to sync the public `Help-And-Grow/expert-network` mirror.
- **Clients**: Web browser, Telegram Mini App, WeChat Mini Program (Taro)
- **UI smoke**: Playwright (`npm run test:ui`) with local dev-login (`DEV_AUTH_EMAIL`, optional `DEV_AUTH_ROLE`) — for **local** development. On CI we run Playwright against the canonical production URL (`https://www.help-and-grow.com`) via the `e2e` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). The dedicated `ui-smoke.yml` workflow + ephemeral CI Postgres were removed 2026-05-06; live prod is the single source of truth.

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
| API reference | [docs/API.md](docs/API.md) | Full endpoint matrix (methods, auth, purpose) |
| Env vars | [docs/ENV.md](docs/ENV.md) | Grouped reference for every env var |
| Runbook | [docs/RUNBOOK.md](docs/RUNBOOK.md) | Local dev, build pipeline, Vercel deploy, CI workflows, troubleshooting |
| Design system | [docs/DESIGN.md](docs/DESIGN.md) | UI conventions, component patterns |
| Frontend | [docs/FRONTEND.md](docs/FRONTEND.md) | Page structure, routing, state |
| Plans | [docs/PLANS.md](docs/PLANS.md) | Current roadmap and priorities |
| Brand | [docs/BRAND.md](docs/BRAND.md) | Name, positioning, vision, voice |
| Product sense | [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md) | User personas, product principles |
| Quality | [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md) | Per-domain quality grades |
| Reliability | [docs/RELIABILITY.md](docs/RELIABILITY.md) | Error handling, SLOs, monitoring, health checks, auto-baseline |
| Security | [docs/SECURITY.md](docs/SECURITY.md) | Auth, data handling, secrets; [Vercel env / rotation](docs/references/vercel-env-and-secret-rotation.md) |
| Design docs | [docs/design-docs/](docs/design-docs/) | Indexed design decisions |
| Exec plans | [docs/exec-plans/](docs/exec-plans/) | Active plans, completed, tech debt |
| Product specs | [docs/product-specs/](docs/product-specs/) | Feature specifications |
| References | [docs/references/](docs/references/) | LLM-friendly external references + [documentation maintenance](docs/references/documentation-maintenance.md) + [multi-tenant Vercel / dashboard URLs](docs/references/multi-repo-strategy.md) |
| Vercel + Cloud SQL | [docs/exec-plans/active/supabase-to-cloudsql-migration.md](docs/exec-plans/active/supabase-to-cloudsql-migration.md) | Production cutover (2026-05-03): Google Cloud SQL `hg-postgres-prod`, schema/migration application playbook |
| Memos | [docs/memos/](docs/memos/) | Investor & GTM briefs |
| Generated | [docs/generated/](docs/generated/) | Auto-generated DB schema docs |

## Key Conventions

1. **Authentication**: All API routes use `resolveUserId(request)` from `src/lib/request-auth.ts` — supports Auth.js (NextAuth v5), Telegram, and WeChat in one call. Config: `src/auth.ts`.
2. **AI providers**: `AI_PROVIDER` supports multiple adapters in code (`gemini`, `qwen`, `openai`, `zai`, `byteplus`, `volcengine`, `hunyuan`). Production routing for Web/Telegram/WeChat-Intl is **Qwen / DashScope (Alibaba Cloud)** with **Gemini / Vertex (Google Cloud)** as fallback and search grounding. Default when unset: **`qwen`**. **China WeChat app** (future) will use **`hunyuan`** (Tencent LLM) on a China-local Tencent Cloud stack to keep all AI processing within China mainland. See `src/lib/ai/index.ts` and `src/lib/vendor-ai-stack-site.ts`.
3. **Expert memory backend**: `MEMORY_BACKEND=mem9|pgvector|hybrid`. Local/on-prem defaults should be **`pgvector`** with `EMBEDDING_PROVIDER=ollama`; mem9 remains optional for cloud/hybrid runs. See `src/lib/integrations/mem9-lifecycle.ts` and `src/lib/integrations/pgvector-memory.ts`.
4. **Payments**: Stripe (primary), TON (crypto), WeChat Pay. Webhook at `/api/webhooks/stripe`. H&G token redemption at checkout.
5. **Database switching**: Run `node scripts/switch-db.mjs` — Prisma is PostgreSQL-only and the script enforces `provider = "postgresql"` in `prisma/schema.prisma`.
6. **WeChat Mini Program**: Lives in `wechat/`, built with Taro. Two apps serve different markets:
   - **International app** (`TARO_APP_REGION=intl`, AppID `wx09d0eb079596060d`): Registered by Singapore company, positioned as a **free mentoring platform** helping youth learn AI in building products. Talks directly to Vercel at `https://www.help-and-grow.com` (same backend + database as Web/Telegram).
   - **China mainland app** (`TARO_APP_REGION=cn`): Future app registered by the Chinese company, connecting to China-local Tencent Cloud infrastructure (CloudBase/TCB + TencentDB + COS) with **Hunyuan** as AI provider. **Data residency principle**: all data for the China app is stored and processed **only within China mainland** (separate DB, separate infra). Build config: `wechat/build-config/cn.json`.
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

## PR & Verification Workflow

**Solo-PM fast path (as of 2026-05-08):**

The owner is a solo PM. Preview-URL verification was added friction without catching enough bugs to justify it on this codebase, so we skip it. The new default is: ship to PROD live, verify the Vercel build + runtime logs, and let the owner do the user test on `https://www.help-and-grow.com` directly.

1. **Commit + push.** Prefer a PR for traceability when several files change (`gh pr create --base main`); for tiny fixes you may push directly to `main`. Either way, the goal is to land on `main` quickly.
2. **Merge immediately when CI is green** (`lint`, `smoke`, `audit`, `e2e`, `Vercel Preview Comments` all ✓). Use `gh pr merge --squash --delete-branch --admin`. Don't wait on or open the preview URL.
3. **Verify the Vercel PROD build.** `vercel ls expert-network` should show a new Production deployment going `Building` → `Ready` (~3-4 min). Inspect logs with `vercel inspect <prod-url> --logs` and look for: build success, no migration warnings (`prisma-migrate-if-vercel`), no runtime errors after the alias swap. Hit one or two prod endpoints with `curl https://www.help-and-grow.com/...` to confirm the function path works.
4. **Hand back to the owner for user test** on `https://www.help-and-grow.com/...` once step 3 looks clean. Do not declare "done" until you've at least confirmed the prod build went `Ready` and a smoke `curl` returned a non-500 status.

**Database migrations are the one exception.** Production runs on **Google Cloud SQL for PostgreSQL** (`hg-postgres-prod`, db `helpgrow`, user `hg_app` — see [docs/exec-plans/active/supabase-to-cloudsql-migration.md](docs/exec-plans/active/supabase-to-cloudsql-migration.md)). `DATABASE_URL` on Vercel is marked **Sensitive** so `vercel env pull` returns it as an empty string — you cannot run `prisma migrate deploy` from a local machine without first plumbing the connection string in another way. `scripts/prisma-migrate-if-vercel.mjs` likewise skips at install time. Net effect: when a PR adds a Prisma migration, the column/table won't exist in PROD until someone applies it manually, and the new code will 500 on every request that touches the new field.

When a PR adds a migration, do this **before merging**:
1. Read the migration SQL out of `prisma/migrations/<timestamp>_<name>/migration.sql`.
2. Apply it via **Cloud SQL Studio** (GCP console → SQL → `hg-postgres-prod` → Studio → log in as `hg_app` to db `helpgrow`) or `gcloud sql connect hg-postgres-prod --user=hg_app --database=helpgrow`.
3. Also `INSERT` a row into `_prisma_migrations` so future automated migrate runs see it as applied:
   ```sql
   INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
   VALUES (gen_random_uuid()::text, 'manual-cloudsql-studio', NOW(), '<timestamp>_<name>', NULL, NULL, NOW(), 1)
   ON CONFLICT DO NOTHING;
   ```
4. Confirm with the owner before running anything destructive (DROP, NOT NULL on existing column, etc.). Purely additive `ADD COLUMN IF NOT EXISTS` is safe to apply directly with owner's go-ahead.

**No localhost or `npm run dev` for verification.** Live PROD is the single source of truth.

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
| tRPC (typed API) | `src/trpc/root.ts`, `src/trpc/procedures/*.ts`, `src/app/api/trpc/[trpc]/route.ts`, `src/components/trpc-provider.tsx` |
| Optional pgvector memory | `USE_PGVECTOR_MEMORY`, `src/lib/integrations/pgvector-memory.ts`, admin `/api/admin/migrate` SQL |
| Work on POMP/token features | `src/lib/pomp-credential.ts`, `src/lib/pomp-eas-schema.ts`, `src/lib/hg-token.ts`, `contracts/src/` |
| Modify smart contracts | `contracts/src/`, deploy via `contracts/script/Deploy.s.sol` |
| Work on HiClaw agents | `hiclaw/README.md`, `hiclaw/service/src/` (manager, shadowWorker, evaluatorWorker, plannerWorker, store, waitingRoom) |
| On-chain sync/reputation | `src/lib/tidb.ts`, `src/app/api/webhook/onchain/`, `src/app/api/reputation/` |
| Manage AI provider on Vercel | `/admin/ai-provider`, `src/app/api/admin/ai-provider/route.ts`, `src/lib/vercel-admin.ts` |
| Modify MCP server tools | `src/app/api/mcp/route.ts` |
| AI voice chat feature | `src/lib/voice-chat-config.ts` (toggle), `src/app/api/voice-chat/` (config/message/start/stop), `src/lib/voice-chat-session.ts`, `src/components/voice-chat-panel.tsx` (async), `src/components/voice-chat-modal.tsx` (realtime), `ten-agent/` (Phase B) |
| Premium live consultation | [docs/design-docs/product-features.md §2](docs/design-docs/product-features.md#2-premium-live-consultation-trtc), `src/app/api/trtc/token/route.ts`, `src/lib/trtc.ts`, `prisma/schema.prisma` |
| Run browser smoke tests | `playwright.config.ts`, `e2e/`. Local dev: `npm run test:ui` (local Next.js + dev-login). CI: `npm run test:e2e:ci` against `https://www.help-and-grow.com` via [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — single workflow, single source of truth |
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
