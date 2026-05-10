# Web/Telegram DB Cutover: Supabase to Cloud SQL  *(archived)*

**Status**: ✅ Complete — cut over 2026-05-03
**Archived**: 2026-05-10 (rollback window expired; Supabase project scheduled for deletion)
**Scope**: Moved the Web and Telegram primary Postgres database from Supabase to Google Cloud SQL. Vercel remains the Web/Telegram compute platform. WeChat databases remain on Tencent-side Postgres.

## Final State

| Area | Final state |
|---|---|
| Web/Telegram compute | Vercel Functions, `sin1` |
| Web/Telegram database | **Google Cloud SQL** — instance `hg-postgres-prod`, project `expert-network-489508`, region `asia-southeast1`, db `helpgrow`, user `hg_app` |
| Cutover date | 2026-05-03 |
| Vercel env | `DB_PROVIDER=cloudsql`, `DATABASE_URL` points at Cloud SQL (encrypted). All `POSTGRES_*` / `SUPABASE_*` Marketplace aliases removed. |
| Live verification | `GET /api/db-health` returns `{"ok":true,"db":"up"}` |
| Rollback window | Expired 2026-05-10. Supabase project `xaigobdkahivuqbczljg` can be deleted to stop billing. |

> The historical migration plan / runbook commands below are kept for record only.

## Safe Verification Commands

These commands should not print database passwords:

```bash
gcloud auth login
gcloud config set project expert-network-489508

gcloud sql instances describe hg-postgres-prod \
  --format='table(name,region,databaseVersion,state,settings.ipConfiguration.sslMode)'

npx vercel env ls production --scope helpandgrow \
  | rg 'DATABASE_URL|POSTGRES|SUPABASE'

curl https://expert-network.vercel.app/api/db-health
curl "https://expert-network.vercel.app/api/v1/experts?limit=1"
```

Do not paste or commit full database URLs. Store them in a password manager or a local chmod-600 file during migration.

## What This Migration Is Not

- It is not a Cloud Run migration. Web/Telegram stay on Vercel for this phase.
- It is not a WeChat database migration. WeChat International and future WeChat CN use Tencent-side databases.
- It is not a code rewrite. Prisma already supports any PostgreSQL URL through `DATABASE_URL`.

## Target Shape

```text
Web / Telegram
  -> Vercel Functions in sin1
  -> Cloud SQL for PostgreSQL in asia-southeast1

WeChat International
  -> Tencent CloudBase / SCF
  -> Tencent-side Postgres synchronized from the global primary DB

WeChat CN
  -> Future separate Tencent CN stack
  -> Separate TencentDB CN
```

## Definition Of Done

The migration is complete only when all of these are true:

1. Cloud SQL PostgreSQL instance exists in the intended GCP project.
2. `helpgrow` database and app user exist.
3. Required extensions are enabled: `pgcrypto`, `vector`.
4. `npx prisma migrate deploy` has run against Cloud SQL.
5. Supabase data has been dumped and restored into Cloud SQL.
6. Row counts match for core tables.
7. Vercel Production `DATABASE_URL` points to Cloud SQL.
8. Vercel Preview/E2E DB settings are intentionally updated or documented.
9. A production redeploy is complete.
10. Live checks pass:
    - `GET /api/db-health`
    - `GET /api/v1/experts?limit=1`
    - Web sign-in
    - Telegram auth / matching flow
11. Supabase remains available for at least seven days as rollback.

## Recommended Cutover Plan

### 1. Provision Cloud SQL

Use Google Cloud SQL for PostgreSQL in Singapore:

```bash
PROJECT_ID="expert-network-489508"
INSTANCE="hg-postgres-prod"
REGION="asia-southeast1"
DB_NAME="helpgrow"
DB_USER="hg_app"

gcloud sql instances create "$INSTANCE" \
  --project="$PROJECT_ID" \
  --database-version=POSTGRES_16 \
  --region="$REGION" \
  --tier=db-g1-small \
  --availability-type=ZONAL \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup-start-time=18:00 \
  --enable-point-in-time-recovery \
  --require-ssl
```

For a first user-test cutover, `ZONAL` is enough and cheaper. Move to `REGIONAL` HA after usage justifies it.

### 2. Create Database, User, Extensions

```sql
CREATE USER hg_app WITH PASSWORD '<strong-password>';
CREATE DATABASE helpgrow OWNER hg_app;
GRANT ALL PRIVILEGES ON DATABASE helpgrow TO hg_app;

\c helpgrow
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3. Apply Prisma Migrations

```bash
DATABASE_URL="postgresql://hg_app:<password>@<cloud-sql-public-ip>:5432/helpgrow?sslmode=require" \
  npx prisma migrate deploy --schema prisma/schema.prisma
```

### 4. Copy Data From Supabase

Use a short maintenance window for Web/Telegram writes.

```bash
SUPABASE_DIRECT_URL="<supabase direct postgres URL, not transaction pooler>"
CLOUD_SQL_URL="postgresql://hg_app:<password>@<cloud-sql-public-ip>:5432/helpgrow?sslmode=require"

pg_dump "$SUPABASE_DIRECT_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=/tmp/help-grow-supabase.dump

pg_restore \
  --dbname="$CLOUD_SQL_URL" \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  /tmp/help-grow-supabase.dump
```

### 5. Verify Row Counts

At minimum compare:

```text
User
Expert
AvailableSlot
Booking
Review
InvitationCode
SystemConfig
Membership
MembershipLedger
TokenLedger
POMPCredential
```

### 6. Cut Vercel Over

Update Vercel Production:

```bash
vercel env rm DATABASE_URL production
vercel env add DATABASE_URL production
```

Use the Cloud SQL URL:

```text
postgresql://hg_app:<password>@<cloud-sql-public-ip>:5432/helpgrow?sslmode=require
```

Then redeploy production and verify:

```bash
curl https://expert-network.vercel.app/api/db-health
curl "https://expert-network.vercel.app/api/v1/experts?limit=1"
```

## Rollback

Keep the old Supabase project and connection string for at least seven days.

If cutover fails:

1. Restore Vercel `DATABASE_URL` to the previous Supabase URL.
2. Redeploy production.
3. Verify `/api/db-health` and core auth flows.
4. Keep the failed Cloud SQL instance stopped or delete it after exporting any useful diagnostics.

## Follow-Up After Success

- Update `ARCHITECTURE.md`, `docs/ENV.md`, and `docs/design-docs/architecture.md` from "treat as Supabase until cutover proof" to "Cloud SQL current".
- Update WeChat International sync source from Supabase to Cloud SQL.
- Remove or archive Supabase Marketplace-specific docs only after the seven-day rollback period.
- Rotate any DB credentials used during the migration.
