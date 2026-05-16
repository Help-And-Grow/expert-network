# GCP migration runbook — Cloud Run + Cloud SQL

**Status**: Reference implementation (optional)
**Scope**: Running the Web/Telegram Next.js app on Google Cloud Run, backed by the existing Cloud SQL Postgres instance. This does not change the database cutover record.

The default production hosting remains **Vercel** unless explicitly switching. The database already runs on Cloud SQL since 2026-05-03:

- [Postgres operations runbook](postgres-cutover-runbook.md)
- [Archived migration record](../archive/supabase-to-cloudsql-migration.md)
- [Cloud SQL browsing guide](../../references/cloud-sql-data-viewing.md)

## Target shape

```text
Web / Telegram (Next.js standalone)
  -> Cloud Run (region: asia-southeast1)
  -> Secret Manager for runtime secrets
  -> Cloud SQL for PostgreSQL (via Cloud SQL connector / unix socket)
```

## Prerequisites

- Project: `expert-network-489508`
- Region: `asia-southeast1`
- Cloud SQL instance: `hg-postgres-prod`
- Connection name: `expert-network-489508:asia-southeast1:hg-postgres-prod`
- Billing must be enabled (Cloud Run revisions cannot start when billing is disabled).

Enable APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  --project expert-network-489508
```

## Runtime service account (least privilege)

Create a dedicated runtime SA (example name: `expert-network-run`), then grant only what Cloud Run needs at runtime:

- Cloud SQL connector: `roles/cloudsql.client`
- Secret access: `roles/secretmanager.secretAccessor` (prefer per-secret IAM bindings)

If Cloud Run uses `--service-account`, ensure that SA has the above roles.

## Secrets (Secret Manager)

Store secrets as Secret Manager versions and mount them into Cloud Run as env vars.

Common secrets used by the app:

- `DATABASE_URL` (Cloud SQL unix socket form, see below)
- `AUTH_SECRET` (or `NEXTAUTH_SECRET`)
- `GOOGLE_CLIENT_SECRET` (if enabling Google OAuth)
- `EMAIL_SERVER_PASSWORD` (SMTP app password, if enabling magic link)

Never commit or paste secret values into git.

## Cloud SQL connection string (Cloud Run)

For Cloud Run, prefer Cloud SQL connector via unix socket:

```text
postgresql://hg_app:<PASSWORD>@localhost:5432/helpgrow?host=/cloudsql/expert-network-489508:asia-southeast1:hg-postgres-prod
```

Notes:

- `host=/cloudsql/...` is the key part; Cloud Run injects the unix socket when you attach the instance.
- You do not need `sslmode=require` for unix sockets.
- The Cloud SQL instance must be `RUNNABLE` or the connector can fail fetching ephemeral certs.

## Build + deploy (Cloud Build → Cloud Run)

This repo ships a Dockerfile at the repo root that builds Next.js standalone output.

1) Build and push an image:

```bash
gcloud builds submit \
  --project expert-network-489508 \
  --tag asia-southeast1-docker.pkg.dev/expert-network-489508/expert-network/expert-network:$(date +%Y%m%d-%H%M%S)
```

2) Deploy Cloud Run with Cloud SQL + secrets:

```bash
gcloud run deploy expert-network \
  --project expert-network-489508 \
  --region asia-southeast1 \
  --image asia-southeast1-docker.pkg.dev/expert-network-489508/expert-network/expert-network:TAG \
  --allow-unauthenticated \
  --service-account expert-network-run@expert-network-489508.iam.gserviceaccount.com \
  --add-cloudsql-instances expert-network-489508:asia-southeast1:hg-postgres-prod \
  --set-env-vars NODE_ENV=production,DB_PROVIDER=cloudsql \
  --set-secrets DATABASE_URL=expert-network-database-url:latest,AUTH_SECRET=expert-network-auth-secret:latest \
  --set-env-vars NEXTAUTH_URL=https://YOUR_CANONICAL_HOST
```

Replace `TAG` with the image tag and `YOUR_CANONICAL_HOST` with the chosen public origin (custom domain or a single Cloud Run URL).

## Auth.js host consistency (Google OAuth + PKCE)

Cloud Run exposes multiple hostnames for the same service. Auth.js PKCE is host-bound (cookies), so start and callback must use the same canonical host.

Set `NEXTAUTH_URL` to a single canonical origin and enforce that host in middleware:

- `NEXTAUTH_URL=https://YOUR_CANONICAL_HOST`
- Middleware: [`src/middleware.ts`](../../../src/middleware.ts)

Google OAuth redirect URI must match the same host:

```text
https://YOUR_CANONICAL_HOST/api/auth/callback/google
```

## Verification checklist

- Health check: `GET /api/db-health` returns `{ ok: true, db: "up" }`
- Providers: `GET /api/auth/providers` includes Google/email providers as expected
- Sign-in flow: start → callback stays on the same host as `NEXTAUTH_URL`

## Common failure modes

### Cloud Run returns a 503 “not available yet”

Most commonly: billing disabled or a revision failing to start. Check revision logs and project billing status.

### Cloud SQL “up signal absent” alert

Cloud SQL restarts during `UPDATE` / maintenance can make the `cloudsql.googleapis.com/database/up` time series disappear for minutes. If the absence lasts much longer, inspect:

- `gcloud sql instances describe hg-postgres-prod --project expert-network-489508` (`state: RUNNABLE`)
- `gcloud sql operations list --instance=hg-postgres-prod --project expert-network-489508 --limit=50`
- Cloud Logging for `cloudsql.googleapis.com/postgres.log` “fast shutdown request” / “ready to accept connections”

### Cloud SQL connector ephemeral cert failures (`invalidState`)

This usually correlates with the Cloud SQL instance being in `MAINTENANCE` / not `RUNNABLE`. Wait for the operation to complete and retry; do not rotate DB passwords unless the error explicitly indicates auth failure.
