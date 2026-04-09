#!/usr/bin/env node
/**
 * Ensures prisma/schema.prisma uses PostgreSQL only.
 *
 * Usage:
 *   node scripts/switch-db.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

console.log("[switch-db] Enforcing Prisma provider: postgresql");

const schemaPath = resolve(root, "prisma/schema.prisma");
let schema = readFileSync(schemaPath, "utf-8");
schema = schema.replace(/provider\s*=\s*"(postgresql|mysql)"/, `provider = "postgresql"`);
writeFileSync(schemaPath, schema);
console.log("[switch-db] schema.prisma -> provider = \"postgresql\"");
console.log("[switch-db] Done!");
