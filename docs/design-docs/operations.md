# Operations

**Status**: Accepted (living)
**Date**: 2026-04
**Scope**: Engineering principles, data-layer guidance, platform defaults, dependency posture, tech-debt status. Companion: [architecture.md](architecture.md), [product-features.md](product-features.md), [agent-system.md](agent-system.md).

This document holds the operational truth that the other design docs depend on but don't repeat: how we make decisions, where data lives, what the platform expects, and what's still on the punch list.

---

## 1. Engineering Principles

These guide both human and AI contributors.

1. **Repository is the single source of truth.** Architecture decisions, product specs, conventions, plans — all live in the repo as versioned artifacts. Information in chat threads, emails, or people's heads is invisible to new engineers and AI agents.
2. **Progressive disclosure over monoliths.** Short entry points (AGENTS.md, this folder's `index.md`) link to deeper docs. Reduce cognitive load at the top.
3. **Parse at boundaries, trust internally.** Validate and parse external inputs (API request bodies, webhook payloads, env vars) at the boundary. Internal calls between trusted layers can assume correct types.
4. **Prefer boring technology.** Postgres, Next.js, Stripe, plain SQL. Boring tech has better training-data coverage for AI agents, more predictable behavior, and lower maintenance burden.

---

## 2. Data Layer

Data blocks are intentionally separated. Each solves a different problem and can evolve behind an interface.

| If the product needs… | Where it lives | Plain English |
|-----------------------|----------------|---------------|
| Accounts, bookings, payments, the catalog | `DATABASE_URL` (Google Cloud SQL `hg-postgres-prod`) | Source of truth for the marketplace |
| Fast expert candidate retrieval | Postgres `pgvector` (`expert_profile_embeddings`) | Current semantic pre-rank index for Web/Telegram matching |
| AI-ready memory about each expert (profile facts, meetups, appreciations) | **mem9** hosted API (`v1alpha2`; per-expert key in `Expert.mem9SpaceId`) | Managed long-term memory: write stable facts/events, search snippets when building context |
| HiClaw agent runs (sessions, waiting room, handoffs, traces) and optional vectors near agent data | `HICLAW_POSTGRES_URL` (or fallback to `DATABASE_URL`) | Same Postgres, optionally with `pgvector` |
| Internal agent research workspaces | Future DB9 pilot | Files, SQL, branches, cron, and embedding experiments for agents; not production marketplace data |

**Stance:** Postgres stays the production source of truth. pgvector remains the pragmatic semantic matching index until it becomes the bottleneck; Zilliz/Milvus is the future vector provider boundary, not an immediate rewrite. mem9 stays the product memory layer, modernized to hosted `v1alpha2` calls with `X-API-Key` and `X-Mnemo-Agent-Id`. DB9 is reserved for internal agent workspace pilots.

**`USE_PGVECTOR_MEMORY=1`** enables (a) dual-write from lifecycle hooks into `expert_memory_embeddings`, (b) search-first-on-PG in `searchExpertMemories` (falls back to mem9), (c) a path toward reducing mem9 dependency. Requires Gemini embeddings via `GEMINI_API_KEY` or Vertex credentials (`GOOGLE_CLOUD_PROJECT` + `GOOGLE_SERVICE_ACCOUNT_KEY`). Backfill historical mem9 text via `POST /api/admin/pgvector-backfill` (admin) only after dual-write is stable.

**References**: `src/lib/integrations/mem9.ts`, `mem9-lifecycle.ts`, `pgvector-memory.ts`, `mem9-pgvector-backfill.ts`, [`agent-memory-search-stack.md`](agent-memory-search-stack.md), [`hiclaw/README.md`](../../hiclaw/README.md).

---

## 3. Background Jobs (Inngest vs. Vercel Cron vs. Alibaba FC)

What's wired:
- **Endpoint** `/api/inngest` registers `chargeRemainderScheduled` (daily booking maintenance) and `pompIssueOnBookingCompleted` (`app/booking.completed`).
- **Shared logic** `runChargeRemainderCron()` in `src/lib/jobs/charge-remainder-cron.ts`.
- **Event emission** `emitBookingCompletedPomp()` runs only when `INNGEST_EVENT_KEY` is set; otherwise the booking-completion path issues POMP **inline**.

| Path | When to choose |
|------|----------------|
| **Vercel Cron + inline POMP** | Default. Simplicity, no third-party orchestrator. |
| **Inngest** | When you want a dashboard, retries, and step visibility. Set `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, and `CRON_DELEGATED_TO_INNGEST=1` so Vercel cron no-ops. |
| **Alibaba FC time-trigger** | China-weighted deployments. Time-trigger calls `GET /api/cron/charge-remainder` with `Authorization: Bearer <CRON_SECRET>`. No Inngest account needed. |

---

## 4. Vercel Defaults

For Next.js on Vercel, these are non-negotiable defaults:

- **Stateless functions** — no durable RAM/FS, no background daemons. Use Vercel Blob or Marketplace integrations for state.
- **Edge Functions (standalone) are deprecated** — prefer Vercel Functions.
- **Don't start new projects on Vercel KV/Postgres** — both discontinued. Use Marketplace Redis/Postgres.
- **Secrets in Vercel Env Variables** — not in git, never in `NEXT_PUBLIC_*`.
- **Sync env locally** — `vercel env pull` / `vercel pull`.
- **`waitUntil`** for post-response work — avoid the deprecated `context` parameter.
- **Region pinning** — `vercel.json` pins all functions to `sin1` (Singapore). Don't override unless you understand the latency impact on AI/voice paths.
- **Tune Fluid Compute** — `maxDuration` and memory/CPU for long I/O calls (LLMs, external APIs). Already set on `voice-chat`, `inngest`, `pgvector-backfill`, `onboarding/generate`.
- **Runtime Cache** is regional, not global KV — use it for fast regional caching with tag invalidation.

Env vars and CLI commands for this project: see the deploy runbook at [`docs/exec-plans/active/postgres-cutover-runbook.md`](../exec-plans/active/postgres-cutover-runbook.md).

---

## 5. Dependency Posture (npm audit)

- **`npm audit fix`** applied where safe.
- **`overrides.serialize-javascript`** pinned to `^7.0.5` in root `package.json` to address mocha → serialize-javascript advisories without waiting on Hardhat's pinned tree.
- **CI** runs `npm run audit:triage` and uploads `audit-production.json` ([`.github/workflows/npm-audit.yml`](../../.github/workflows/npm-audit.yml)). Workflow is currently **disabled** (`if: false`) to preserve Action minute quota; re-enable after May 1 2026.
- **Accepted residual risk**: `npm audit --omit=dev` advisories that all trace through `@ethereum-attestation-service/eas-sdk → eas-contracts → Hardhat → @sentry/node / cookie / elliptic / ethers@5 / solc / tmp / undici@6 …`. These have no upstream fix on Hardhat's pinned tree; they're not in the runtime path.

---

## 6. Tech Debt — Live Punch List

| Item | Status | Note |
|------|--------|------|
| **TD-001: E2E payment-flow contract** | **Done (skeleton)** | `e2e/booking/payment-flow.spec.ts` validates 401/400 boundaries on `POST /api/bookings/checkout` and the Telegram webhook 200-OK contract. Full Stripe-redirect coverage still gated behind `PLAYWRIGHT_RUN_CHECKOUT_TEST` + storage state. |
| **TD-001: voice-chat E2E** | Not started | `e2e/voice/voice-chat.spec.ts` doesn't exist yet. Realtime voice is hard to harness in Playwright. Defer until product is past phase 3. |
| **TD-002: Zod validation coverage** | **Partial (~18%)** | Hot paths (booking checkout, voice-chat message, auth/telegram, webhooks, wechat-pay, trtc/token) are covered. Gaps: `PUT /api/expert/profile`, `POST /api/reviews`, search query params. Worth a targeted ~2h pass when capacity opens. |
| **npm audit CI re-enable** | Pending May 1 quota | Process is ready (workflow + script + override). Just flip `if: false` after the quota resets. |
| **Vercel knobs** | **Done** | `maxDuration` set on long-IO routes; functions pinned to `sin1`; cron configured (`/api/cron/charge-remainder` 00:00 UTC). One micro-gap: no `waitUntil` callsites — fine if no deferred work; revisit when latency traces show post-response work matters. |

When picking what to actually work on next, prefer the targeted Zod hardening over the voice-chat E2E. Validation gaps have a higher security blast radius and a lower cost to close.
