# Runbook — Backfill `expert_profile_embeddings`

**Status:** Open, blocked by Zscaler on the primary laptop. Picking this up from another machine.

**Owner / context:** Tony (PM). Handing off to Claude Code running on a laptop NOT behind corporate Zscaler.

## Why

Some published experts (e.g. **David Ong**, country tag `JP`) don't have a row in `expert_profile_embeddings`. Consequence: the pgvector path in [src/lib/expert-match-search.ts](../../src/lib/expert-match-search.ts) skips them, so they only surface through the country-allowlist missing-fill backfill in [src/app/api/experts/match/route.ts:581](../../src/app/api/experts/match/route.ts). For a semantic query like "Japanese fintech founder" they are invisible.

Goal: identify the gap, backfill it, verify David Ong appears for a semantic-only query.

## Why this is being handed off

From the primary laptop, every path to the prod DB times out at the TLS layer — corporate TLS inspection RSTs both the Cloud SQL Auth Proxy's mTLS on port 3307 and direct Postgres STARTTLS on 5432. TCP succeeds (`nc -vz` green) but no app-layer bytes flow. Need to run from a network without that inspector.

## Prereqs on the other laptop

1. `gcloud` CLI installed and authenticated as a project owner / Cloud SQL admin:
   ```bash
   gcloud auth login                 # mia.ong@help-and-grow.com or equivalent
   gcloud config set project expert-network-489508
   ```
2. `cloud-sql-proxy` installed:
   ```bash
   brew install cloud-sql-proxy
   ```
3. The repo cloned and on `main`:
   ```bash
   git clone git@github.com:Help-And-Grow/expert-network.git   # or jlzxwt8/expert-network
   cd expert-network
   git checkout main && git pull
   npm install
   ```

## Step 1 — Open a tunnel to prod Cloud SQL

Run the proxy in one terminal (keep it running):

```bash
cloud-sql-proxy --gcloud-auth \
  expert-network-489508:asia-southeast1:hg-postgres-prod \
  --port 15432
```

Expected last line:
```
The proxy has started successfully and is ready for new connections!
```

If that fails on a non-Zscaler network, fall back to direct public IP (`34.126.117.155:5432`, `sslmode=require`, server CA in the instance's `connectSettings` API output).

## Step 2 — Set env for the script

```bash
# Postgres URL pointing at the local proxy
export DATABASE_URL="postgresql://hg_app:$(gcloud secrets versions access latest --secret=expert-network-database-url --project=expert-network-489508 | awk -F'[:@]' '{print $3}')@127.0.0.1:15432/helpgrow?sslmode=disable"

# Embedding provider (Vertex Gemini)
export GOOGLE_CLOUD_PROJECT="expert-network-489508"
export GOOGLE_CLOUD_LOCATION="asia-southeast1"
export GOOGLE_SERVICE_ACCOUNT_KEY="$(gcloud secrets versions access latest --secret=expert-network-google-service-account-key --project=expert-network-489508)"
```

Sanity check:
```bash
node --input-type=module -e "
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect(); console.log(await c.query('select now() now, current_user'));
await c.end();
"
```

## Step 3 — Audit (dry run)

```bash
npx tsx scripts/backfill-expert-embeddings.ts --dry-run
```

This prints:
- **Coverage before**: totals across `publishedExperts`, `searchableExperts`, `staleExperts`, `tableReady`.
- **Gap experts**: one line per expert with `isPublished=true` AND `onboardingStep='PUBLISHED'` whose `expert_profile_embeddings` row is missing, has NULL embedding, or has `is_published=false`. Each line shows `gap_reason ∈ {NO_ROW, ROW_NULL_EMBEDDING, ROW_IS_PUBLISHED_FALSE}`, the user's display name + email, countries, and `updatedAt`.

Confirm **David Ong** appears in the list. If not, the gap may already be filled by an unrelated cron — re-check with the per-expert queries below.

If you'd rather audit straight in Cloud SQL Studio (no proxy needed for read-only): paste the SQL block at the bottom of this doc.

## Step 4 — Backfill

```bash
npx tsx scripts/backfill-expert-embeddings.ts
```

The script:
1. Re-runs the gap query.
2. For each gap expert, calls `embedExpertProfile(expertId)` from [src/lib/expert-search-embeddings.ts](../../src/lib/expert-search-embeddings.ts) — the same function the publish/profile-PATCH path and the Sunday Inngest cron use. Idempotent via `content_hash`.
3. Prints per-expert result (`embedded` / `skipped` / `reason`) and a **Coverage after** table.

Costs: one Gemini `embedContent` call (`gemini-embedding-001`, 1536-dim, `RETRIEVAL_DOCUMENT`) per gap expert. For ~tens of experts this is cents.

To backfill a single expert only:
```bash
npx tsx scripts/backfill-expert-embeddings.ts --expert <expertId>
```

## Step 5 — Verify David Ong

In Cloud SQL Studio (or via the proxy + a psql), confirm his row exists and has an embedding:

```sql
SELECT e.id, u."nickName", u."name", u.email,
       ep.expert_id IS NOT NULL AS has_row,
       ep.embedding  IS NOT NULL AS has_embedding,
       ep.is_published,
       ep.embedded_at, ep.region
FROM "Expert" e
JOIN "User" u ON u.id = e."userId"
LEFT JOIN expert_profile_embeddings ep ON ep.expert_id = e.id
WHERE u."nickName" ILIKE '%david%ong%'
   OR u."name"     ILIKE '%david%ong%'
   OR u.email      ILIKE '%david%ong%';
```

Then hit production `/discover` with a semantic-only query (NOT a bare country word):
```
"Japanese fintech founder"
"fintech expert based in Tokyo"
"crypto product lead Japan"
```

David Ong should rank in the top results. If he's missing, check:
- `gemini-embedding-001` call returned a vector (look at the script's per-expert output).
- The match route in [src/app/api/experts/match/route.ts](../../src/app/api/experts/match/route.ts) — confirm it's reading from `expert_profile_embeddings` and filtering by `is_published = TRUE`.
- The Vercel deploy is using the same pgvector instance (`PGVECTOR_DATABASE_URL` unset → falls back to `DATABASE_URL`, both should point to `hg-postgres-prod`).

## Step 6 — Cleanup

Nothing to clean up. The script lives in `scripts/` and can be re-run anytime; it's safe and idempotent. If the gap turns out to be recurring, file a follow-up to investigate why Inngest's `app/expert.profile.changed` event isn't firing on the publish path for some experts (the most likely failure mode is the Inngest emit silently swallowing errors — see [src/lib/inngest/emit.ts:40](../../src/lib/inngest/emit.ts)).

---

## Appendix — Audit SQL (paste into Cloud SQL Studio)

If you'd rather not run the proxy at all and just want the read:

```sql
-- 1. Coverage summary
SELECT
  COUNT(*) FILTER (WHERE e."isPublished" = TRUE)                                                       AS pub_isPublished_true,
  COUNT(*) FILTER (WHERE e."isPublished" = TRUE AND e."onboardingStep" = 'PUBLISHED')                   AS pub_and_step_published,
  COUNT(*) FILTER (WHERE e."isPublished" = TRUE AND ep.expert_id IS NULL)                               AS pub_no_row_at_all,
  COUNT(*) FILTER (WHERE e."isPublished" = TRUE AND ep.expert_id IS NOT NULL AND ep.embedding IS NULL)  AS pub_row_but_null_embedding,
  COUNT(*) FILTER (WHERE e."isPublished" = TRUE AND ep.embedding IS NOT NULL AND ep.is_published = TRUE) AS pub_searchable
FROM "Expert" e
LEFT JOIN expert_profile_embeddings ep ON ep.expert_id = e.id;

-- 2. Gap list
SELECT e.id                                                  AS expert_id,
       COALESCE(u."nickName", u."name", '(no name)')         AS display_name,
       u.email,
       e."isPublished",
       e."onboardingStep",
       e.countries,
       e."updatedAt",
       CASE WHEN ep.expert_id IS NULL    THEN 'NO_ROW'
            WHEN ep.embedding  IS NULL   THEN 'ROW_NULL_EMBEDDING'
            WHEN ep.is_published = FALSE THEN 'ROW_IS_PUBLISHED_FALSE'
            ELSE 'OK' END                                    AS gap_reason,
       ep.embedded_at,
       ep.region
FROM "Expert" e
JOIN "User" u                          ON u.id        = e."userId"
LEFT JOIN expert_profile_embeddings ep ON ep.expert_id = e.id
WHERE e."isPublished" = TRUE
  AND e."onboardingStep" = 'PUBLISHED'
  AND (ep.expert_id IS NULL OR ep.embedding IS NULL OR ep.is_published = FALSE)
ORDER BY e."updatedAt" DESC;

-- 3. David Ong specifically
SELECT e.id, u."nickName", u."name", u.email,
       e."isPublished", e."onboardingStep", e.countries, e."updatedAt",
       ep.expert_id IS NOT NULL AS has_row,
       ep.embedding  IS NOT NULL AS has_embedding,
       ep.is_published          AS row_is_published,
       ep.embedded_at, ep.region
FROM "Expert" e
JOIN "User" u                          ON u.id        = e."userId"
LEFT JOIN expert_profile_embeddings ep ON ep.expert_id = e.id
WHERE u."nickName" ILIKE '%david%ong%'
   OR u."name"     ILIKE '%david%ong%'
   OR u.email      ILIKE '%david%ong%';
```

---

## Reference — what's already in the codebase

| File | Role |
|---|---|
| [src/lib/expert-search-embeddings.ts](../../src/lib/expert-search-embeddings.ts) | Writer. `embedExpertProfile` (single), `backfillExpertProfileEmbeddings` (loop), `refreshStaleExpertProfileEmbeddings` (LEFT-JOIN-NULL-or-stale query), `getExpertProfileEmbeddingCoverage`. |
| [src/lib/expert-match-search.ts](../../src/lib/expert-match-search.ts) | Reader. Filters `WHERE is_published = TRUE` on the pgvector table. |
| [src/app/api/admin/embeddings/backfill/route.ts](../../src/app/api/admin/embeddings/backfill/route.ts) | Admin POST endpoint — same library function, gated by NextAuth session. |
| [src/inngest/functions/expert-embedding-refresh.ts](../../src/inngest/functions/expert-embedding-refresh.ts) | Two functions: event-triggered (`app/expert.profile.changed`) and cron (Sun 03:00 UTC). |
| [src/app/api/onboarding/publish/route.ts:63](../../src/app/api/onboarding/publish/route.ts) | Where publish should emit the Inngest event that refreshes the embedding. |
| [src/app/api/expert/profile/route.ts:164](../../src/app/api/expert/profile/route.ts) | Where profile PATCH does the same. |
| [scripts/backfill-expert-embeddings.ts](../../scripts/backfill-expert-embeddings.ts) | This runbook's one-off script. |

Table schema (from [src/app/api/admin/migrate/route.ts:77](../../src/app/api/admin/migrate/route.ts)):
```sql
CREATE TABLE expert_profile_embeddings (
  expert_id     TEXT NOT NULL PRIMARY KEY,
  content_hash  TEXT NOT NULL,
  source        TEXT NOT NULL,
  embedding     vector(1536),
  embedded_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  is_published  BOOLEAN DEFAULT TRUE,
  region        TEXT
);
```
