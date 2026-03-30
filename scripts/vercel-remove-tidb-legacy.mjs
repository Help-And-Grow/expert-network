#!/usr/bin/env node
/**
 * Remove legacy TIDB_DATABASE_URL from Vercel production only when a replacement
 * Postgres URL exists (DB9_DATABASE_URL or HICLAW_POSTGRES_URL).
 *
 * Usage (from repo root, linked project):
 *   node scripts/vercel-remove-tidb-legacy.mjs
 */
import { spawnSync } from "node:child_process";

const root = process.cwd();

function listProductionJson() {
  const r = spawnSync("npx", ["vercel@latest", "env", "ls", "production", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || "vercel env ls failed");
    process.exit(1);
  }
  const raw = r.stdout ?? "";
  const i = raw.indexOf("{");
  if (i < 0) {
    console.error("unexpected vercel output (no JSON)");
    process.exit(1);
  }
  return JSON.parse(raw.slice(i));
}

const { envs } = listProductionJson();
const keys = new Set((envs ?? []).map((e) => e.key));

const hasReplacement = keys.has("DB9_DATABASE_URL") || keys.has("HICLAW_POSTGRES_URL");
const hasTidb = keys.has("TIDB_DATABASE_URL");

if (!hasTidb) {
  console.log("[ok] no TIDB_DATABASE_URL on production — nothing to remove");
  process.exit(0);
}
if (!hasReplacement) {
  console.error(
    "[abort] Set DB9_DATABASE_URL or HICLAW_POSTGRES_URL on production first, then re-run.\n" +
      "See docs/design-docs/db9-integration.md",
  );
  process.exit(1);
}

const rm = spawnSync("npx", ["vercel@latest", "env", "rm", "TIDB_DATABASE_URL", "production", "--yes"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(rm.status ?? 1);
