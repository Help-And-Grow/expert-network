# Supabase → Cloud SQL Migration Runbook

**Status**: Proposed (2026-05-03)
**Scope**: Move the Web + Telegram primary database from Supabase Postgres (AWS `ap-southeast-1`) to **Google Cloud SQL for PostgreSQL** (`asia-southeast1`). Vercel stays as the compute platform; only the DB endpoint changes.
**Out of scope**: Cloud Run / Cloud Storage migration (covered separately in `gcp-migration-runbook.md`); WeChat-CN and WeChat-Intl databases (those stay on TencentDB).

> Companion docs:
> - [`postgres-cutover-runbook.md`](postgres-cutover-runbook.md) — env-var resolution rules
> - [`gcp-migration-runbook.md`](gcp-migration-runbook.md) — Cloud Run deployment (different scenario)
> - [`docs/design-docs/architecture.md`](../../design-docs/architecture.md) §1 — multi-cloud topology

---

## 1. Why now

- **Compliance signal**: Architecture doc §1 lists *"Supabase Postgres in AWS ap-southeast-1 (→ Google Cloud DB future)"* — this is that future.
- **Operational simplification**: We already depend on Google Cloud for Vertex AI (Gemini, embeddings). Consolidating database + AI on one cloud reduces the secrets surface and cross-cloud egress.
- **Reliability**: Supabase free-tier instances auto-pause after 7 days idle, regularly disrupting CI smoke tests. Cloud SQL has no auto-pause.
- **Future migrations**: WeChat-Intl will eventually one-way-sync from the Web DB (architecture §1, *Phase 2*). Sourcing that sync from Cloud SQL is cleaner than Supabase's pooler.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **GCP service** | Cloud SQL for PostgreSQL | 1:1 Postgres replacement; supports pgvector. AlloyDB is overkill for our size. |
| **Region** | `asia-southeast1` (Singapore) | Same as Vercel `sin1`; sub-10ms intra-region latency. |
| **PostgreSQL version** | 16 | Matches Supabase. |
| **Tier** | `db-g1-small` (1 vCPU, 1.7 GB) for prod, `db-f1-micro` for dev | Generous for our workload; can be resized live. |
| **Storage** | 10 GB SSD with auto-grow | Plenty; Supabase data is < 100 MB today. |
| **Backups** | 7-day automated, point-in-time recovery on | Cheap insurance. |
| **HA** | Regional (zonal failover) for prod | One zone outage shouldn't surface to users. |
| **Connectivity from Vercel** | Public IP + SSL required + strong password + IP allowlist `0.0.0.0/0` | Vercel has rotating egress IPs; Cloud SQL Auth Proxy doesn't run as a sidecar. TLS-enforced public IP is the standard pattern for Vercel + Cloud SQL. |
| **Migration tool** | Manual `pg_dump` / `pg_restore` with a < 5 min write-quiesce window | DB is small (< 100 MB, ~14 tables); DMS is more setup than it saves. |
| **Cutover style** | Stop-the-world, single-window | Web traffic is tiny; minutes of downtime acceptable. WeChat traffic is unaffected (separate DB). |

## 3. Pre-flight checklist

Run before scheduling the cutover window:

- [ ] **Active Vercel deployments** are stable (no in-flight rollouts)
- [ ] **Recent Supabase backup** in case rollback is needed (automatic on free tier; manual export advisable)
- [ ] **All Prisma migrations applied** to Supabase: `npx prisma migrate status` shows no pending
- [ ] **No long-running write transactions** (booking checkouts, etc.) — easy at low-traffic hours
- [ ] **`gcloud` CLI installed + authenticated** (per [`docs/CLI_SETUP.md`](../../CLI_SETUP.md) §3)
- [ ] **GCP project with billing enabled** — note the `PROJECT_ID`
- [ ] **`postgresql-client` installed locally** for `pg_dump` + `pg_restore` (`brew install libpq && brew link --force libpq`)

## 4. Phase 1 — Provision Cloud SQL (one-time, ~15 min)

### 4.1 Create the instance

In the GCP console (or via `gcloud`):

```bash
PROJECT_ID="your-gcp-project"
INSTANCE="hg-postgres-prod"
DB_USER="hg_app"
DB_NAME="helpgrow"

# Generate a strong password and save it to your password manager
DB_PASS="$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)"
echo "Save this password: $DB_PASS"

# Create the instance — 1 vCPU / 1.7 GB / 10 GB SSD with auto-grow,
# regional HA, Singapore, PostgreSQL 16
gcloud sql instances create "$INSTANCE" \
  --project="$PROJECT_ID" \
  --database-version=POSTGRES_16 \
  --region=asia-southeast1 \
  --tier=db-g1-small \
  --availability-type=REGIONAL \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup-start-time=18:00 \           # 02:00 SGT
  --enable-point-in-time-recovery \
  --retained-backups-count=7 \
  --root-password="$DB_PASS" \
  --require-ssl \
  --authorized-networks=0.0.0.0/0       # tightened by SSL + strong password
```

> The `--authorized-networks=0.0.0.0/0` looks scary but is standard for Vercel deployments — Vercel's egress IPs rotate so we can't allowlist them. SSL enforcement + a 32-character password give us defence in depth. Tighten by deploying [Cloud SQL Auth Proxy on Vercel](https://cloud.google.com/sql/docs/postgres/connect-vercel) only if compliance requires it.

### 4.2 Create the application user + database

```bash
# Connect as postgres root (one-shot via gcloud sql connect)
gcloud sql connect "$INSTANCE" --user=postgres --project="$PROJECT_ID"

# In the psql prompt:
CREATE USER hg_app WITH PASSWORD '<the password from above>';
CREATE DATABASE helpgrow OWNER hg_app;
GRANT ALL PRIVILEGES ON DATABASE helpgrow TO hg_app;

\c helpgrow

-- Required extensions (matches what Supabase enabled)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

\q
```

### 4.3 Capture the connection strings

```bash
gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" \
  --format='value(ipAddresses[0].ipAddress)'
# e.g. 34.143.123.45
```

Two URL variants you'll need (replace `<PUBLIC_IP>` and `<DB_PASS>`):

```text
# Direct connection — Prisma Migrate, pg_dump/restore, all sync workflows
DATABASE_URL="postgresql://hg_app:<DB_PASS>@<PUBLIC_IP>:5432/helpgrow?sslmode=require"

# Same URL — no separate pooled URL (we don't need pgbouncer; Cloud SQL handles
# connection pooling natively, and Prisma's connection pool is sufficient
# for our workload).
```

Save the `DATABASE_URL` to your password manager — you'll set it on Vercel in §7.

## 5. Phase 2 — Apply schema to Cloud SQL (~5 min)

Run from your laptop with `gcloud` auth and the new `DATABASE_URL`:

```bash
cd ~/Downloads/expert-network

# 1. Confirm schema is current locally
npx prisma migrate status --schema prisma/schema.prisma

# 2. Apply ALL migrations to the empty Cloud SQL DB
DATABASE_URL="postgresql://hg_app:<DB_PASS>@<PUBLIC_IP>:5432/helpgrow?sslmode=require" \
  npx prisma migrate deploy --schema prisma/schema.prisma

# 3. Apply the raw-SQL extras (vector + HiClaw tables) by hitting the admin
#    endpoint AFTER the env var is set on Vercel — see §7 step 4.
```

Verify the schema landed:

```bash
gcloud sql connect hg-postgres-prod --user=hg_app --project="$PROJECT_ID" --database=helpgrow

\dt   -- should list all 14 Prisma tables: Account, Session, User, Expert, ...
\dx   -- should list pgvector + pgcrypto extensions
```

## 6. Phase 3 — Migrate the data (~5 min downtime window)

### 6.1 Quiesce Supabase writes

Easiest path for solo PM: put Vercel in **maintenance mode** for ~5 minutes.

Either approach works:
1. **Quick & dirty** — temporarily set Vercel password protection on production, blocking user traffic
2. **Cleaner** — set `MAINTENANCE_MODE=1` env var if there's middleware support (there isn't currently — adding it is overkill for one-shot)

For a small DB at off-peak hours, just **announce 5 min of downtime in your channels** and move on.

### 6.2 Dump from Supabase

From your laptop (already has the Supabase DB URL in `.env.local`):

```bash
# Set the source (Supabase) URL
SUPABASE_URL="<your existing Supabase DATABASE_URL>"

# Direct connection (NOT the pooler) — pg_dump needs session-mode access
# If your Supabase URL points at the pooler (port 6543), swap to port 5432
SUPABASE_DIRECT="${SUPABASE_URL//:6543\//:5432\/}"

# Dump everything — schema + data, with --no-owner / --no-privileges so it
# applies cleanly under a different DB user (hg_app on Cloud SQL)
pg_dump "$SUPABASE_DIRECT?sslmode=require" \
  --no-owner \
  --no-privileges \
  --no-comments \
  --format=custom \
  --file=/tmp/supabase-dump-$(date +%Y%m%d-%H%M).dump
```

Sanity-check the dump:

```bash
ls -lh /tmp/supabase-dump-*.dump   # expect a few MB
pg_restore --list /tmp/supabase-dump-*.dump | head -30   # tables visible
```

### 6.3 Restore to Cloud SQL

```bash
# data-only restore (schema is already applied via prisma migrate deploy)
TARGET_URL="postgresql://hg_app:<DB_PASS>@<PUBLIC_IP>:5432/helpgrow?sslmode=require"

pg_restore \
  --dbname="$TARGET_URL" \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --verbose \
  /tmp/supabase-dump-*.dump
```

`--data-only` because Prisma already created the tables. `--disable-triggers` so `_prisma_migrations` and other tracking tables don't fight us.

### 6.4 Verify row counts match

```bash
# Count rows in each table on both DBs and diff. Quick script:
for tbl in Account Session VerificationToken User Expert AvailableSlot Booking Review InvitationCode POMPCredential TokenLedger Membership MembershipLedger SystemConfig; do
  src=$(psql "$SUPABASE_DIRECT?sslmode=require" -tAc "SELECT count(*) FROM \"$tbl\";")
  dst=$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM \"$tbl\";")
  if [ "$src" = "$dst" ]; then
    echo "  ✓ $tbl: $src rows match"
  else
    echo "  ✖ $tbl: src=$src dst=$dst — MISMATCH"
  fi
done
```

If any mismatch: re-run the data-only restore for the missing tables, or investigate before proceeding to cutover.

## 7. Phase 4 — Cut Vercel over (~10 min)

### 7.1 Update DATABASE_URL on Vercel (production + preview)

```bash
cd ~/Downloads/expert-network

# Save the new URL to a temp env file
cat > /tmp/cloudsql.env <<EOF
DATABASE_URL=postgresql://hg_app:<DB_PASS>@<PUBLIC_IP>:5432/helpgrow?sslmode=require
EOF

# Apply to production via the existing helper script
npm run vercel:env:apply -- production /tmp/cloudsql.env

# Repeat for preview if you want preview deploys to use the same DB
npm run vercel:env:apply -- preview /tmp/cloudsql.env

# Wipe the temp file
rm /tmp/cloudsql.env
```

> If you previously had `POSTGRES_PRISMA_URL` set (from the Vercel Marketplace Supabase integration), **remove it explicitly** — `src/lib/env.ts` prefers `DATABASE_URL` but the marketplace alias mapping kicks in only when DATABASE_URL is unset. Belt-and-braces:
>
> ```bash
> vercel env rm POSTGRES_PRISMA_URL production
> vercel env rm POSTGRES_URL production
> vercel env rm POSTGRES_PRISMA_URL preview
> vercel env rm POSTGRES_URL preview
> ```

### 7.2 Trigger a redeploy

```bash
# Either via the Vercel dashboard ("Redeploy" on the latest production deploy),
# OR via CLI:
vercel deploy --prod
```

Vercel's `postinstall` step runs `prisma generate && prisma migrate deploy` on build — but the migrations already ran in Phase 2. The deploy will be a no-op for migrations and just pick up the new DATABASE_URL.

### 7.3 Apply admin-route extras (vector + HiClaw tables)

These tables are created by raw SQL through `/api/admin/migrate` (not via Prisma — they predate Prisma's vector support). Hit the endpoint once after deploy:

```bash
# Sign in as admin (or use a session cookie), then:
curl -X POST https://expert-network.vercel.app/api/admin/migrate \
  -H "Cookie: <your-admin-session-cookie>"
```

Expected response: a list of executed statements + `{ ok: true }`. The `expert_memory_embeddings` table (and the `expert_profile_embeddings` table once Codex's Phase 1 lands) get created here.

## 8. Phase 5 — Verify (~10 min)

### 8.1 Smoke-test the live site

- [ ] **Sign in** with Google — confirms `Account` + `Session` tables work
- [ ] **Browse experts** on `/discover` — confirms `Expert`, `User`, `Review` tables work
- [ ] **Open a booking** flow up to the payment step — confirms `Booking`, `AvailableSlot` work
- [ ] **Hit `/api/health/origin`** — confirms env + region detection
- [ ] **Hit `/api/db-health`** if it exists — confirms Prisma can reach Cloud SQL

### 8.2 Watch for errors

For 30 min after cutover:

- **Vercel deployment logs** — connection refused / timeout would surface here
- **Sentry / error tracking** if configured
- **CI playwright-smoke** runs after the next push will validate the UI flow

### 8.3 Re-run migration verification

```bash
# Now that traffic is live, row counts should still match (or the new DB
# can have MORE rows for live tables like Session, Booking) — anything
# else mismatching is a bug.
for tbl in User Expert Booking; do
  dst=$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM \"$tbl\";")
  echo "  $tbl: $dst rows on Cloud SQL"
done
```

## 9. Rollback

If anything goes wrong in Phase 4 or 5, **revert the DATABASE_URL on Vercel** and redeploy. Supabase is still alive — no data has been deleted there.

```bash
cat > /tmp/rollback.env <<EOF
DATABASE_URL=<old Supabase URL>
EOF
npm run vercel:env:apply -- production /tmp/rollback.env
rm /tmp/rollback.env
vercel deploy --prod
```

Until you've verified Cloud SQL for ≥ 7 days, keep Supabase paid up and accessible. Don't decommission early.

## 10. Phase 6 — Decommission Supabase (after 7-day grace period)

Once you're confident:

1. **Final dump** from Supabase as cold archive: `pg_dump > supabase-final-$(date +%F).sql.gz`. Store in a private GCS bucket or your password manager.
2. **Pause / delete** the Supabase project in their dashboard.
3. **Remove Supabase-specific code** in a follow-up PR:
   - `src/lib/postgres-connection-url.ts` `withSupabasePoolerPrismaParams` — keep as a no-op for non-Supabase URLs (it already is); or delete entirely
   - `src/lib/env.ts` `withVercelSupabaseMarketplaceAliases` — keep until the legacy `POSTGRES_PRISMA_URL` env var is purged across all Vercel environments
4. **Update docs**:
   - `docs/design-docs/architecture.md` §1 — change "Supabase Postgres in AWS `ap-southeast-1` (→ Google Cloud DB future)" to "Cloud SQL for PostgreSQL in `asia-southeast1`"
   - `docs/ENV.md` — drop the Supabase Marketplace block

## 11. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Vercel egress IP can't connect to Cloud SQL after cutover | SSL + `0.0.0.0/0` allowlist removes any IP-based block. Verified by hitting `/api/health/origin` post-deploy. |
| Prisma's connection pool exhausts on Cloud SQL | Default pool is 10. Cloud SQL `db-g1-small` allows 50 connections. We're well within budget. Alert at 30+ connections. |
| pgvector extension version drift between Supabase and Cloud SQL | Both ship pgvector 0.5+. Vector dimensions (1536) and index types (`ivfflat`) work identically. Verified by §5 step 2. |
| Long-running booking checkouts during cutover | Window is ~5 min. Schedule for 02:00 SGT (lowest traffic). |
| Auth.js sessions invalidate after cutover | Sessions are in the `Session` table — they migrate with the data. Users stay logged in unless their session token is rotated. |
| OAuth refresh tokens (Google) become stale | Stored in `Account.refresh_token` — migrates with the data. Standard OAuth refresh flow handles rotation. |
| WeChat-Intl one-way sync (architecture §1 *Phase 2*) breaks | Currently not implemented (only Phase 1 = manual `pg_dump`/`pg_restore`). Will need to be re-pointed at Cloud SQL when implemented. Tracking via [`docs/exec-plans/active/tencent-cloud-rollout.md`](tencent-cloud-rollout.md). |

## 12. What this runbook does NOT cover

- **Cloud Run migration**: covered in [`gcp-migration-runbook.md`](gcp-migration-runbook.md). This runbook keeps Vercel as the compute platform.
- **Cloud Storage migration**: not in scope. Vercel Blob continues to serve Web stack uploads; Tencent COS continues to serve WeChat stack uploads.
- **Tencent Cloud DBs**: WeChat-CN and WeChat-Intl databases are unaffected. They live on TencentDB and stay there.
- **HiClaw sidecar service**: if `HICLAW_POSTGRES_URL` is set separately on Vercel, it stays on whatever DB it points at. To migrate it, follow the same pattern as this runbook with `HICLAW_POSTGRES_URL` replacing `DATABASE_URL`.

## 13. Schedule

Suggested cutover window:

| When | Action |
|---|---|
| **T − 1 day** | Run §3 pre-flight checklist + §4 (provision Cloud SQL) |
| **T − 1 hour** | Run §5 (apply schema to Cloud SQL) — verify it's empty + ready |
| **T = 0** | Announce maintenance, run §6 (data migration) — ~5 min |
| **T + 5 min** | Run §7 (Vercel cutover + admin migrate) |
| **T + 15 min** | Run §8 (verify) — sign-in + booking flow |
| **T + 30 min** | All clear, end maintenance |
| **T + 7 days** | Run §10 (decommission Supabase) |

Total time investment: ~1 hour active work, spread across two sessions.

---

## Appendix — Useful one-liners

**Connect to Cloud SQL via gcloud (no IP whitelist friction):**
```bash
gcloud sql connect hg-postgres-prod --user=hg_app --project="$PROJECT_ID" --database=helpgrow
```

**Check the latest backup status:**
```bash
gcloud sql backups list --instance=hg-postgres-prod --project="$PROJECT_ID" | head -5
```

**Resize the instance live (no downtime):**
```bash
gcloud sql instances patch hg-postgres-prod --tier=db-custom-2-4096 --project="$PROJECT_ID"
```

**Read Cloud SQL slow query log:**
```bash
gcloud sql operations list --instance=hg-postgres-prod --project="$PROJECT_ID"
gcloud logging read 'resource.type="cloudsql_database" AND severity>=WARNING' --limit=20
```
