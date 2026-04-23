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
      process.env.POSTGRES_PRISMA_URL,
  );
}

if (process.env.VERCEL !== "1") {
  process.exit(0);
}

if (!hasDbUrl()) {
  console.warn("[prisma-migrate-if-vercel] VERCEL=1 but no DATABASE_URL / POSTGRES_* — skipping migrate deploy");
  process.exit(0);
}

execSync("npx prisma migrate deploy", { stdio: "inherit", cwd: root, env: process.env });
