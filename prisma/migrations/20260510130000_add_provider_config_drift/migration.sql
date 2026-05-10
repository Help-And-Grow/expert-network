-- Phase 4 of the admin-page revamp: provider-config drift detector.
--
-- A nightly cron (/api/cron/provider-drift) compares every managed
-- SystemConfig row against the same key in the Vercel project env.
-- Differences land here. Operators reconcile via /admin/providers/drift.

-- CreateTable
CREATE TABLE "ProviderConfigDrift" (
    "id" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "configKey" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "dbValue" TEXT,
    "vercelValue" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedNote" TEXT,

    CONSTRAINT "ProviderConfigDrift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderConfigDrift_resolved_detectedAt_idx" ON "ProviderConfigDrift"("resolved", "detectedAt");

-- CreateIndex
CREATE INDEX "ProviderConfigDrift_configKey_environment_idx" ON "ProviderConfigDrift"("configKey", "environment");
