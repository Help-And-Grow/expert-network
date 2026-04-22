# Tech stack — remaining tasks (PM-friendly)

This file lists **only work that is still open**. Shipped items (Auth.js v5, Postgres cutover, Inngest wiring, pgvector optional path, tRPC bootstrap, WeChat shared-api, audit process, etc.) are recorded in the **Progress log** below — not as active tasks.

**Strategy & rationale:** [tech-stack-improvements.md](../../design-docs/tech-stack-improvements.md) (mem9 vs DB9/pgvector, Inngest vs Alibaba FC, long-term roadmap).

**Ops:** [postgres-cutover-runbook.md](./postgres-cutover-runbook.md)

---

## Legend

| Status | Meaning |
|--------|---------|
| **Next** | Do when capacity allows |
| **Ongoing** | No clear “done” — keep doing |
| **Optional** | Product decision |
| **Done** | Closed — see Progress log / § decisions below |

---

## Active tasks

| # | Task | In plain English | Status |
|---|------|------------------|--------|
| D | **Inngest vs FC cron** | Either configure Inngest env + dashboard **or** use Alibaba **Function Compute** timer hitting `/api/cron/charge-remainder` with `CRON_SECRET`; avoid double runs (`CRON_DELEGATED_TO_INNGEST`). | **Optional** |
| F | **Vercel env** | Set `HICLAW_POSTGRES_URL` if HiClaw should use a dedicated database, otherwise keep `DATABASE_URL` as the shared Supabase Postgres source of truth; rotate toward `AUTH_SECRET`. **How:** [tech-stack-improvements.md §4](../../design-docs/tech-stack-improvements.md#4-vercel-cli-managing-environment-variables) (CLI commands + full checklist). Platform habits: [vercel-best-practices.md](../../design-docs/vercel-best-practices.md). | **Ongoing** |
| G | **Post-deploy / toggle smoke** | **Public:** `npm run smoke:public` (or `scripts/smoke-public-endpoints.sh`) + deploy workflow. **Manual:** one **meetup** path + expert profile on staging after infra toggles. | **Ongoing** (public smoke vs prod URL passed 2026-03) |

**Done (documented elsewhere):** tRPC procedure inventory (tech-stack **§3.1**); npm production audit triage (tech-stack **§3.2**, [npm-audit-production.md](../../design-docs/npm-audit-production.md)).

### Closed product / architecture decisions

| # | Task | Outcome |
|---|------|---------|
| **C** | **Single Postgres (optional)** | **Done.** The default architecture is **Supabase/Postgres only**. Marketplace uses `DATABASE_URL`; HiClaw may use `HICLAW_POSTGRES_URL` only when you explicitly want a separate Postgres instance. |
| **E** | **Expert memory: mem9 vs pgvector** | **Done.** **mem9** is the primary path for expert memory (PingCAP partnership). **pgvector** stays an **optional** code path only if you set `USE_PGVECTOR_MEMORY=1` — not a default roadmap item. |

---

## Progress log (completed / shipped)

| Date | Note |
|------|------|
| 2026-04-10 | **Database cleanup:** DB9/TiDB runtime paths removed. `DATABASE_URL` is the Supabase/Postgres source of truth; `HICLAW_POSTGRES_URL` is optional for isolation. |
| 2026-04-22 | **Security/reliability pass:** `/api/debug/*` gated behind admin + debug flags, first-pass Zod validation/rate limiting for booking/voice/auth routes, and Playwright smoke expanded for API boundary checks. |
| 2026-03-31 | **Task E closed (PM):** **mem9** remains the primary expert-memory system; pgvector is optional only. |
| 2026-03-28 | tRPC surface documented in tech-stack §3.1; npm audit triage + `serialize-javascript` override + [npm-audit-production.md](../../design-docs/npm-audit-production.md); tasks A/B closed. |
| 2026-03-24 | Env validation; tracker created. |
| 2026-03-27 | Auth.js v5, shared-api, cron runner extraction, audit scripts. |
| 2026-03-27 | Inngest, tRPC bootstrap, pgvector optional path, HiClaw HTTP SQL, WeChat dep, miniprogram-ci under `wechat/`, CI audit workflow, Postgres-canonical path. |
| 2026-03-27 | tRPC split by domain (`src/trpc/procedures/`), `user.me`, `audit:triage`, `smoke-public-endpoints.sh`, deploy smoke + tRPC health; PM mem9/DB9 section; Vercel best practices split to `vercel-best-practices.md`. |
| 2026-03-24 | Postgres cutover in repo: `@prisma/adapter-pg` only; removed root `mysql2` / mariadb adapter; HiClaw service without mysql2; docs + runbook. |
| 2026-03-24 | Tech improvement doc trimmed to **remaining** roadmap; mem9/DB9 + Inngest guidance consolidated here. |

---

## When you hire a developer or use Cursor

- Start with [tech-stack-improvements.md](../../design-docs/tech-stack-improvements.md) for **why**; use the **Active tasks** table above for **what’s left**.
- After changing **Inngest**, **pgvector**, or **DB URLs**, run `scripts/smoke-public-endpoints.sh` (public checks) **and** smoke-test one **meetup** + expert profile on staging.
