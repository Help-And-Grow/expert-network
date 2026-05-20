#!/usr/bin/env -S npx tsx
/**
 * One-off audit + backfill for expert_profile_embeddings.
 *
 * Reuses the production embedding pipeline (src/lib/expert-search-embeddings.ts)
 * so behavior is identical to the publish/profile-PATCH path and the Sunday
 * Inngest cron. Idempotent via content_hash — re-running is safe.
 *
 * Run from a network that is NOT behind a TLS-inspecting corporate proxy
 * (Zscaler RSTs the Cloud SQL TLS handshake). Cloud Shell or a non-corp
 * laptop both work. See docs/runbooks/expert-embeddings-backfill.md.
 *
 * Required env: DATABASE_URL (and PGVECTOR_DATABASE_URL if different),
 *               GEMINI_API_KEY.
 *
 * Usage:
 *   npx tsx scripts/backfill-expert-embeddings.ts            # audit + backfill all gaps
 *   npx tsx scripts/backfill-expert-embeddings.ts --dry-run  # audit only
 *   npx tsx scripts/backfill-expert-embeddings.ts --expert <id>  # one expert
 */
import { Pool } from "pg";

import {
  embedExpertProfile,
  getExpertProfileEmbeddingCoverage,
} from "../src/lib/expert-search-embeddings";
import { resolvePrimaryDatabaseUrl } from "../src/lib/env";

interface GapRow {
  expert_id: string;
  display_name: string | null;
  email: string | null;
  is_published: boolean;
  onboarding_step: string;
  countries: unknown;
  updated_at: Date;
  gap_reason: "NO_ROW" | "ROW_NULL_EMBEDDING" | "ROW_IS_PUBLISHED_FALSE";
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const expertFlagIdx = args.indexOf("--expert");
  const onlyExpertId =
    expertFlagIdx >= 0 ? args[expertFlagIdx + 1] : undefined;

  const url = resolvePrimaryDatabaseUrl();
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, max: 2 });

  const coverage = await getExpertProfileEmbeddingCoverage();
  console.log("=== Coverage before ===");
  console.table(coverage);

  const gapQuery = `
    SELECT e.id AS expert_id,
           COALESCE(u."nickName", u."name", '(no name)') AS display_name,
           u.email AS email,
           e."isPublished" AS is_published,
           e."onboardingStep"::text AS onboarding_step,
           e.countries AS countries,
           e."updatedAt" AS updated_at,
           CASE WHEN ep.expert_id IS NULL    THEN 'NO_ROW'
                WHEN ep.embedding  IS NULL   THEN 'ROW_NULL_EMBEDDING'
                WHEN ep.is_published = FALSE THEN 'ROW_IS_PUBLISHED_FALSE'
           END AS gap_reason
    FROM "Expert" e
    JOIN "User" u                          ON u.id        = e."userId"
    LEFT JOIN expert_profile_embeddings ep ON ep.expert_id = e.id
    WHERE e."isPublished" = TRUE
      AND e."onboardingStep" = 'PUBLISHED'
      AND (ep.expert_id IS NULL OR ep.embedding IS NULL OR ep.is_published = FALSE)
      ${onlyExpertId ? `AND e.id = $1` : ""}
    ORDER BY e."updatedAt" DESC
  `;
  const params = onlyExpertId ? [onlyExpertId] : [];
  const { rows } = await pool.query<GapRow>(gapQuery, params);

  console.log(`\n=== Gap experts (${rows.length}) ===`);
  for (const r of rows) {
    console.log(
      ` - ${r.expert_id} | ${r.display_name} | ${r.email ?? ""} | ${r.gap_reason} | countries=${JSON.stringify(r.countries)} | updatedAt=${r.updated_at.toISOString()}`,
    );
  }

  if (dryRun) {
    console.log("\n--dry-run: skipping backfill.");
    await pool.end();
    return;
  }

  if (rows.length === 0) {
    console.log("\nNothing to backfill.");
    await pool.end();
    return;
  }

  console.log(`\n=== Backfilling ${rows.length} experts ===`);
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const result = await embedExpertProfile(r.expert_id);
      if (result.embedded) embedded++;
      else if (result.skipped) skipped++;
      else failed++;
      console.log(
        ` - ${r.expert_id} (${r.display_name}): embedded=${result.embedded} skipped=${result.skipped} reason=${result.reason ?? ""}`,
      );
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` - ${r.expert_id} (${r.display_name}): FAILED ${msg}`);
    }
  }

  const after = await getExpertProfileEmbeddingCoverage();
  console.log("\n=== Coverage after ===");
  console.table(after);
  console.log(
    `\nDone. embedded=${embedded} skipped=${skipped} failed=${failed}`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
