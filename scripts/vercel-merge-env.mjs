#!/usr/bin/env node
/**
 * Merge Vercel production env: copy shared config from origin (expert-network) onto
 * specific provider projects (AlibabaCloud, GoogleCloud, BytePlus).
 *
 * Usage:
 *   node scripts/vercel-merge-env.mjs <provider> <origin.env> <target.env> <out.env>
 * 
 * Example:
 *   node scripts/vercel-merge-env.mjs alibabacloud origin.env target.env merged.env
 */
import fs from "node:fs";

const PROVIDER = process.argv[2];
const originPath = process.argv[3];
const targetPath = process.argv[4];
const outPath = process.argv[5];

if (!PROVIDER || !originPath || !targetPath || !outPath) {
  console.error(
    "Usage: node scripts/vercel-merge-env.mjs <alibabacloud|googlecloud|byteplus> <origin.env> <target.env> <out.env>"
  );
  process.exit(1);
}

const PROVIDER_CONFIGS = {
  alibabacloud: {
    aiProvider: "qwen",
    voiceDefault: "qwen-voice",
    url: "https://expert-network-alibabacloud.vercel.app",
    keepPrefixes: ["DASHSCOPE_", "QWEN_", "FISH_AUDIO_"],
    skipFromOrigin: ["GEMINI_", "GOOGLE_CLOUD_", "GOOGLE_SERVICE_", "BYTEPLUS_"]
  },
  googlecloud: {
    aiProvider: "gemini",
    voiceDefault: "gemini-voice",
    url: "https://expert-network-googlecloud.vercel.app",
    keepPrefixes: ["GEMINI_", "GOOGLE_CLOUD_", "GOOGLE_SERVICE_", "FISH_AUDIO_", "ZAI_", "DASHSCOPE_"],
    skipFromOrigin: ["QWEN_", "BYTEPLUS_"]
  },
  byteplus: {
    aiProvider: "byteplus",
    voiceDefault: "byteplus-voice",
    url: "https://expert-network-byteplus.vercel.app",
    keepPrefixes: ["BYTEPLUS_", "FISH_AUDIO_", "DASHSCOPE_"],
    skipFromOrigin: ["QWEN_", "GEMINI_", "GOOGLE_CLOUD_", "GOOGLE_SERVICE_"]
  }
};

const config = PROVIDER_CONFIGS[PROVIDER];
if (!config) {
  console.error(`Unknown provider: ${PROVIDER}. Use alibabacloud, googlecloud, or byteplus.`);
  process.exit(1);
}

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

const origin = parseDotenvFile(fs.readFileSync(originPath, "utf8"));
const target = parseDotenvFile(fs.readFileSync(targetPath, "utf8"));

const merged = { ...origin };

// Remove keys that belong to other providers from the origin dump
for (const k of Object.keys(merged)) {
  for (const skipPrefix of config.skipFromOrigin) {
    if (k.startsWith(skipPrefix)) {
      delete merged[k];
    }
  }
}

// Force the target URL and Provider
merged.NEXTAUTH_URL = config.url;
merged.AI_PROVIDER = config.aiProvider;
merged.VOICE_CHAT_DEFAULT_VOICE = config.voiceDefault;

// Restore the provider-specific keys from the target's existing env
for (const k of Object.keys(target)) {
  for (const keepPrefix of config.keepPrefixes) {
    if (k.startsWith(keepPrefix)) {
      merged[k] = target[k];
    }
  }
}

// Ensure Auth secrets carry over properly
const auth = origin.AUTH_SECRET ?? target.AUTH_SECRET ?? target.NEXTAUTH_SECRET;
if (auth) {
  merged.AUTH_SECRET = auth;
  merged.NEXTAUTH_SECRET = auth;
}

// Target-only keys (e.g. Vercel admin / deploy hook) not present on origin
for (const k of Object.keys(target)) {
  if (!Object.prototype.hasOwnProperty.call(merged, k)) {
    // Only copy if it's not explicitly skipped
    const shouldSkip = config.skipFromOrigin.some(prefix => k.startsWith(prefix));
    if (!shouldSkip) {
      merged[k] = target[k];
    }
  }
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
  `# Merged for expert-network-${PROVIDER}: shared with expert-network + ${PROVIDER} config preserved.\n` +
  "# Do not commit. Apply: node scripts/vercel-env-from-file.mjs production <this-file>\n" +
  keys.map((k) => `${k}=${escapeForDotenv(merged[k])}`).join("\n") +
  "\n";

fs.writeFileSync(outPath, body, "utf8");
console.log(`Wrote ${keys.length} keys → ${outPath}`);
