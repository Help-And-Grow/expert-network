-- Revert W1's User-column approach to membership state. The original
-- migration added `User.membershipTier` and `User.membershipUntil`, which
-- meant every Prisma read using `include: { user: true }` (ubiquitous
-- across web onboarding, booking, dashboard) selected the new columns.
-- That coupled an unrelated WeChat-only feature to the rest of the web
-- surface — exactly the kind of cross-cutting risk the user flagged.
--
-- This migration moves membership state into a dedicated `Membership`
-- table keyed by `userId` (FK, unique). User now stays untouched. Web
-- code paths are insulated from any future membership column changes.
--
-- All DDL is conditional (IF EXISTS / IF NOT EXISTS) so this migration
-- applies cleanly regardless of whether the W1 migration already ran on
-- the target database — which means it's safe across Supabase, the
-- future TencentDB CN, and TencentDB Intl per the schema-parity rule.
--
-- The W1 migration file is preserved as part of the migration history so
-- prisma migrate status stays consistent. The columns/index it created
-- are dropped here; the MembershipLedger table it created is kept (with
-- one column rename, see below) since the new design still uses it as
-- the audit log.

-- 1. Drop User columns added by W1.
DROP INDEX IF EXISTS "User_membershipUntil_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "membershipUntil";
ALTER TABLE "User" DROP COLUMN IF EXISTS "membershipTier";

-- 2. Create the new Membership table.
CREATE TABLE IF NOT EXISTS "Membership" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "tier"         "MembershipTier" NOT NULL,
  "currentUntil" TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Membership_userId_key"
  ON "Membership"("userId");
CREATE INDEX IF NOT EXISTS "Membership_currentUntil_idx"
  ON "Membership"("currentUntil");

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Rename the audit-log column for naming consistency with the new
-- Membership.currentUntil. Old name was `membershipUntil`. Safe to no-op
-- if the W1 migration never ran on this DB.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MembershipLedger'
      AND column_name = 'membershipUntil'
  ) THEN
    ALTER TABLE "MembershipLedger" RENAME COLUMN "membershipUntil" TO "currentUntil";
  END IF;
END $$;
