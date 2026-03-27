# Postgres cutover — operations runbook

The main app and HiClaw-related server routes use **PostgreSQL** only for Prisma and for HiClaw session / on-chain sync tables. MySQL `DATABASE_URL` values are rejected at startup.

## Environment variables

### Core app (Prisma)

- **`DATABASE_URL`** — must be `postgresql://` or `postgresql://` (Supabase, Neon, etc.).

### HiClaw session DB (Next.js: `/api/webhook/onchain`, `/api/reputation/:expertId`, admin “HiClaw DB”)

Resolution order in `src/lib/tidb.ts`:

1. **`HICLAW_POSTGRES_URL`**
2. **`DB9_DATABASE_URL`**
3. **`TIDB_DATABASE_URL`** — **only** if the value starts with `postgres://` or `postgresql://` (legacy name for the same Postgres instance).

If none resolve to Postgres, routes that call `tidb` helpers will throw with a clear error.

### HiClaw Node service (`hiclaw/service`)

- **`DB9_HTTP_SQL_URL`** + **`DB9_HTTP_SQL_TOKEN`** (or `DB9_API_KEY`) — HTTP SQL (preferred when using DB9-style API).
- Else **`DB9_DATABASE_URL`** or **`HICLAW_POSTGRES_URL`** — TCP `pg` pool.

### Inngest (optional)

- **`INNGEST_SIGNING_KEY`** — verify requests to `/api/inngest`.
- **`INNGEST_EVENT_KEY`** — server-side `inngest.send()` (e.g. `app/booking.completed` for POMP).
- **`CRON_DELEGATED_TO_INNGEST=1`** — when the daily charge-remainder job runs in Inngest, skip duplicate work on the Vercel cron route (if configured).

### pgvector backfill (optional)

- Apply migrations that create `vector` and `expert_memory_embeddings` (via `/api/admin/migrate` on Vercel when local DB is unreachable).
- **`USE_PGVECTOR_MEMORY=1`** and embeddings provider as documented in `.env.example`.
- **POST** `/api/admin/pgvector-backfill` (admin session) — optional JSON `{ "expertId": "..." }` to scope; otherwise all experts with `mem9SpaceId`.

## Deploy checklist

1. Set **`DATABASE_URL`** to Postgres on Vercel.
2. Set **`HICLAW_POSTGRES_URL`** or **`DB9_DATABASE_URL`** to the **same** or a dedicated Postgres that holds HiClaw tables (`sessions`, etc.).
3. Run **Apply HiClaw schema** from **Admin → HiClaw DB** (`/admin/tidb`) or execute the DDL your team uses for that database.
4. Register **`https://<your-domain>/api/inngest`** in Inngest Cloud and set signing + event keys if using scheduled or event-driven functions.
5. Remove any **`mysql://`** URLs from secrets; they will break boot or HiClaw routes.

## Local development

Corporate proxy may block direct DB access; use Supabase pooler or skip DB-heavy routes. **`npx prisma generate`** works offline; schema push/migrate against remote DB should use the admin migrate route or Vercel.
