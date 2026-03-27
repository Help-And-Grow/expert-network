# Tech stack — remaining roadmap & operational guidance

**Scope:** Help & Grow — Expert Network  
**Date:** 2026-03  
**Status:** Active — **follow-up only** (large backlog items are already implemented in-repo)

**Completed work (archive):** Auth.js v5, Postgres-only Prisma + HiClaw session access, env validation, Inngest wiring, DB9 HTTP SQL in HiClaw `store.js`, optional pgvector dual-write, tRPC bootstrap, WeChat `shared-api`, npm audit CI/process, `miniprogram-ci` under `wechat/`. See the progress log in [tech-stack-improvements-tasks.md](../exec-plans/active/tech-stack-improvements-tasks.md) and ops notes in [postgres-cutover-runbook.md](../exec-plans/active/postgres-cutover-runbook.md).

**PM checklist:** [tech-stack-improvements-tasks.md](../exec-plans/active/tech-stack-improvements-tasks.md) — rows are **remaining** work only.

---

## 1. mem9 and DB9 — best practices for this product

### Roles today

| Layer | Responsibility | Typical technology |
|-------|----------------|-------------------|
| **Core marketplace** | Users, experts, bookings, payments, reviews | Postgres via Prisma (`DATABASE_URL`) |
| **Expert “memory” for AI** | Profile seeds, booking/review snippets, match-time context | **mem9** (hosted spaces per expert, `mem9SpaceId` on `Expert`) |
| **HiClaw / shadow agent** | Sessions, waiting room, handoffs, evaluator traces | **Postgres** (DB9 or any Postgres — TCP `pg` or **DB9 HTTP SQL**) |

mem9 fits **fast iteration** and **product memory** without you operating a vector pipeline: provisioning is already wired (`ensureExpertSpace`, lifecycle writes in `mem9-lifecycle.ts`). It keeps the main app decoupled from embedding models and index tuning.

DB9 (or “DB9-style” Postgres) fits **agent-local state** and **infrastructure you control**: same SQL as HiClaw tables, optional **HTTP SQL** for stateless workers, and **pgvector** if you want embeddings colocated with sessions.

### Recommended near-term stance (default)

1. **Keep mem9 as the system of record for expert memory** while you scale matching, HiClaw, and payments. Do not block launches on pgvector migration.
2. **Use Postgres (DB9 or Supabase) for HiClaw** — align `HICLAW_POSTGRES_URL` / `DB9_DATABASE_URL` with where you run `schema-postgres.sql`. Prefer **one physical Postgres** for HiClaw + on-chain session rows when ops cost matters; two instances remain valid if you want isolation.
3. **Enable `USE_PGVECTOR_MEMORY=1` only when** you explicitly want: (a) **dual-write** from the same lifecycle hooks into `expert_memory_embeddings`, (b) **search-first-on-PG** for `searchExpertMemories` (falls back to mem9 if PG returns nothing), (c) a path toward **reducing mem9 dependency** later. Requires Postgres + extension/table (admin migrate) and, for quality embeddings, **`OPENAI_API_KEY`** (see `pgvector-memory.ts`).
4. **Backfill** historical mem9 text into PG only after dual-write is stable: `POST /api/admin/pgvector-backfill` (admin), optional `expertId` scope.

### Long-term roadmap (when to shift weight from mem9 to pgvector/DB9)

| Stage | Goal | Action |
|-------|------|--------|
| **Now** | Reliability + simple ops | mem9 primary; PG optional mirror off |
| **Growth** | Cost/latency/compliance | Dual-write + `OPENAI_API_KEY`; monitor PG hit rate on search |
| **Mature** | Single-store story for agents | Make pgvector primary for **search**; mem9 read-only or decommission after migration script + verification |
| **HiClaw + memory unified** | One dialect, agent SQL + vectors | Prefer DB9 or one Postgres: sessions + optional `expert_memory_embeddings` in the same region as **DashScope** (Alibaba) for HiClaw |

**Principle:** mem9 optimizes for **speed of product development**; DB9/pgvector optimizes for **control, colocation with agent data, and Alibaba-adjacent deployment**. The codebase supports both; choose based on team capacity, not dogma.

**References:** `src/lib/integrations/mem9-lifecycle.ts`, `pgvector-memory.ts`, `mem9-pgvector-backfill.ts`, `hiclaw/README.md`, [hiclaw-agent-harness-db9.md](hiclaw-agent-harness-db9.md), [db9.ai skill](https://db9.ai/skill.md).

---

## 2. Inngest — situation, trade-offs, and suggestions

### What is already wired

- **Endpoint:** `GET/POST/PUT` `/api/inngest` registers **`chargeRemainderScheduled`** (daily cron) and **`pompIssueOnBookingCompleted`** (event `app/booking.completed`).
- **Shared business logic:** `runChargeRemainderCron()` in `src/lib/jobs/charge-remainder-cron.ts` (also used by Vercel cron).
- **Event emission:** `emitBookingCompletedPomp()` in `src/lib/inngest/emit.ts` runs only if **`INNGEST_EVENT_KEY`** is set; otherwise booking completion can still issue POMP **inline** (existing fallback).

### When Inngest is worth enabling

- You want a **dashboard**, **retries**, and **step visibility** for scheduled remainder charging or async POMP without building that yourself.
- You deploy on **Vercel** and are fine with a **third-party** orchestrator (US/EU SaaS — check data residency if that matters).

**Setup:** Create an app in Inngest Cloud, point it at `https://<your-domain>/api/inngest`, set **`INNGEST_SIGNING_KEY`** on Vercel. For events from the server, set **`INNGEST_EVENT_KEY`**. If Inngest owns the daily job, set **`CRON_DELEGATED_TO_INNGEST=1`** so `/api/cron/charge-remainder` **no-ops** and you do not double-charge.

### When to skip or minimize Inngest

- **Alibaba-first infra:** Prefer **Alibaba Cloud Function Compute** with a **time trigger** (cron) that `GET`s `/api/cron/charge-remainder` with `Authorization: Bearer <CRON_SECRET>` (same as Vercel Cron). No Inngest account required for that path.
- **Low volume / simplicity:** Vercel Cron alone + inline POMP fallback is sufficient until you feel pain from lack of retries/UI.
- **Cost / limits:** Inngest offers a **free Hobby** tier with monthly execution caps; verify current limits on [inngest.com/pricing](https://www.inngest.com/pricing). Scale → paid plans.

### Suggestion for this codebase

- **Default production path for a China/Alibaba-weighted stack:** **FC timer → existing cron URL** for remainder charging; leave **`INNGEST_EVENT_KEY`** unset unless you specifically want async POMP in Inngest.
- **Use Inngest** when the team wants **one** hosted job layer for multiple event types and is comfortable with vendor coupling for those workflows.

---

## 3. Remaining incremental work

| Item | Priority | Notes |
|------|----------|--------|
| **Expand tRPC** | Medium | Bootstrap exists (`src/trpc/`); add procedures domain-by-domain; REST remains valid. |
| **npm audit triage** | Medium | Root audit improved; keep triaging transitive issues; use `npm run audit` / CI workflow. |
| **Single physical Postgres** | Lower | Dialect is unified; merging Supabase + HiClaw into one instance is an ops/migration project when ready. |
| **Vercel env hygiene** | Ongoing | Ensure `DATABASE_URL` + `HICLAW_POSTGRES_URL` (or `DB9_DATABASE_URL`); add **`AUTH_SECRET`** when rotating from `NEXTAUTH_SECRET`; optional Inngest keys per §2. CLI: `vercel env ls` / `vercel env add` (values are not committed). |
| **Smoke tests after toggles** | Ongoing | After enabling pgvector or Inngest, run one booking + one expert profile update on staging. |

---

## Summary

- **mem9** = default, low-friction expert memory; **DB9/Postgres + optional pgvector** = control, colocation with HiClaw, and long-term consolidation.
- **Inngest** = optional reliability/dashboard layer; **Alibaba FC cron → `/api/cron/charge-remainder`** is the natural alternative for scheduled work in your stack.
- **Remaining doc-worthy work** is incremental: tRPC surface, audit triage, optional DB consolidation, env and smoke-test discipline.
