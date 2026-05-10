#!/usr/bin/env node
/**
 * One-shot seeder for the new ProviderRegistry table. Idempotent —
 * existing rows are preserved so operator edits via /admin/providers
 * are never clobbered.
 *
 * Run after `prisma migrate deploy` lands the new table:
 *   node scripts/seed-provider-registry.mjs
 *
 * Or in TypeScript-friendly environments:
 *   npx tsx -e "import('./src/lib/admin/provider-registry-seed').then(m => m.seedProviderRegistryIfEmpty()).then(console.log)"
 */
import("dotenv/config")
  .catch(() => {})
  .then(async () => {
    const mod = await import(
      new URL("../src/lib/admin/provider-registry-seed.ts", import.meta.url).href
    ).catch(async () => {
      // Fallback: prefer the compiled JS path if available.
      return import("../.next/server/chunks/provider-registry-seed.js").catch(
        () => null,
      );
    });
    if (!mod || !mod.seedProviderRegistryIfEmpty) {
      console.error(
        "[seed] Unable to load provider-registry-seed. Run via tsx instead:",
      );
      console.error(
        "  npx tsx -e \"import('./src/lib/admin/provider-registry-seed').then(m => m.seedProviderRegistryIfEmpty()).then(console.log)\"",
      );
      process.exit(1);
    }
    const result = await mod.seedProviderRegistryIfEmpty();
    console.log("[seed] ProviderRegistry:", result);
    if (typeof mod.seedRoutingScopesIfEmpty === "function") {
      const scopes = await mod.seedRoutingScopesIfEmpty();
      console.log("[seed] ProviderRoutingScope:", scopes);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
