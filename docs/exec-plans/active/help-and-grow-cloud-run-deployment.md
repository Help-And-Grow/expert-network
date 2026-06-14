# Help-And-Grow Google Cloud Run Sunset Runbook

Status: **decommissioning / historical only**.

The old `Help-And-Grow/expert-network` Google Cloud path is no longer the target architecture. Compute stays on **Vercel**, the shared database now lives on **Alibaba ApsaraDB RDS**, and routine development happens only in `jlzxwt8/expert-network`.

Use this document only to identify and shut down the remaining Google Cloud resources.

See [`docs/exec-plans/active/alibaba-cloud-migration-runbook.md`](./alibaba-cloud-migration-runbook.md) for the current production architecture and final repo policy.

## Historical resources to remove

| Resource | Identifier |
|---|---|
| GCP project | `expert-network-489508` |
| Cloud Run service | `expert-network` |
| Region | `asia-southeast1` |
| Cloud Run runtime service account | `expert-network-run@expert-network-489508.iam.gserviceaccount.com` |
| Cloud Build trigger | `rmgpgab-expert-network-asia-southeast1-Help-And-Grow-expert-gps` |
| Cloud SQL instance | `hg-postgres-prod` |
| Export bucket | `gs://expert-network-489508-sql-export-20260614` |
| Export object | `Cloud_SQL_Export_2026-06-14 (13:39:45).sql` |

## Current decision

- Do **not** deploy from `Help-And-Grow/expert-network`.
- Do **not** recreate the Google Cloud Run service.
- Do **not** create an Alibaba SAE replacement.
- Keep production on `Vercel` and keep the database on Alibaba RDS.

## Shutdown order

1. Verify Vercel production is healthy against Alibaba RDS.
2. Retain the final Cloud SQL export in GCS or copy it to another safe location.
3. Delete or disable the Cloud Build trigger so GitHub pushes can no longer start Cloud Run deployments.
4. Delete the Cloud Run service `expert-network`.
5. Delete the Cloud SQL instance `hg-postgres-prod`.
6. Delete supporting Google Cloud resources only after confirming no other workload depends on them.

## Suggested commands

Run these from a machine with working `gcloud` tooling:

```bash
gcloud config set project expert-network-489508

gcloud beta builds triggers delete \
  rmgpgab-expert-network-asia-southeast1-Help-And-Grow-expert-gps

gcloud run services delete expert-network \
  --region=asia-southeast1

gcloud sql instances delete hg-postgres-prod
```

If the local `gcloud` installation still crashes on `run` or `builds` commands because it is pinned to unsupported Python `3.9`, do the shutdown from:

- Google Cloud Console, or
- another laptop with an updated Google Cloud CLI.

## Historical notes kept for audit

- The previous Cloud Run URL was `https://expert-network-druobkk2ma-as.a.run.app`.
- Cloud Run used `AI_PROVIDER_LOCK=gemini` so demo traffic stayed Gemini-only.
- Cloud Run and Vercel previously shared the same Cloud SQL instance; that dependency ended once Vercel moved to Alibaba RDS on `2026-06-14`.
