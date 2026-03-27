#!/usr/bin/env node
/**
 * Push environment variables to Vercel using the Vercel CLI (non-interactive).
 *
 * Prerequisites:
 *   - `vercel` CLI installed (`npm i -g vercel` or use `npx vercel`)
 *   - Logged in: `vercel login`
 *   - Linked project: `vercel link` in repo root (creates .vercel/)
 *
 * Usage:
 *   node scripts/vercel-env-from-file.mjs <production|preview|development> <path-to-env-file>
 *
 * File format (same spirit as dotenv; do not commit real secrets):
 *   KEY=value
 *   # comments and blank lines ignored
 *   MULTILINE="use quotes if needed"
 *
 * Each key runs: printf '%s' 'value' | vercel env add KEY <target> --force
 * (--force overwrites existing name for that environment)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
const filePath = process.argv[3];

const allowed = new Set(["production", "preview", "development"]);
if (!target || !allowed.has(target) || !filePath) {
  console.error(
    "Usage: node scripts/vercel-env-from-file.mjs <production|preview|development> <env-file>",
  );
  process.exit(1);
}

const abs = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(abs)) {
  console.error(`File not found: ${abs}`);
  process.exit(1);
}

const raw = fs.readFileSync(abs, "utf8");
const lines = raw.split(/\r?\n/);

function parseLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const eq = t.indexOf("=");
  if (eq <= 0) return null;
  const key = t.slice(0, eq).trim();
  let val = t.slice(eq + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    console.warn(`[skip] invalid key name: ${key}`);
    return null;
  }
  return { key, val };
}

const entries = [];
for (const line of lines) {
  const p = parseLine(line);
  if (p) entries.push(p);
}

if (entries.length === 0) {
  console.error("No KEY=value entries found.");
  process.exit(1);
}

const vercelBin = process.env.VERCEL_CLI || "vercel";

for (const { key, val } of entries) {
  const r = spawnSync(vercelBin, ["env", "add", key, target, "--force"], {
    input: val,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    console.error(`[fail] ${key} (exit ${r.status ?? "unknown"})`);
    process.exit(r.status ?? 1);
  }
  console.log(`[ok] ${key}`);
}

console.log(`Done: ${entries.length} variable(s) → Vercel (${target}).`);
