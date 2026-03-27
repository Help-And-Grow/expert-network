#!/usr/bin/env node
/**
 * Ensures prisma/schema.prisma uses PostgreSQL only (TiDB/MySQL Prisma path removed).
 *
 * Usage:
 *   node scripts/switch-db.mjs
 *
 * Legacy `DB_PROVIDER=tidb` in .env is ignored — the script always sets provider = "postgresql".
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

try {
  const envContent = readFileSync(resolve(root, ".env"), "utf-8");
  const match = envContent.match(/^DB_PROVIDER\s*=\s*"?(\w+)"?/m);
  if (match && match[1] === "tidb") {
    console.warn(
      "[switch-db] DB_PROVIDER=tidb is ignored — Prisma is PostgreSQL-only. Remove tidb from .env and use a postgresql:// DATABASE_URL.",
    );
  }
} catch {
  /* no .env */
}

console.log("[switch-db] Enforcing Prisma provider: postgresql");

const schemaPath = resolve(root, "prisma/schema.prisma");
let schema = readFileSync(schemaPath, "utf-8");
schema = schema.replace(/provider\s*=\s*"(postgresql|mysql)"/, `provider = "postgresql"`);
writeFileSync(schemaPath, schema);
console.log("[switch-db] schema.prisma -> provider = \"postgresql\"");
console.log("[switch-db] Done!");
