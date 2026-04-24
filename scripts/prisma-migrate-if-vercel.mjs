#!/usr/bin/env node
/**
 * Run `prisma migrate deploy` on Vercel production/preview builds so new Postgres
 * (e.g. Marketplace Supabase) gets tables before `next build` bundles the app.
 * Skips when not on Vercel or when no database URL is present (e.g. misconfigured env).
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasDbUrl() {
  return Boolean(
    process.env.DIRECT_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL,
  );
}

if (process.env.VERCEL !== "1") {
  process.exit(0);
}

if (!hasDbUrl()) {
  console.warn(
    "[prisma-migrate-if-vercel] VERCEL=1 but no DATABASE_URL / POSTGRES_* — skipping migrate deploy (ensure Supabase integration vars are enabled for Build)",
  );
  process.exit(0);
}

const opts = { cwd: root, env: process.env };

function runMigrateDeploy() {
  // Capture output so we can inspect it on failure, but mirror it in real time.
  try {
    const out = execSync("npx prisma migrate deploy", { ...opts, stdio: "pipe" });
    process.stdout.write(out ?? "");
  } catch (err) {
    process.stdout.write(err.stdout ?? "");
    process.stderr.write(err.stderr ?? "");
    return err;
  }
  return null;
}

console.log("[prisma-migrate-if-vercel] Running prisma migrate deploy…");
const firstErr = runMigrateDeploy();
if (firstErr) {
  const combined = (firstErr.stdout?.toString() ?? "") + (firstErr.stderr?.toString() ?? "");
  // P3005: tables exist but no migration history (e.g. DB was set up outside of
  // Prisma Migrate). Resolve the baseline so future deploys apply cleanly.
  if (combined.includes("P3005") || combined.includes("database schema is not empty")) {
    console.warn("[prisma-migrate-if-vercel] P3005 — resolving baseline migration and retrying…");
    execSync("npx prisma migrate resolve --applied 20260424120000_baseline", {
      ...opts,
      stdio: "inherit",
    });
    const retryErr = runMigrateDeploy();
    if (retryErr) throw retryErr;
  } else {
    throw firstErr;
  }
}
