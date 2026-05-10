-- Phase 2 of the admin-page revamp.
--
-- Two changes, applied as a single transactional migration so a partial
-- failure never leaves SystemConfig in a half-migrated state:
--
-- 1. ProviderConfigChange table — append-only audit log for every write
--    that flows through `setSystemConfig` / `upsertProvider`. Sized
--    indexes match the three query shapes the admin UI uses:
--    "all changes newest-first", "changes for one configKey", and
--    "changes in env X".
--
-- 2. SystemConfig: drop the old `key` PK, add an `environment` column
--    (default "production"), make (key, environment) the new uniqueness
--    constraint. The compound key lets preview/dev hold independent
--    values for the same key without colliding with production.
--    Existing rows are backfilled to environment='production'.
--
-- Reversible-safe: each step uses IF [NOT] EXISTS / DO blocks so a partial
-- previous run can be re-applied without `relation already exists` errors.

BEGIN;

-- 1. Audit log -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ProviderConfigChange" (
    "id"          TEXT NOT NULL,
    "changedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorEmail"  TEXT,
    "actorRole"   TEXT,
    "category"    TEXT NOT NULL,
    "configKey"   TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "before"      JSONB,
    "after"       JSONB,
    "reason"      TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderConfigChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProviderConfigChange_changedAt_idx"
    ON "ProviderConfigChange"("changedAt");
CREATE INDEX IF NOT EXISTS "ProviderConfigChange_category_configKey_idx"
    ON "ProviderConfigChange"("category", "configKey");
CREATE INDEX IF NOT EXISTS "ProviderConfigChange_environment_changedAt_idx"
    ON "ProviderConfigChange"("environment", "changedAt");

-- 2. SystemConfig: per-environment scoping --------------------------------
-- Add `environment` column with default 'production' (backfills existing rows).
ALTER TABLE "SystemConfig"
    ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'production';

-- Add `id` surrogate primary key. Older deploys had `key` as the PK; we
-- can't have two PKs at once, so the dance is:
--   a. add nullable id column
--   b. backfill with cuid-ish values (gen_random_uuid → text is fine; the
--      app never reads SystemConfig.id, only Prisma does for its $transaction
--      semantics)
--   c. drop old PK, set new PK
ALTER TABLE "SystemConfig"
    ADD COLUMN IF NOT EXISTS "id" TEXT;

UPDATE "SystemConfig"
    SET "id" = COALESCE("id", 'sc_' || replace(gen_random_uuid()::text, '-', ''))
    WHERE "id" IS NULL;

ALTER TABLE "SystemConfig"
    ALTER COLUMN "id" SET NOT NULL;

-- Drop the old single-column PK if it still exists, then install the new one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'SystemConfig_pkey'
       AND conrelid = '"SystemConfig"'::regclass
  ) THEN
    -- Inspect: was the old PK on (key) or already on (id)?
    IF EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = '"SystemConfig"'::regclass
         AND i.indisprimary
         AND a.attname = 'key'
    ) THEN
      ALTER TABLE "SystemConfig" DROP CONSTRAINT "SystemConfig_pkey";
    END IF;
  END IF;
END $$;

-- Install id as PK (no-op if already there).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'SystemConfig_pkey'
       AND conrelid = '"SystemConfig"'::regclass
  ) THEN
    ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

-- (key, environment) unique. Existing rows already have environment='production'
-- via the default, and `key` was previously the PK so it's already unique on
-- the production slice — the new compound index will succeed.
CREATE UNIQUE INDEX IF NOT EXISTS "SystemConfig_key_environment_key"
    ON "SystemConfig"("key", "environment");

CREATE INDEX IF NOT EXISTS "SystemConfig_environment_idx"
    ON "SystemConfig"("environment");

COMMIT;
