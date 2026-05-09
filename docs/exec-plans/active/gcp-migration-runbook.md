# Future GCP App Migration Runbook

**Status**: Deferred
**Scope**: Move Web/Telegram compute from Vercel to Google Cloud Run. This is not the current database cutover.

## Current Decision

Web and Telegram stay on **Vercel** for the current phase. The active database-only plan is:

- [Web/Telegram DB Cutover: Supabase to Cloud SQL](supabase-to-cloudsql-migration.md)

Do not use this document to migrate production data. It is only for a future full-GCP hosting move.

## Future Target Shape

```text
Web / Telegram
  -> Cloud Run in asia-southeast1
  -> Cloud SQL for PostgreSQL
  -> Google Cloud Storage, if we also move media
  -> Vertex AI / Gemini plus the configured provider chain
```

## When To Reopen This Plan

Revisit this only if at least one of these becomes true:

- Vercel serverless limits become a product blocker.
- We need private Cloud SQL networking that Vercel cannot provide.
- We consolidate compute, database, storage, and AI under one Google Cloud account for compliance or cost control.

## High-Level Steps

1. Add a production Dockerfile or Cloud Run build config.
2. Provision Artifact Registry.
3. Deploy the Next.js standalone output to Cloud Run.
4. Move secrets to Secret Manager.
5. Point `DATABASE_URL` at Cloud SQL.
6. Move media storage to GCS only if Vercel Blob is also being retired.
7. Switch domains after parity tests pass.

Until this plan is reopened, keep all Web/Telegram production deploys on Vercel.
