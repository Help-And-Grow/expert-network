-- Phase 3 of the admin-page revamp (see /admin/providers).
--
-- Adds two tables:
--   * ProviderRoutingScope  — per-surface (WeChat/Web/Telegram) provider chains.
--   * ProviderRouteOverride — per-route chain overrides (e.g. /api/match → cheaper).
--
-- Together they replace the hard-coded `WECHAT_AI_PROVIDER` env split and the
-- one-size-fits-all `AI_TEXT_PROVIDER_CHAIN` SystemConfig key as the source
-- of truth for request → chain resolution. The legacy env values stay as
-- a safety-net fallback when these tables are unreachable.

-- CreateTable
CREATE TABLE "ProviderRoutingScope" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "chain" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchRules" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRoutingScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderRoutingScope_category_enabled_priority_idx" ON "ProviderRoutingScope"("category", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRoutingScope_scopeKey_category_environment_key" ON "ProviderRoutingScope"("scopeKey", "category", "environment");

-- CreateTable
CREATE TABLE "ProviderRouteOverride" (
    "id" TEXT NOT NULL,
    "routePattern" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "chainOverride" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRouteOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderRouteOverride_enabled_environment_idx" ON "ProviderRouteOverride"("enabled", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRouteOverride_routePattern_category_environment_key" ON "ProviderRouteOverride"("routePattern", "category", "environment");
