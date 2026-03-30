# DB9 (serverless Postgres) — integration with Help & Grow

**Date:** 2026-03  
**Status:** Draft — operational guide  
**Source of truth (CLI & API):** [https://db9.ai/skill.md](https://db9.ai/skill.md)

## PM guide: get the “DB9 URL” (no jargon)

**What you are creating:** one secret text line that looks like  
`postgresql://something:something@pg.db9.io:5433/postgres`.  
The app stores it in Vercel as **`DB9_DATABASE_URL`**. It is a **password to the database** — treat it like a bank PIN (never email it, never paste in Slack; use Vercel’s UI or a password manager).

### Path A — you only use the browser (fastest if a developer helps once)

1. Ask a developer on the project to run **Path B** below on their Mac, then to **paste the connection string into Vercel for you** (or send it to you only through a secure channel so *you* can paste it).
2. In [Vercel](https://vercel.com) → your **expert-network** project → **Settings** → **Environment Variables**:
   - **Name:** `DB9_DATABASE_URL`
   - **Value:** paste the full `postgresql://...` string
   - **Environment:** check **Production** (and Preview/Development only if you need HiClaw there too)
   - Save, then **Redeploy** the latest production deployment so the new variable is picked up.
3. Ask the same developer to run the **schema** step in the checklist below (`db9 db sql ... -f hiclaw/schema-postgres.sql`) and to confirm **`/admin/tidb`** loads on production.
4. When that works, they run `npm run vercel:env:remove-tidb-legacy` to drop the old `TIDB_DATABASE_URL` name.

### Path B — you are comfortable copying commands into Terminal (Mac)

1. Open **Terminal** (Spotlight → type “Terminal”).
2. Install the DB9 tool (one line from [DB9’s docs](https://db9.ai/skill.md)). If the installer wants `sudo` for `/usr/local/bin`, use a user-writable directory instead:
   ```bash
   export DB9_INSTALL_DIR="$HOME/.local/bin"
   mkdir -p "$DB9_INSTALL_DIR"
   curl -fsSL https://db9.ai/install | sh
   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```
3. If `db9 create` fails with **Connection failed** (common with corporate TLS / Zscaler) but you still need a database, use this repo’s **HTTP API provisioner** (Node uses the same network stack as `curl` and often works where the `db9` binary does not):
   ```bash
   cd /path/to/expert-network
   npm run db9:provision
   ```
   With a normal DB9 login token (recommended for production ownership):
   ```bash
   DB9_API_KEY="$(db9 token show)" npm run db9:provision
   ```
   That creates **`expert-network-hiclaw`** (if missing), applies `hiclaw/schema-postgres.sql`, sets **`DB9_DATABASE_URL`** on Vercel Production, and removes legacy **`TIDB_DATABASE_URL`** when safe.

### Alternative — DB9 CLI only (no `npm run db9:provision`)

1. After the CLI is installed and on your `PATH`, sign in or create a database (pick one):
   - **Signed-in account:** `db9 login` (browser opens).
   - **Quick try:** `db9 create --name expert-network-hiclaw` can create an anonymous trial DB (see [skill.md](https://db9.ai/skill.md) for limits); later run `db9 claim` to attach it to your real account.
2. After create, Terminal prints **Connection String:** — copy that **entire** line (starts with `postgresql://`).
3. If you already have a DB and need the string again: `db9 db connect <database-name>` (name is shown when you run `db9 list`). Official reference: [db9.ai/skill.md](https://db9.ai/skill.md) (“Get connection string”).
4. Put that string in Vercel as **`DB9_DATABASE_URL`** (Path A, step 2).
5. Still in Terminal, from your **project folder** (the `expert-network` repo), apply our tables:
   ```bash
   db9 db sql expert-network-hiclaw -f hiclaw/schema-postgres.sql
   ```
   (Replace `expert-network-hiclaw` with the **name** you used in `db9 create`.)

If any step errors, screenshot the message and ask a developer — often it is “not logged in” or “wrong folder.”

---

## What DB9 is

[DB9](https://db9.ai) is **serverless PostgreSQL** aimed at AI/agent workloads: branches, JSONB, optional vector search, HTTP extension, cron (`pg_cron`), etc. You get a normal **`postgresql://`** connection string (e.g. host **`pg.db9.io`**, port **5433**) for `psql`, Prisma, or `pg`.

**Security:** use Bearer tokens only against **`https://api.db9.ai`** (see skill.md).

## How this repo uses “DB9” today

| Layer | Mechanism |
|-------|-----------|
| **Next.js (Vercel)** | TCP Postgres via `pg` in [`src/lib/tidb.ts`](../../src/lib/tidb.ts): reads **`DB9_DATABASE_URL`**, then **`HICLAW_POSTGRES_URL`**, then legacy **`TIDB_DATABASE_URL`** (only if `postgres://`). Used for HiClaw **`sessions`**, on-chain sync ([`/api/webhook/onchain`](../../src/app/api/webhook/onchain/route.ts)), reputation queries. |
| **HiClaw Node service** | [`hiclaw/service` store](../../hiclaw/README.md): optional **HTTP SQL** (`DB9_HTTP_SQL_URL` + token) **or** TCP **`DB9_DATABASE_URL` / `HICLAW_POSTGRES_URL`**. |

There is **no separate “DB9 SDK”** inside Next.js — you point **`DB9_DATABASE_URL`** (or **`HICLAW_POSTGRES_URL`**) at the **same Postgres** where HiClaw tables live (`schema-postgres.sql`).

## Integration checklist

1. **Create / choose a DB9 database** — either:
   - **Script (Vercel + schema + legacy cleanup):** `npm run db9:provision` (optional `DB9_API_KEY` from `db9 token show` after login), or
   - **CLI** (per [skill.md](https://db9.ai/skill.md)):
     ```bash
     curl -fsSL https://db9.ai/install | sh
     db9 login
     db9 create --name expert-network-hiclaw   # or db9 use <existing>
     ```
     Copy the **Connection String** (`postgresql://...@pg.db9.io:5433/postgres`).

2. **Apply HiClaw schema** on that database (same as any Postgres), if you did not use `db9:provision`:
   ```bash
   db9 db sql <db-name> -f hiclaw/schema-postgres.sql
   ```
   (Or `psql` with the same URL.)

3. **Vercel — set the new URL** (before removing legacy `TIDB_DATABASE_URL`):
   ```bash
   printf '%s' 'postgresql://...' | vercel env add DB9_DATABASE_URL production --force
   ```
   Repeat for `preview` / `development` if those envs need HiClaw access.

4. **Remove legacy `TIDB_DATABASE_URL`** only after **`DB9_DATABASE_URL`** or **`HICLAW_POSTGRES_URL`** is set and verified (admin **HiClaw DB** `/admin/tidb`, on-chain webhook test). Safe helper: `npm run vercel:env:remove-tidb-legacy` (refuses to run until a replacement var exists on production).

5. **HiClaw ECS / workers** — set the **same** `DB9_DATABASE_URL` or `HICLAW_POSTGRES_URL` (or HTTP SQL if you use that path in `store.js`).

## Optional: HTTP SQL (stateless workers)

If HiClaw workers cannot hold a long-lived TCP pool, configure **`DB9_HTTP_SQL_URL`** + **`DB9_HTTP_SQL_TOKEN`** per [`hiclaw/README.md`](../../hiclaw/README.md). That is **independent** of whether the DB is hosted on DB9 or elsewhere; the API shape must match what `store.js` expects.

## When the URL is right but you see “password authentication failed for user …”

The host (e.g. `pg.db9.io`) is correct, but **Postgres rejected the password** in `DB9_DATABASE_URL`. Common causes:

1. **Rotated or reset password** on the DB9 side — the string in Vercel is old.
2. **Anonymous / trial DB** created elsewhere — the password you copied no longer matches.
3. **Wrong paste** — truncated URL or wrong special-character encoding.

**Fix:** Mint a **current** connection string from DB9 and overwrite Vercel:

1. **Refresh URL from DB9 (same password):** on any machine with Node + Vercel CLI linked to this project:
   ```bash
   DB9_API_KEY="$(db9 token show)" npm run db9:provision
   ```
   (`db9 token show` needs `db9 login` first — use another computer if your laptop blocks the CLI.)

2. **Force a new admin password** (if refresh still fails):
   ```bash
   DB9_API_KEY="$(db9 token show)" npm run db9:reset-password-vercel
   ```
   This calls DB9’s reset-password API, then updates `DB9_DATABASE_URL` on Vercel Production. If you get **410 Gone**, your project may be passwordless — use `db9 db connect <db>` for a short-lived DSN per [db9.ai/skill.md](https://db9.ai/skill.md).

3. **Manual:** Vercel → Environment Variables → edit `DB9_DATABASE_URL` with the full `postgresql://…` string from DB9.

Then **Redeploy** production so functions pick up the new env value.

### Admin UI (no CLI on your laptop)

On **`/admin/tidb`**, the **DB9 API helper** card lets an **ADMIN** user paste a DB9 Bearer token (`db9 token show` from any machine where login works). This deployment calls **`https://api.db9.ai`** and shows a **`postgresql://`** URL to copy into Vercel. The token is **not** stored. Endpoints: `POST /api/admin/tidb/db9` with `action`: `get_connection_string` or `reset_admin_password`.

### Systematic debug (admin GET)

`GET /api/admin/tidb` returns **`connectionProbe`**: parsed **host**, **port**, **database**, **user**, password **metadata** only (length, JWT-like / percent-encoded hints), and suggested **checks**. On connection failure it also runs **`connectionExperiments`**: **normalized** (app default) vs **raw env** URL when they differ — if raw succeeds and normalized fails, suspect userinfo normalization; if both fail with `28P01`, refresh the DSN on Vercel / DB9.

## Env var naming

| Variable | Use |
|----------|-----|
| **`DB9_DATABASE_URL`** | Preferred name when the database is on DB9 (or any Postgres URL for HiClaw). |
| **`HICLAW_POSTGRES_URL`** | Same priority as above; use if you prefer “HiClaw” in the name. |
| **`TIDB_DATABASE_URL`** | Legacy; **remove** once Postgres HiClaw URL is on **`DB9_*`** / **`HICLAW_*`**. |

## References

- [db9.ai/skill.md](https://db9.ai/skill.md) — CLI, auth, `db9 db sql`, connect strings  
- [hiclaw-agent-harness-db9.md](hiclaw-agent-harness-db9.md) — architecture  
- [postgres-cutover-runbook.md](../exec-plans/active/postgres-cutover-runbook.md) — cutover steps  
