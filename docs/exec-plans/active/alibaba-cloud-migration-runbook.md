# Alibaba Database Migration Runbook

Target: keep web compute on **Vercel** and run the shared PostgreSQL database on **Alibaba ApsaraDB RDS Serverless** in Singapore. The earlier plan to move compute to **Alibaba SAE** is canceled.

This runbook is now the source of truth for the completed database migration, the remaining Google Cloud shutdown work, and the repo policy change to **`jlzxwt8/expert-network` only**.

## Status

As of `2026-06-14`:

- Production web compute stays on `Vercel`.
- Production database has been cut over to Alibaba RDS.
- The `SAE` / `ACR` deployment path is abandoned and should not be revived without a new decision record.
- `Help-And-Grow/expert-network` is no longer a routine deployment target and should not receive routine pushes.
- Remaining infrastructure cleanup is to sunset the old Google Cloud Run and Cloud SQL resources.

## Current production target

### Alibaba RDS

| Item | Value |
|---|---|
| Instance ID | `pgm-gs5j57uq0lrdq46h` |
| Region / zone | `ap-southeast-1` / `ap-southeast-1a` |
| Billing | `Serverless` |
| Engine | `PostgreSQL 14.0` |
| Instance type | `pg.n2.serverless.1c` |
| VPC | `vpc-t4nutmnnx0eukabv34kyz` |
| vSwitch | `vsw-t4niujsgonik6gyfkk3y4` |
| Private endpoint | `pgm-gs5j57uq0lrdq46h.rwlb.singapore.rds.aliyuncs.com:5432` |
| Public endpoint | `hg-pg-20260614.rwlb.singapore.rds.aliyuncs.com:5432` |
| Database | `helpgrow` |
| App account | `hg_app` |

### Vercel production datasource

- Use the Alibaba **public endpoint** from Vercel.
- Prisma validation showed the Alibaba public endpoint does **not** support the TLS mode Vercel previously used for Cloud SQL.
- Production datasource URLs therefore use `sslmode=disable`, not `sslmode=require`.

Expected format:

```env
DATABASE_URL="postgresql://hg_app:<password>@hg-pg-20260614.rwlb.singapore.rds.aliyuncs.com:5432/helpgrow?schema=public&sslmode=disable"
DIRECT_URL="postgresql://hg_app:<password>@hg-pg-20260614.rwlb.singapore.rds.aliyuncs.com:5432/helpgrow?schema=public&sslmode=disable"
```

### Verification already completed

- `https://www.help-and-grow.com/api/health` returns healthy.
- `https://www.help-and-grow.com/api/db-health` returns healthy.
- Data import into Alibaba RDS was verified after the Cloud SQL export / import flow completed.

## Retained export artifact

The final Google Cloud SQL export should be retained until the Google Cloud teardown is complete.

| Item | Value |
|---|---|
| GCP project | `expert-network-489508` |
| Source instance | `hg-postgres-prod` |
| Export bucket | `gs://expert-network-489508-sql-export-20260614` |
| Export object | `gs://expert-network-489508-sql-export-20260614/Cloud_SQL_Export_2026-06-14 (13:39:45).sql` |
| Suggested local filename | `./helpgrow-20260614.sql` |

## Steady-state architecture

| Concern | Steady state |
|---|---|
| Source-of-truth repo | `jlzxwt8/expert-network` |
| Production compute | Vercel serverless (`sin1`) |
| Production database | Alibaba ApsaraDB RDS Serverless for PostgreSQL |
| Production URL | `https://www.help-and-grow.com` |
| Public mirror repo | `Help-And-Grow/expert-network` |
| Mirror repo policy | No routine pushes, no deployment ownership |

## Completed migration record

### Phase 1: Provision Alibaba RDS

Completed. The database, account, public endpoint, and whitelist were created on Alibaba Cloud. The correct live instance is `pgm-gs5j57uq0lrdq46h`.

Important retained notes:

- Do **not** create another Alibaba RDS instance for this workload.
- Do **not** reuse the earlier accidental pay-as-you-go instances that were released.
- Rotate the Alibaba `hg_app` password after cleanup because it was used during setup and terminal testing.

### Phase 2: Export from Google Cloud SQL and import into Alibaba

Completed. The Cloud SQL export was written to Google Cloud Storage and imported into Alibaba from another laptop after the corporate laptop path was blocked by network policy.

### Phase 3: Cut over Vercel production

Completed. `DATABASE_URL` and `DIRECT_URL` were updated in Vercel production and the deployment was revalidated successfully against Alibaba RDS.

## Remaining work: sunset Google Cloud

The old Google Cloud resources are no longer part of the target architecture.

### Resources to remove

| Resource | Identifier |
|---|---|
| Cloud Run service | `expert-network` |
| Cloud SQL instance | `hg-postgres-prod` |
| Cloud Build trigger | `rmgpgab-expert-network-asia-southeast1-Help-And-Grow-expert-gps` |

### Shutdown checklist

1. Confirm the Alibaba export artifact is retained in GCS or copied to long-term storage.
2. Confirm Vercel production remains healthy against Alibaba RDS.
3. Delete or disable the Cloud Build trigger for `Help-And-Grow/expert-network`.
4. Delete the Cloud Run service `expert-network`.
5. Delete the Cloud SQL instance `hg-postgres-prod`.
6. Keep the export bucket only as long as needed for rollback evidence, then delete it separately.

### Suggested commands

Run these from a machine with a current `gcloud` install and the correct project selected:

```bash
gcloud config set project expert-network-489508

gcloud beta builds triggers delete \
  rmgpgab-expert-network-asia-southeast1-Help-And-Grow-expert-gps

gcloud run services delete expert-network \
  --region=asia-southeast1

gcloud sql instances delete hg-postgres-prod
```

Note: on the current laptop, `gcloud` list commands for Cloud Run / Cloud Build are unreliable because the local CLI is running on unsupported Python `3.9`. Do the final destructive shutdown from the console or from a machine with updated `gcloud`.

## Repo policy after migration

- `jlzxwt8/expert-network` is the only repo that should receive routine code updates.
- `Help-And-Grow/expert-network` is now a frozen public mirror / historical reference.
- Do **not** dual-push to both repos.
- Vercel GitHub integration should remain connected to `jlzxwt8/expert-network`.

## Rollback posture

The former rollback option was to point Vercel back to Google Cloud SQL. That path should now be considered **expired** once the Google Cloud SQL instance is deleted. Retain the final SQL export before destruction if a cold restore is ever needed.
