#!/usr/bin/env node
/**
 * Provision a DB9 Postgres database, apply HiClaw schema, optionally set Vercel DB9_DATABASE_URL.
 *
 * Use when `db9` CLI fails with "Connection failed" (e.g. corporate TLS) — same API as the CLI.
 *
 * Usage (repo root):
 *   DB9_API_KEY=... node scripts/db9-provision.mjs           # recommended (after `db9 login` + `db9 token show`)
 *   node scripts/db9-provision.mjs                           # anonymous trial (see stderr warning)
 *   node scripts/db9-provision.mjs --skip-vercel
 *
 * Requires: Node 18+, linked Vercel project + `npx vercel` auth (unless --skip-vercel).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const API = "https://api.db9.ai";
const DEFAULT_NAME = "expert-network-hiclaw";
const SCHEMA_REL = "hiclaw/schema-postgres.sql";

function parseArgs(argv) {
  const skipVercel = argv.includes("--skip-vercel");
  const nameArg = argv.find((a) => a.startsWith("--name="));
  const name = nameArg ? nameArg.slice("--name=".length).trim() : DEFAULT_NAME;
  return { skipVercel, name };
}

async function anonymousToken() {
  const r = await fetch(`${API}/customer/anonymous-register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`anonymous-register ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.token;
}

async function apiJson(token, method, pathname, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j;
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = { raw: text };
  }
  if (!r.ok) throw new Error(`${method} ${pathname} ${r.status}: ${text.slice(0, 400)}`);
  return j;
}

async function ensureDatabase(token, name) {
  const list = await apiJson(token, "GET", "/customer/databases");
  const rows = Array.isArray(list) ? list : list?.databases ?? [];
  const existing = rows.find((d) => d.name === name);
  if (existing?.id) {
    const detail = await apiJson(token, "GET", `/customer/databases/${existing.id}`);
    return { id: detail.id, connectionString: detail.connection_string };
  }
  const created = await apiJson(token, "POST", "/customer/databases", { name });
  return { id: created.id, connectionString: created.connection_string };
}

async function applySchema(token, dbId, sqlText) {
  await apiJson(token, "POST", `/customer/databases/${dbId}/sql`, { file_content: sqlText });
}

function vercelEnvAdd(name, environment, value) {
  return spawnSync("npx", ["vercel@latest", "env", "add", name, environment, "--force"], {
    cwd: root,
    input: value.endsWith("\n") ? value : `${value}\n`,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
}

async function main() {
  const { skipVercel, name } = parseArgs(process.argv.slice(2));
  let token = process.env.DB9_API_KEY?.trim();
  if (!token) {
    console.error(
      "[db9-provision] No DB9_API_KEY — using anonymous register. For production, prefer: db9 login → db9 token show → DB9_API_KEY=... node scripts/db9-provision.mjs",
    );
    token = await anonymousToken();
  }

  console.error(`[db9-provision] Ensuring database "${name}"…`);
  const { id, connectionString } = await ensureDatabase(token, name);
  if (!connectionString?.trim()) {
    throw new Error("No connection_string from DB9 API");
  }

  const schemaPath = path.join(root, SCHEMA_REL);
  const sqlText = fs.readFileSync(schemaPath, "utf8");
  console.error(`[db9-provision] Applying ${SCHEMA_REL}…`);
  await applySchema(token, id, sqlText);
  console.error("[db9-provision] Schema applied.");

  if (skipVercel) {
    console.error("[db9-provision] --skip-vercel: add this value to Vercel as DB9_DATABASE_URL (Production):");
    console.log(connectionString.trim());
    return;
  }

  console.error("[db9-provision] Setting Vercel DB9_DATABASE_URL (production)…");
  const add = vercelEnvAdd("DB9_DATABASE_URL", "production", connectionString.trim());
  if (add.status !== 0) {
    console.error("[db9-provision] vercel env add failed — set DB9_DATABASE_URL manually in the dashboard.");
    process.exit(1);
  }

  console.error("[db9-provision] Removing legacy TIDB_DATABASE_URL if a replacement exists…");
  const rmLegacy = spawnSync("node", [path.join(__dirname, "vercel-remove-tidb-legacy.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (rmLegacy.status !== 0) {
    console.error("[db9-provision] vercel-remove-tidb-legacy exited non-zero (safe to ignore if TIDB was already removed).");
  }

  console.error("[db9-provision] Done. Redeploy production on Vercel if the app does not pick up new env immediately.");
}

main().catch((e) => {
  console.error("[db9-provision] Error:", e.message || e);
  process.exit(1);
});
