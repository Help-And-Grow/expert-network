# Help-And-Grow × Google Cloud Run deployment runbook

Target: deploy [`Help-And-Grow/expert-network`](https://github.com/Help-And-Grow/expert-network) on **Google Cloud Run** using **Gemini** as the AI provider and **Cloud SQL for PostgreSQL** as the database. This is the active-development surface used for hackathon demos, investor pitches, and credit-grant showcases — separate from the Vercel-served production at `www.help-and-grow.com` (which is wired to `jlzxwt8/expert-network`).

See [`docs/references/multi-repo-strategy.md`](../../references/multi-repo-strategy.md) for the full source-of-truth + repo-roles model.

## Architecture at a glance

| Concern | Production (Vercel) | Help-And-Grow demo (Cloud Run) |
|---|---|---|
| Repo / branch | `jlzxwt8/main` (production-locked) | `Help-And-Grow/main` (active dev) |
| Local remote | `production` | `origin` |
| Compute | Vercel serverless (`sin1`) | Cloud Run service `expert-network` in `asia-southeast1` |
| Auto-deploy trigger | Vercel GitHub App on push | Cloud Build trigger on push |
| Database | Cloud SQL `hg-postgres-prod` (shared) | Cloud SQL `hg-postgres-prod` (shared — same Postgres instance) |
| Storage | GCS / Vercel Blob | `STORAGE_PROVIDER=db` for now (no dedicated bucket yet) |
| Text LLM | Qwen → Gemini | **Gemini only** (single-cloud, no fallback) |
| Image LLM | Qwen → Gemini | **Gemini only** |
| Service URL | https://www.help-and-grow.com | https://expert-network-druobkk2ma-as.a.run.app |

The two surfaces share the same Postgres instance — feature work on Cloud Run runs against the same data Vercel serves. Schema migrations stay manual (the `prisma-migrate-if-vercel.mjs` postinstall script's auto-migrate path is gated on `VERCEL=1` / `IGA_PAGES=1` / `IGA_BUILD_REGION` / `PRISMA_AUTO_MIGRATE=1` — none of which are set during Cloud Build, so production schema is never touched by a Help-And-Grow deploy).

## §1 · GCP resources in use

| Resource | Identifier |
|---|---|
| GCP project | `expert-network-489508` |
| Cloud Run service | `expert-network` (region `asia-southeast1`) |
| Cloud Run runtime service account | `expert-network-run@expert-network-489508.iam.gserviceaccount.com` |
| Cloud Build trigger | `rmgpgab-expert-network-asia-southeast1-Help-And-Grow-expert-gps` — fires on push to `Help-And-Grow/expert-network` `main` |
| Cloud SQL instance | `expert-network-489508:asia-southeast1:hg-postgres-prod` (mounted via `run.googleapis.com/cloudsql-instances` annotation) |
| Source upload bucket | `expert-network-489508-source-bucket` |
| Build cache bucket | `expert-network-489508_cloudbuild` |

## §2 · Deploy flow

1. `git push origin main` (Help-And-Grow).
2. GitHub fires webhook → Cloud Build trigger.
3. Cloud Build runs the buildpack / Dockerfile → image pushed to Artifact Registry.
4. Cloud Run creates a new revision, routes 100% of traffic to it once Ready.
5. No manual step required; verify in the Cloud Run console or via:

```bash
gcloud run revisions list \
  --service=expert-network --region=asia-southeast1 \
  --limit=5 --format="table(metadata.name, status.conditions[?type=='Ready'].status, metadata.creationTimestamp)"
```

## §3 · Environment configuration

### Currently set (2026-05-17)

Non-secret values shown; secrets redacted:

Plain env vars (non-secret):

```
AI_PROVIDER             = gemini
AI_TEXT_PROVIDER_CHAIN  = gemini
IMAGE_PROVIDER_CHAIN    = gemini
GEMINI_TEXT_MODEL       = gemini-2.5-flash
GEMINI_IMAGE_MODEL      = gemini-2.5-flash-image
GOOGLE_CLOUD_PROJECT    = expert-network-489508
NEXTAUTH_URL            = https://expert-network-druobkk2ma-as.a.run.app
EMAIL_SERVER_HOST       = <set, Nodemailer host>
EMAIL_SERVER_PORT       = <set>
EMAIL_SERVER_USER       = <set>
EMAIL_FROM              = <set>
DB_PROVIDER             = postgresql
NODE_ENV                = production
VERIFY_BILLING          = <set>
```

Secret-backed env vars (each references a Secret Manager secret via `valueFrom.secretKeyRef`; runtime SA `expert-network-run@…` has `roles/secretmanager.secretAccessor` on each):

```
GEMINI_API_KEY          ← expert-network-gemini-api-key:latest
DATABASE_URL            ← expert-network-database-url:latest
AUTH_SECRET             ← expert-network-auth-secret:latest
GOOGLE_CLIENT_SECRET    ← expert-network-google-client-secret:latest
EMAIL_SERVER_PASSWORD   ← expert-network-gmail-app-password:latest
STRIPE_SECRET_KEY       ← expert-network-stripe-secret-key:latest
```

### Update env vars

```bash
gcloud run services update expert-network \
  --region=asia-southeast1 \
  --update-env-vars="KEY1=value1,KEY2=value2"
```

For values that contain commas, use the alternative delimiter syntax:

```bash
gcloud run services update expert-network \
  --region=asia-southeast1 \
  --update-env-vars="^@^KEY1=val,with,commas@KEY2=other"
```

`--update-env-vars` is additive — it preserves existing variables not listed. To remove a variable: `--remove-env-vars=KEY1,KEY2`.

### Add a new secret-backed env var

The pattern, used for the six secrets above:

```bash
# 1. Create the secret with the value via stdin (avoids shell history).
printf "%s" "<the-value>" | gcloud secrets create expert-network-<descriptor> \
  --data-file=- \
  --replication-policy=automatic \
  --labels=service=expert-network,kind=<credential|config>

# 2. Grant the runtime SA accessor on this specific secret.
gcloud secrets add-iam-policy-binding expert-network-<descriptor> \
  --member="serviceAccount:expert-network-run@expert-network-489508.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 3. Atomically swap plain env → secret reference (or just add fresh).
gcloud run services update expert-network \
  --region=asia-southeast1 \
  --remove-env-vars=<NAME> \
  --update-secrets=<NAME>=expert-network-<descriptor>:latest
```

### Rotate a secret value

```bash
printf "%s" "<new-value>" | gcloud secrets versions add expert-network-<descriptor> \
  --data-file=-
```

Because Cloud Run references `:latest`, the next cold start picks up the new version automatically. To force an immediate rollout: `gcloud run services update expert-network --region=asia-southeast1` (with no other flags creates a new revision that re-reads `:latest`).

To roll back a bad rotation: `gcloud secrets versions enable <prev-version-number> --secret=expert-network-<descriptor>` then disable the bad one.

## §4 · Logs + debugging

```bash
# Recent runtime logs (last 10 minutes)
gcloud run services logs read expert-network \
  --region=asia-southeast1 --limit=200

# Tail live
gcloud run services logs tail expert-network \
  --region=asia-southeast1

# Recent build runs (success/failure of the auto-deploy trigger)
gcloud builds list --limit=10 \
  --format="table(id.scope(builds), status, source.repoSource.repoName, source.repoSource.branchName, startTime, duration)"

# Inspect a specific build
gcloud builds log <build-id>
```

## §5 · Rollback

Cloud Run preserves revisions. To revert to a known-good one:

```bash
gcloud run revisions list --service=expert-network --region=asia-southeast1 --limit=10
gcloud run services update-traffic expert-network \
  --region=asia-southeast1 \
  --to-revisions=expert-network-00020-xxx=100
```

## §6 · Schema-change discipline

The Cloud Run service shares Cloud SQL `hg-postgres-prod` with Vercel production. **Any schema change you ship to `Help-And-Grow/main` will eventually need to be applied to that DB** — but auto-migration is intentionally NOT wired into the Cloud Build path. Sequence for a feature that introduces a Prisma migration:

1. Develop on `Help-And-Grow/main` as usual. The Cloud Run deploy succeeds but the new code will throw `P2022` ("column does not exist") at runtime until the migration is applied.
2. Decide when to apply the migration. The safest path is to apply it via the production cherry-pick:

   ```bash
   git fetch production
   git checkout -b hotfix/migration-<name> production/main
   git cherry-pick <migration-commit-sha>
   git push production HEAD:main
   ```

   Vercel's `prisma migrate deploy` postinstall fires on the `jlzxwt8` push → DB schema updates → both Vercel and Cloud Run pick up the new columns immediately (same Postgres instance).

3. Alternative for Help-And-Grow-only experimental migrations: apply manually via Cloud SQL Studio with the rest of the team's awareness.

## §7 · Cost guardrails

- `autoscaling.knative.dev/maxScale` = 3 (cap on parallel instances)
- `autoscaling.knative.dev/minScale` = 0 (scales to zero when idle — cold start ~1-2s)
- Cloud SQL connection is pooled; no per-request connection cost.
- Cloud Build trigger fires only on `main` push; feature-branch pushes don't burn build minutes.

For hackathon load levels, expected GCP spend is single-digit USD/month.

## §8 · Service URL + custom domain

Default: https://expert-network-druobkk2ma-as.a.run.app (this is `NEXTAUTH_URL` — the canonical URL the service redirects to).

The alternative auto-generated URL `https://expert-network-960290333777.asia-southeast1.run.app` 308-redirects to the canonical one.

To add a custom subdomain (e.g. `demo.help-and-grow.com`):

```bash
gcloud beta run domain-mappings create \
  --service=expert-network \
  --region=asia-southeast1 \
  --domain=demo.help-and-grow.com
```

Then add the DNS records GCP prints back. The Cloud Run service will obtain a managed TLS cert automatically.

## §9 · See also

- [docs/references/multi-repo-strategy.md](../../references/multi-repo-strategy.md) — production vs. active-dev repo split
- [CLAUDE.md](../../../CLAUDE.md) — daily workflow + hotfix-cherry-pick recipe
- [docs/exec-plans/active/iga-pages-volcengine-deployment.md](./iga-pages-volcengine-deployment.md) — sibling CN deployment (Volcengine), for future post-ICP rollout
- [docs/references/telegram-bot.md](../../references/telegram-bot.md) — Telegram webhook stays on Vercel (production); Cloud Run deploy doesn't currently have a webhook attached
