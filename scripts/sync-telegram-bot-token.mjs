#!/usr/bin/env node
/**
 * Set TELEGRAM_BOT_TOKEN locally (.env.local) and on Vercel (production + preview).
 *
 * Prerequisites:
 *   - `npx vercel login` (once)
 *   - `npx vercel link` in repo root (creates .vercel/)
 *
 * Usage (token only in your shell — never commit):
 *   export TELEGRAM_BOT_TOKEN="123456:ABC-..."
 *   npm run vercel:env:telegram
 *
 * Optional: also sync Telegram Pay provider token:
 *   export TELEGRAM_PAYMENT_PROVIDER_TOKEN="..."
 *   npm run vercel:env:telegram
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envLocalPath = path.join(root, ".env.local");
const vercelProject = path.join(root, ".vercel", "project.json");

const OPTIONAL_KEYS = ["TELEGRAM_PAYMENT_PROVIDER_TOKEN"];

function upsertEnvLocal(filePath, key, value) {
  const line = `${key}=${value}`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      `# Local secrets (gitignored). See .env.example for all keys.\n${line}\n`,
      "utf8",
    );
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}=`);
  let found = false;
  const next = lines.map((ln) => {
    if (re.test(ln)) {
      found = true;
      return line;
    }
    return ln;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(line);
  }
  fs.writeFileSync(next.join("\n").replace(/\n+$/, "\n"), "utf8");
}

function vercelEnvAdd(key, target, value) {
  const r = spawnSync(
    "npx",
    [
      "vercel@latest",
      "env",
      "add",
      key,
      target,
      "--yes",
      "--sensitive",
      "--force",
    ],
    {
      cwd: root,
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (r.status !== 0) {
    console.error(`[fail] ${key} → ${target} (exit ${r.status ?? "unknown"})`);
    process.exit(r.status ?? 1);
  }
  console.log(`[ok] ${key} → Vercel (${target})`);
}

const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!botToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Example:");
  console.error(
    '  export TELEGRAM_BOT_TOKEN="123456:ABC-..." && npm run vercel:env:telegram',
  );
  process.exit(1);
}

upsertEnvLocal(envLocalPath, "TELEGRAM_BOT_TOKEN", botToken);
console.log(`[ok] TELEGRAM_BOT_TOKEN → ${envLocalPath}`);

for (const opt of OPTIONAL_KEYS) {
  const v = process.env[opt]?.trim();
  if (!v) continue;
  upsertEnvLocal(envLocalPath, opt, v);
  console.log(`[ok] ${opt} → ${envLocalPath}`);
}

if (!fs.existsSync(vercelProject)) {
  console.error("");
  console.error("Local file updated. Skipping Vercel: no .vercel/project.json.");
  console.error("Link this repo, then re-run to push secrets:");
  console.error(`  cd ${root} && npx vercel@latest link`);
  console.error("  npm run vercel:env:telegram");
  process.exit(1);
}

for (const target of ["production", "preview"]) {
  vercelEnvAdd("TELEGRAM_BOT_TOKEN", target, botToken);
}

for (const opt of OPTIONAL_KEYS) {
  const v = process.env[opt]?.trim();
  if (!v) continue;
  for (const target of ["production", "preview"]) {
    vercelEnvAdd(opt, target, v);
  }
}

console.log("Done.");
