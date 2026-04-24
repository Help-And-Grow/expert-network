# Vercel Marketplace — Supabase (main Postgres)

Help & Grow’s **Prisma** layer expects a PostgreSQL `DATABASE_URL`. The [Vercel Marketplace Supabase integration](https://supabase.com/docs/guides/integrations/vercel-marketplace) syncs Supabase-managed projects into the Vercel project and injects names that differ slightly from this repo’s defaults.

## Production reference (this workspace)

| Field | Value |
|--------|--------|
| Supabase project (Vercel Storage) | `supabase-help-and-grow` |
| Compute | Nano |
| Supabase API URL | `https://xaigobdkahivuqbczljg.supabase.co` |

Treat connection strings and service keys as secrets; they live only in Vercel Environment Variables (or local gitignored pulls).

## Variables the integration typically sets

Per [Supabase — Vercel Marketplace](https://supabase.com/docs/guides/integrations/vercel-marketplace), synced names often include:

- `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, and related `POSTGRES_*` fragments (this app can use `POSTGRES_URL` as a fallback when `DATABASE_URL` / `POSTGRES_PRISMA_URL` are unset)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## How this repo maps them

[`prisma.config.ts`](../../prisma.config.ts) resolves the datasource URL for CLI / build in this order: `DIRECT_URL` → `POSTGRES_URL_NON_POOLING` → `DATABASE_URL` → `POSTGRES_PRISMA_URL`.

In [`src/lib/env.ts`](../../src/lib/env.ts) (validation) and [`src/lib/prisma.ts`](../../src/lib/prisma.ts) (runtime):

1. **`DATABASE_URL`** — If unset, **`POSTGRES_PRISMA_URL`** is used (pooled string suited to Prisma on serverless). You may still set `DATABASE_URL` explicitly in the Vercel UI to match your pooler preference.
2. **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — If unset, **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** is accepted as the browser-safe key name used by the integration.

Optional Supabase Storage / client features use `NEXT_PUBLIC_SUPABASE_URL` plus the anon/publishable key.

## Migrations on Vercel

This repo ships SQL in [`prisma/migrations/`](../../prisma/migrations/). On **Vercel** (`VERCEL=1`), **`npm install`’s `postinstall`** runs [`scripts/prisma-migrate-if-vercel.mjs`](../../scripts/prisma-migrate-if-vercel.mjs) after `prisma generate`, which executes **`prisma migrate deploy`** so a new empty Postgres gets the full schema. (Install often receives Marketplace DB env before the compile step; if migrate is skipped, confirm those variables are enabled for **Build** in the Vercel project.)

- **Pooled URLs:** [`withSupabasePoolerPrismaParams`](../../src/lib/postgres-connection-url.ts) appends `pgbouncer=true` when the host looks like Supabase’s transaction pooler (`*.pooler.supabase.com` or port `6543`), which Prisma needs for prepared-statement behavior. It also appends `uselibpqcompat=true` to Supabase URLs that use `sslmode=require`, matching libpq SSL semantics for the `pg` runtime driver and avoiding Prisma `P1011` / self-signed-certificate failures.

If `migrate deploy` fails with **“database schema is not empty”** (you already applied tables manually), either align the DB with migrations using Prisma’s [baselining](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining) workflow, or reset the empty branch DB and redeploy.

After deploy, **`GET /api/db-health`** returns `{ ok: true, db: "up" }` when Prisma can run `SELECT 1` (cannot live under `/api/health/db` because `/api/health` is already a route file). **`GET /api/v1/experts`** includes a **`prismaCode`** field on 500 responses when Prisma surfaces a known request error (for example `P2021` if a table is missing).

## Related docs

- [Postgres cutover runbook](../exec-plans/active/postgres-cutover-runbook.md) — `DATABASE_URL`, HiClaw URLs, migrations
- [Vercel environments (solo PM)](vercel-environments-solo-pm.md) — `vercel env pull`, Preview vs Production
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — database layer overview
