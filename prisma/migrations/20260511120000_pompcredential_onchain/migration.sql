-- Add on-chain attestation status to POMPCredential. One credential row
-- maps to one EAS attestation, so the per-attestation grain lives here.
--
-- onChainVerified is set eagerly when `issuePOMPCredentials` writes the
-- row (the EAS receipt itself proves inclusion) and idempotently by the
-- Alchemy webhook for redundancy / future external attestations.
-- txHash is the Base/Optimism tx hash that contained the Attested event,
-- populated from `receipt.hash` in `issuePOMPCredentials`.

ALTER TABLE "POMPCredential"
  ADD COLUMN IF NOT EXISTS "txHash" TEXT,
  ADD COLUMN IF NOT EXISTS "onChainVerified" BOOLEAN NOT NULL DEFAULT FALSE;

-- Reputation queries filter by expertId + onChainVerified.
CREATE INDEX IF NOT EXISTS "POMPCredential_expertId_onChainVerified_idx"
  ON "POMPCredential" ("expertId", "onChainVerified");
