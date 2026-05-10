-- Phase 1 of the admin-page revamp (see /admin/providers).
--
-- Adds a single `ProviderRegistry` table that backs the unified provider
-- switcher. Each row is an LLM/storage provider (future: voice, image)
-- with its env-key map and default models stored as JSON. This replaces
-- the hard-coded `ALL_AI_PROVIDERS` tuple in `src/lib/ai/provider-catalog.ts`
-- as the source of truth — the catalog file now reads the registry and
-- falls back to the hard-coded list only if the DB is unreachable.
--
-- Adding a new provider becomes: insert one row + ship a thin adapter.

-- CreateTable
CREATE TABLE "ProviderRegistry" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "envKeys" JSONB NOT NULL,
    "models" JSONB NOT NULL,
    "metadata" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderRegistry_category_enabled_sortOrder_idx" ON "ProviderRegistry"("category", "enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRegistry_category_key_key" ON "ProviderRegistry"("category", "key");
