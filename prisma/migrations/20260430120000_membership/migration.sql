-- Membership tier enum used by `User.membershipTier` and `MembershipLedger.tier`.
CREATE TYPE "MembershipTier" AS ENUM ('NONE', 'BASIC', 'PRO');

-- User: subscription / membership state for premium-live access on WeChat MP
-- (where H&G tokens are unavailable). Defaults to NONE so existing rows keep
-- working without backfill.
ALTER TABLE "User"
  ADD COLUMN "membershipTier" "MembershipTier" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "membershipUntil" TIMESTAMP(3);

CREATE INDEX "User_membershipUntil_idx" ON "User"("membershipUntil");

-- MembershipLedger: source-of-truth for subscription extensions and refunds.
CREATE TABLE "MembershipLedger" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "tier"            "MembershipTier" NOT NULL,
  "durationDays"    INTEGER NOT NULL,
  "amountMinor"     INTEGER NOT NULL DEFAULT 0,
  "currency"        TEXT NOT NULL DEFAULT 'CNY',
  "source"          TEXT NOT NULL,
  "externalRef"     TEXT,
  "membershipUntil" TIMESTAMP(3),
  "description"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MembershipLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipLedger_externalRef_key" ON "MembershipLedger"("externalRef");
CREATE INDEX "MembershipLedger_userId_idx" ON "MembershipLedger"("userId");
CREATE INDEX "MembershipLedger_source_idx" ON "MembershipLedger"("source");

ALTER TABLE "MembershipLedger"
  ADD CONSTRAINT "MembershipLedger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
