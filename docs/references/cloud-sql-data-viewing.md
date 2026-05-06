# Viewing Cloud SQL data — `hg-postgres-prod`

Production Postgres lives on **Google Cloud SQL** in `asia-southeast1`:

| Field | Value |
|---|---|
| Project | `expert-network-489508` |
| Instance | `hg-postgres-prod` |
| Public IP | `34.126.117.155` |
| Database | `helpgrow` |
| App user | `hg_app` (read/write, used by Vercel) |
| Admin user | `postgres` (root — only for ALTER, GRANT, etc.) |
| TLS | required (`sslmode=require`); no client cert needed |

**No `psql` server-management UI ships with Cloud SQL** the way Supabase Studio does. There are four practical ways to look at the data — pick the one that matches what you're trying to do.

---

## Option 1 — Cloud SQL Studio (web GUI, no install) ⭐ recommended for browsing

Google's built-in browser GUI. Closest replacement for Supabase Studio.

1. https://console.cloud.google.com/sql/instances → click `hg-postgres-prod`
2. Left sidebar → **Cloud SQL Studio** (a beaker icon)
3. **Sign in**:
   - Database: `helpgrow`
   - User: `postgres` (or `hg_app`)
   - Password: from your password manager
4. Click **Authenticate**

You get tabs for:
- **Editor** — paste/run SQL, see results in a paginated table
- **Explorer** — left tree of tables; click a table → row preview + column types
- **Saved queries** — bookmark common queries
- Read-only mode toggle if you only want SELECTs

**Best for:** ad-hoc browsing, "what's in this table?", quick row counts, joining two tables to answer a question.

---

## Option 2 — TablePlus / DBeaver / pgAdmin (native desktop GUI)

Real desktop app, more keyboard-friendly than the web Studio. Connection settings:

| Field | Value |
|---|---|
| Host | `34.126.117.155` |
| Port | `5432` |
| Database | `helpgrow` |
| User | `hg_app` (or `postgres` for admin tasks) |
| Password | from your password manager |
| TLS / SSL | **Required** — pick "Require" / "Verify CA" / "Allow" depending on the client (no client cert needed) |

For TablePlus specifically: in the connection dialog set "SSL Mode" to **Require**, leave the cert fields empty.

**Best for:** daily debugging, multi-pane queries, schema diff, importing CSVs.

---

## Option 3 — `psql` from your terminal

Quickest for one-off queries you can write in shell. Two flavours:

**a) via `gcloud sql connect`** (auto-handles auth proxy + IP whitelist):
```bash
gcloud sql connect hg-postgres-prod \
  --user=hg_app \
  --database=helpgrow \
  --project=expert-network-489508
# password prompt, then you're in psql
```

**b) directly over public IP + TLS** (when gcloud is unavailable):
```bash
PGPASSWORD='<your hg_app password>' psql \
  "host=34.126.117.155 port=5432 dbname=helpgrow user=hg_app sslmode=require"
```

Once at the `helpgrow=>` prompt:

```sql
\dt                                    -- list all tables
\d "Expert"                            -- describe a single table (note quoted Pascal-case names from Prisma)
SELECT count(*) FROM "User";           -- count users
SELECT count(*) FROM "Booking" WHERE status = 'CONFIRMED';
\q                                     -- exit
```

**Best for:** scripted checks, copy-pasting queries from this repo's docs, quick ad-hoc joins.

---

## Option 4 — Read-only psql via Prisma Studio (schema-aware UI)

Prisma Studio reads the same Prisma schema this app uses, so you see the *intended* shape (relations, enums) rather than raw Postgres. Only safe for non-destructive browsing.

```bash
cd ~/Downloads/expert-network
DATABASE_URL='postgresql://hg_app:<password>@34.126.117.155:5432/helpgrow?sslmode=require' \
  npx prisma studio
# opens http://localhost:5555 in your browser
```

Click any table on the left sidebar. Click a row to see relations expanded.

**Best for:** following expert → bookings → reviews relations visually; verifying a schema change you just deployed.

---

## Common queries

```sql
-- How many published experts?
SELECT count(*) FROM "Expert" WHERE "isPublished" = true;

-- Recent sign-ins (last 24h)
SELECT count(*) FROM "Session"
WHERE "expires" > now() - interval '30 days'
  AND "expires" - interval '30 days' > now() - interval '24 hours';

-- Bookings by status
SELECT status, count(*) FROM "Booking" GROUP BY status ORDER BY count(*) DESC;

-- New users created in the last week
SELECT count(*) FROM "User" WHERE "createdAt" > now() - interval '7 days';

-- Storage used (rough — counts row sizes, not indexes/TOAST)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) DESC
LIMIT 10;

-- Active connections (who's hitting the DB right now)
SELECT client_addr, application_name, state, count(*)
FROM pg_stat_activity
WHERE datname = 'helpgrow' AND usename = 'hg_app'
GROUP BY client_addr, application_name, state
ORDER BY count DESC;
```

Vercel egress IPs in `pg_stat_activity.client_addr` are typically `13.x.x.x` / `47.x.x.x` / `18.x.x.x` (AWS Singapore = Vercel `sin1`). Your laptop will appear as your home/office public IP.

---

## Backups & point-in-time recovery

Already configured (see [`supabase-to-cloudsql-migration.md`](../exec-plans/active/supabase-to-cloudsql-migration.md) §2):

- **Automated backups** every day at 18:00 UTC (02:00 SGT), retained 7 days
- **PITR** is on — you can restore to any point in the last 7 days

To browse / restore a backup:

```bash
gcloud sql backups list --instance=hg-postgres-prod \
  --project=expert-network-489508
# returns rows like:
#   id    type    status  start_time
#   1234  AUTOMATED  RUNNABLE  2026-05-04T18:00:00...

# Restore from a specific backup ID into a NEW instance (safest workflow):
gcloud sql backups restore <BACKUP_ID> \
  --restore-instance=hg-postgres-prod-recovery \
  --backup-instance=hg-postgres-prod \
  --project=expert-network-489508
```

For point-in-time recovery to a specific timestamp use the **Restore** button in the Cloud SQL console UI — easier than the CLI's `gcloud sql instances clone` flow.

---

## Permissions: when to use which user

| User | Use for | Avoid |
|---|---|---|
| `hg_app` (default) | Daily browsing, debugging, app-side reads | DDL changes, GRANTs |
| `postgres` | One-off DDL, GRANT, EXTENSION CREATE, instance-level admin | Routine queries — `pg_stat_activity` will be polluted with admin sessions |

Both passwords are in your password manager. **Never commit them to git** or paste into chat threads — rotate immediately if exposed (`gcloud sql users set-password postgres --instance=hg-postgres-prod --password=<NEW>`).

---

## Adding a personal "viewer" account (recommended for shared access)

If you ever invite a teammate to look but not write:

```bash
# In psql as postgres:
CREATE USER viewer WITH PASSWORD '<strong password>';
GRANT CONNECT ON DATABASE helpgrow TO viewer;
GRANT USAGE ON SCHEMA public TO viewer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO viewer;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO viewer;
```

That viewer can then sign into Cloud SQL Studio or any of the GUI clients above with read-only permissions.
