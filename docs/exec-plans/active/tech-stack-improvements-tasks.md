# Tech stack — remaining tasks (PM-friendly)

This file lists **only work that is still open**. Shipped items (Auth.js v5, Postgres cutover, Inngest wiring, DB9 HTTP SQL, pgvector optional path, tRPC bootstrap, WeChat shared-api, audit process, etc.) are recorded in the **Progress log** below — not as active tasks.

**Strategy & rationale:** [tech-stack-improvements.md](../../design-docs/tech-stack-improvements.md) (mem9 vs DB9/pgvector, Inngest vs Alibaba FC, long-term roadmap).

**Ops:** [postgres-cutover-runbook.md](./postgres-cutover-runbook.md)

---

## Legend

| Status | Meaning |
|--------|---------|
| **Next** | Do when capacity allows |
| **Ongoing** | No clear “done” — keep doing |
| **Optional** | Product decision |

---

## Active tasks

| # | Task | In plain English | Status |
|---|------|------------------|--------|
| C | **Single Postgres (optional)** | Merge marketplace + HiClaw into one physical DB when migration cost is acceptable. | **Optional** |
| D | **Inngest vs FC cron** | Either configure Inngest env + dashboard **or** use Alibaba **Function Compute** timer hitting `/api/cron/charge-remainder` with `CRON_SECRET`; avoid double runs (`CRON_DELEGATED_TO_INNGEST`). | **Optional** |
| E | **mem9 → pgvector maturity** | If using `USE_PGVECTOR_MEMORY=1`: run admin migrate, set `OPENAI_API_KEY`, backfill via `/api/admin/pgvector-backfill`, then evaluate mem9 read-only / retirement. | **Optional** |
| F | **Vercel env** | Set `HICLAW_POSTGRES_URL` or `DB9_DATABASE_URL`; ensure `DATABASE_URL` is `postgresql://`; rotate toward `AUTH_SECRET`. **How:** [tech-stack-improvements.md §4](../../design-docs/tech-stack-improvements.md#4-vercel-cli-managing-environment-variables) (CLI commands + full checklist). Platform habits: [vercel-best-practices.md](../../design-docs/vercel-best-practices.md). | **Ongoing** |
| G | **Post-deploy / toggle smoke** | **Public:** `npm run smoke:public` (or `scripts/smoke-public-endpoints.sh`) + deploy workflow. **Manual:** one booking + expert profile on staging after infra toggles. | **Ongoing** |

**Done (documented elsewhere):** tRPC procedure inventory (tech-stack **§3.1**); npm production audit triage (tech-stack **§3.2**, [npm-audit-production.md](../../design-docs/npm-audit-production.md)).

---

## Progress log (completed / shipped)

| Date | Note |
|------|------|
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
- After changing **Inngest**, **pgvector**, or **DB URLs**, run `scripts/smoke-public-endpoints.sh` (public checks) **and** smoke-test one booking + expert profile on staging.
