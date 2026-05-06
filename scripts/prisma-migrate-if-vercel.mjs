#!/usr/bin/env node
/**
 * Run `prisma migrate deploy` on Vercel production/preview builds so a new
 * Postgres database gets its tables before `next build` bundles the app.
 * Skips when not on Vercel or when no database URL is present.
 *
 * Managed Postgres providers can transiently reject connections during
 * install with errors such as "Circuit breaker open" or short-lived TLS
 * handshake failures. That should not fail `npm install` after the database
 * has already been migrated; retry briefly, then let the build continue
 * with a loud warning.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasDbUrl() {
  return Boolean(process.env.DIRECT_URL || process.env.DATABASE_URL);
}

if (process.env.VERCEL !== "1") {
  process.exit(0);
}

if (!hasDbUrl()) {
  console.warn(
    "[prisma-migrate-if-vercel] VERCEL=1 but no DATABASE_URL / DIRECT_URL — skipping migrate deploy (configure DATABASE_URL on Vercel and redeploy).",
  );
  process.exit(0);
}

const opts = { cwd: root, env: process.env };
const maxAttempts = Number.parseInt(process.env.PRISMA_MIGRATE_DEPLOY_ATTEMPTS || "3", 10);
const strictMigrate = process.env.PRISMA_MIGRATE_STRICT === "1";

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function errorOutput(err) {
  return (err?.stdout?.toString() ?? "") + (err?.stderr?.toString() ?? "") + (err?.message ?? "");
}

function isTransientDatabaseError(output) {
  return [
    "Circuit breaker open",
    "Failed to retrieve database credentials",
    "Can't reach database server",
    "Connection terminated unexpectedly",
    "Connection refused",
    "P1000",
    "P1001",
  ].some((needle) => output.includes(needle));
}

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
let firstErr = null;
for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
  firstErr = runMigrateDeploy();
  if (!firstErr) break;

  const combined = errorOutput(firstErr);
  if (!isTransientDatabaseError(combined) || attempt >= maxAttempts) break;

  const delayMs = attempt * 2000;
  console.warn(
    `[prisma-migrate-if-vercel] migrate deploy failed with a transient database error; retrying in ${delayMs}ms (${attempt}/${maxAttempts})…`,
  );
  sleep(delayMs);
}

if (firstErr) {
  const combined = errorOutput(firstErr);
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
  } else if (isTransientDatabaseError(combined) && !strictMigrate) {
    console.warn(
      "[prisma-migrate-if-vercel] Skipping migrate deploy after transient database connectivity/auth failure. Build will continue; run migrations manually once the database is reachable. Set PRISMA_MIGRATE_STRICT=1 to fail builds instead.",
    );
  } else {
    throw firstErr;
  }
}
