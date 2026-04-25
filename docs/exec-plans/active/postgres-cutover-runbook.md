# Postgres cutover — operations runbook

The main app and HiClaw-related server routes use **PostgreSQL** only for Prisma and for HiClaw session / on-chain sync tables. MySQL `DATABASE_URL` values are rejected at startup.

## Environment variables

### Core app (Prisma)

- **`DATABASE_URL`** — must be `postgres://` or `postgresql://` (Supabase, Neon, etc.). On **Vercel Marketplace Supabase**, the integration may only sync **`POSTGRES_PRISMA_URL`**; this app treats that as `DATABASE_URL` when `DATABASE_URL` is unset — see [vercel-supabase-marketplace.md](../../references/vercel-supabase-marketplace.md).

### HiClaw session DB (Next.js: `/api/webhook/onchain`, `/api/reputation/:expertId`, admin “HiClaw DB”)

Resolution order in `src/lib/tidb.ts`:

1. **`HICLAW_POSTGRES_URL`**
2. **`DATABASE_URL`**

If none resolve to Postgres, routes that call `tidb` helpers will throw with a clear error.

### HiClaw Node service (`hiclaw/service`)

- **`HICLAW_POSTGRES_URL`** — preferred direct Postgres URL for HiClaw workers.
- Else **`DATABASE_URL`** — reuse the same Supabase/Postgres instance as the main app.

### Inngest (optional)

- **`INNGEST_SIGNING_KEY`** — verify requests to `/api/inngest`.
- **`INNGEST_EVENT_KEY`** — server-side `inngest.send()` (e.g. `app/booking.completed` for POMP).
- **`CRON_DELEGATED_TO_INNGEST=1`** — when the daily booking maintenance job runs in Inngest, skip duplicate work on the Vercel cron route (if configured).

### pgvector backfill (optional)

- Apply migrations that create `vector` and `expert_memory_embeddings` (via `/api/admin/migrate` on Vercel when local DB is unreachable).
- **`USE_PGVECTOR_MEMORY=1`** and embeddings provider as documented in `.env.example`.
- **POST** `/api/admin/pgvector-backfill` (admin session) — optional JSON `{ "expertId": "..." }` to scope; otherwise all experts with `mem9SpaceId`.

## Deploy checklist

1. Set **`DATABASE_URL`** (or rely on **`POSTGRES_PRISMA_URL` / `POSTGRES_URL`** from Vercel Supabase) to Postgres on Vercel. Vercel **`npm install` postinstall** runs **`prisma migrate deploy`** when `VERCEL=1` so an empty database receives [`prisma/migrations`](../../../prisma/migrations/) — see [vercel-supabase-marketplace.md](../../references/vercel-supabase-marketplace.md).
2. Set **`HICLAW_POSTGRES_URL`** to the **same** or a dedicated Postgres that holds HiClaw tables (`sessions`, etc.). If unset, the app will reuse `DATABASE_URL`.
3. Run **Apply HiClaw schema** from **Admin → HiClaw DB** (`/admin/tidb`) or execute the DDL your team uses for that database.
4. Register **`https://<your-domain>/api/inngest`** in Inngest Cloud and set signing + event keys if using scheduled or event-driven functions.
5. Remove any **`mysql://`** URLs from secrets; they will break boot or HiClaw routes.

## Local development

Corporate proxy may block direct DB access; use Supabase pooler or skip DB-heavy routes. **`npx prisma generate`** works offline; schema push/migrate against remote DB should use the admin migrate route or Vercel.
