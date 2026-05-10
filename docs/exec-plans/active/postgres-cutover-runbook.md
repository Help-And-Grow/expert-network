# Postgres cutover — operations runbook

The main app and HiClaw-related server routes use **PostgreSQL** only for Prisma and for HiClaw session / on-chain sync tables. MySQL `DATABASE_URL` values are rejected at startup.

> **Production runs on Cloud SQL** (`asia-southeast1`) since 2026-05-03. See [archive/supabase-to-cloudsql-migration.md](../archive/supabase-to-cloudsql-migration.md) for the migration record and [cloud-sql-data-viewing.md](../../references/cloud-sql-data-viewing.md) for everyday DB-access patterns.

## Environment variables

### Core app (Prisma)

- **`DATABASE_URL`** — must be `postgres://` or `postgresql://`. For Cloud SQL the URL takes the shape `postgresql://user:pass@HOST:5432/db?sslmode=require&sslaccept=accept_invalid_certs`. The `sslaccept=accept_invalid_certs` is required for Prisma's Rust query engine to accept Cloud SQL's managed CA chain.

### HiClaw session DB (Next.js: `/api/webhook/onchain`, `/api/reputation/:expertId`, admin “HiClaw DB”)

Resolution order in `src/lib/tidb.ts`:

1. **`HICLAW_POSTGRES_URL`**
2. **`DATABASE_URL`**

If none resolve to Postgres, routes that call `tidb` helpers will throw with a clear error.

### HiClaw Node service (`hiclaw/service`)

- **`HICLAW_POSTGRES_URL`** — preferred direct Postgres URL for HiClaw workers.
- Else **`DATABASE_URL`** — reuse the same Cloud SQL instance as the main app.

### Inngest (optional)

- **`INNGEST_SIGNING_KEY`** — verify requests to `/api/inngest`.
- **`INNGEST_EVENT_KEY`** — server-side `inngest.send()` (e.g. `app/booking.completed` for POMP).
- **`CRON_DELEGATED_TO_INNGEST=1`** — when the daily booking maintenance job runs in Inngest, skip duplicate work on the Vercel cron route (if configured).

### pgvector backfill (optional)

- Apply migrations that create `vector` and `expert_memory_embeddings` (via `/api/admin/migrate` on Vercel when local DB is unreachable).
- **`USE_PGVECTOR_MEMORY=1`** and embeddings provider as documented in `.env.example`.
- **POST** `/api/admin/pgvector-backfill` (admin session) — optional JSON `{ "expertId": "..." }` to scope; otherwise all experts with `mem9SpaceId`.

## Deploy checklist

1. Set **`DATABASE_URL`** to the Cloud SQL Postgres instance on Vercel. Vercel **`npm install` postinstall** runs **`prisma migrate deploy`** when `VERCEL=1` so an empty database receives [`prisma/migrations`](../../../prisma/migrations/). Transient connection failures are retried and may be skipped with a warning; set `PRISMA_MIGRATE_STRICT=1` if the build must fail instead. When the target DB already has tables but no `_prisma_migrations` history (Prisma error **P3005**), [`scripts/prisma-migrate-if-vercel.mjs`](../../../scripts/prisma-migrate-if-vercel.mjs) auto-resolves the baseline migration `20260424120000_baseline` and retries — added 2026-04 (commit `edf8faf`).
2. Set **`HICLAW_POSTGRES_URL`** to the **same** or a dedicated Postgres that holds HiClaw tables (`sessions`, etc.). If unset, the app will reuse `DATABASE_URL`.
3. Run **Apply HiClaw schema** from **Admin → HiClaw DB** (`/admin/tidb`) or execute the DDL your team uses for that database.
4. Register **`https://<your-domain>/api/inngest`** in Inngest Cloud and set signing + event keys if using scheduled or event-driven functions.
5. Remove any **`mysql://`** URLs from secrets; they will break boot or HiClaw routes.

## Local development

Corporate proxy may block direct DB access; tunnel through Cloud SQL Auth Proxy (`cloud-sql-proxy expert-network-489508:asia-southeast1:hg-postgres-prod`) or skip DB-heavy routes. **`npx prisma generate`** works offline; schema push/migrate against remote DB should use the admin migrate route or Vercel.
