#!/usr/bin/env node
/**
 * Set TELEGRAM_BOT_TOKEN locally (.env.local) and on Vercel (production + preview),
 * then re-register the production webhook against the (possibly new) token.
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
 *
 * Optional: override the webhook URL (defaults to canonical prod):
 *   export TELEGRAM_WEBHOOK_URL="https://www.help-and-grow.com/api/webhooks/telegram"
 *
 * Skip the webhook step entirely (e.g. testing local-only token sync):
 *   export TELEGRAM_SKIP_SET_WEBHOOK=1
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

const DEFAULT_WEBHOOK_URL =
  "https://www.help-and-grow.com/api/webhooks/telegram";

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
  fs.writeFileSync(filePath, next.join("\n").replace(/\n+$/, "\n"), "utf8");
}

async function tgApi(token, method, query = "") {
  const url = `https://api.telegram.org/bot${token}/${method}${query}`;
  const res = await fetch(url, { method: "POST" });
  let body;
  try {
    body = await res.json();
  } catch {
    body = { ok: false, description: `non-JSON response (${res.status})` };
  }
  return body;
}

async function registerWebhook(token, webhookUrl) {
  const setRes = await tgApi(
    token,
    "setWebhook",
    `?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=false`,
  );
  if (!setRes.ok) {
    console.error(
      `[fail] setWebhook → ${webhookUrl}: ${setRes.description ?? "unknown error"}`,
    );
    process.exit(1);
  }
  console.log(`[ok] setWebhook → ${webhookUrl}`);

  const info = await tgApi(token, "getWebhookInfo");
  if (!info.ok) {
    console.error(
      `[warn] getWebhookInfo failed: ${info.description ?? "unknown error"}`,
    );
    return;
  }
  const r = info.result ?? {};
  console.log(
    `[ok] getWebhookInfo: url=${r.url} pending=${r.pending_update_count ?? 0}` +
      (r.last_error_message ? ` last_error="${r.last_error_message}"` : ""),
  );
  if (r.last_error_message) {
    console.error(
      "[warn] Telegram reports a recent webhook delivery error — check the route is reachable and returns 200.",
    );
  }
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

// Re-register the Telegram webhook against the (possibly new) token.
// If you skip this and the token was rotated, the bot will silently stop
// receiving updates: /start does nothing, expert telegramId back-fill stops,
// and notifyExpertBooking() bails at resolveChatId().
if (process.env.TELEGRAM_SKIP_SET_WEBHOOK === "1") {
  console.log("[skip] setWebhook (TELEGRAM_SKIP_SET_WEBHOOK=1)");
} else {
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim() || DEFAULT_WEBHOOK_URL;
  await registerWebhook(botToken, webhookUrl);
}

console.log("Done.");
