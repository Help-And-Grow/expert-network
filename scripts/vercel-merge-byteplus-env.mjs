#!/usr/bin/env node
/**
 * Merge Vercel production env: copy shared config from origin (expert-network) onto
 * the BytePlus version (expert-network-byteplus), preserving provider keys + byteplus URL.
 *
 * Prerequisites: pull both projects first, e.g.
 *   vercel link --project expert-network --yes --scope <team>
 *   vercel env pull /tmp/vercel-origin-production.env --environment production --yes
 *   vercel link --project expert-network-byteplus --yes --scope <team>
 *   vercel env pull /tmp/vercel-byteplus-production.env --environment production --yes
 *
 * Usage:
 *   node scripts/vercel-merge-byteplus-env.mjs /tmp/vercel-origin-production.env /tmp/vercel-byteplus-production.env /tmp/vercel-byteplus-merged.env
 */
import fs from "node:fs";

const HACKATHON_CANONICAL_URL = "https://expert-network-byteplus.vercel.app";

/** Vercel runtime / pull artifacts — never push these via `vercel env add`. */
function isVercelSystemKey(k) {
  if (k.startsWith("VERCEL_GIT_")) return true;
  if (
    k === "VERCEL_URL" ||
    k === "VERCEL_ENV" ||
    k === "VERCEL_TARGET_ENV" ||
    k === "VERCEL_OIDC_TOKEN"
  ) {
    return true;
  }
  if (k.startsWith("VERCEL_") && !VERCEL_APP_CONFIG.has(k)) return true;
  return false;
}

const VERCEL_APP_CONFIG = new Set([
  "VERCEL_MANAGEMENT_TOKEN",
  "VERCEL_MANAGED_TEAM_ID",
  "VERCEL_MANAGED_PROJECT",
  "VERCEL_DEPLOY_HOOK_URL",
]);

/** Do not copy these from origin → hackathon (Alibaba / legacy). */
const SKIP_FROM_ORIGIN = new Set([
  "DASHSCOPE_API_KEY",
  "DB9_DATABASE_URL",
  "DB_PROVIDER",
]);

/** Keep hackathon’s values (Gemini / Vertex / local toggles). */
const PRESERVE_FROM_HACKATHON = new Set([
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_TEXT_MODEL",
  "GEMINI_IMAGE_MODEL",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "ZAI_TEXT_MODEL",
  "ZAI_VERTEX_LOCATION",
  "REALTIME_BACKEND",
]);

function parseDotenvFile(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
      val = val.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"');
    }
    out[key] = val;
  }
  return out;
}

function escapeForDotenv(val) {
  const s = String(val);
  if (/[\n\r"#=]/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
  }
  return s;
}

const originPath = process.argv[2];
const hackathonPath = process.argv[3];
const outPath = process.argv[4];

if (!originPath || !hackathonPath || !outPath) {
  console.error(
    "Usage: node scripts/vercel-merge-hackathon-env.mjs <origin.env> <hackathon.env> <out.env>",
  );
  process.exit(1);
}

const origin = parseDotenvFile(fs.readFileSync(originPath, "utf8"));
const hackathon = parseDotenvFile(fs.readFileSync(hackathonPath, "utf8"));

const merged = { ...origin };

for (const k of SKIP_FROM_ORIGIN) {
  delete merged[k];
}

for (const k of PRESERVE_FROM_HACKATHON) {
  if (Object.prototype.hasOwnProperty.call(hackathon, k)) {
    merged[k] = hackathon[k];
  }
}

merged.NEXTAUTH_URL = HACKATHON_CANONICAL_URL.trim();
merged.AI_PROVIDER = "byteplus";
merged.VOICE_CHAT_DEFAULT_VOICE = "byteplus-voice";

for (const k of Object.keys(hackathon)) {
  // Preserve byteplus/gemini config
  if (
    k.startsWith("BYTEPLUS_") ||
    k.startsWith("GEMINI_") ||
    k.startsWith("GOOGLE_CLOUD_") ||
    k.startsWith("GOOGLE_SERVICE_") ||
    k.startsWith("FISH_AUDIO_")
  ) {
    merged[k] = hackathon[k];
  }
}

const auth = origin.AUTH_SECRET ?? hackathon.AUTH_SECRET ?? hackathon.NEXTAUTH_SECRET;
if (auth) {
  merged.AUTH_SECRET = auth;
  merged.NEXTAUTH_SECRET = auth;
}

// Hackathon-only keys (e.g. Vercel admin / deploy hook) not present on origin
for (const k of Object.keys(hackathon)) {
  if (SKIP_FROM_ORIGIN.has(k)) continue;
  if (!Object.prototype.hasOwnProperty.call(merged, k)) {
    merged[k] = hackathon[k];
  }
}

for (const k of SKIP_FROM_ORIGIN) {
  delete merged[k];
}

const keys = Object.keys(merged)
  .filter((k) => !isVercelSystemKey(k))
  .filter((k) => {
    const v = merged[k];
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  })
  .sort();

const body =
  "# Merged for expert-network-byteplus: shared with expert-network + BytePlus/Gemini/GCP preserved.\n" +
  "# Do not commit. Apply: node scripts/vercel-env-from-file.mjs production <this-file>\n" +
  keys.map((k) => `${k}=${escapeForDotenv(merged[k])}`).join("\n") +
  "\n";

fs.writeFileSync(outPath, body, "utf8");
console.log(`Wrote ${keys.length} keys → ${outPath}`);
