#!/usr/bin/env node
/**
 * Region-aware Taro build entrypoint.
 *
 * Reads `build-config/<region>.json`, exports every entry as a TARO_APP_*
 * env var, patches `project.config.json` with the region AppID, then runs
 * `taro build --type weapp`. Output is written under `dist/<region>/`.
 *
 * Usage:
 *   node scripts/build-region.mjs cn
 *   node scripts/build-region.mjs intl
 *
 * Wired up via `npm run build:weapp:cn` / `npm run build:weapp:intl`.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const projectConfigPath = resolve(repoRoot, "project.config.json");

const region = (process.argv[2] || "").toLowerCase();
if (region !== "cn" && region !== "intl") {
  console.error(
    `Usage: node scripts/build-region.mjs <cn|intl>\n` +
      `Got: "${process.argv[2]}".\n` +
      `Pick the region matching the WeChat MP appId you're building for.`,
  );
  process.exit(2);
}

const configPath = resolve(repoRoot, "build-config", `${region}.json`);
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (err) {
  console.error(`Failed to read ${configPath}:`, err.message);
  process.exit(2);
}

// --- Patch project.config.json with region-specific AppID ---
let originalAppId = null;
if (config.TARO_APP_APPID) {
  try {
    const projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf8"));
    originalAppId = projectConfig.appid;
    projectConfig.appid = config.TARO_APP_APPID;
    writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + "\n");
    console.log(
      `[build-region] Patched project.config.json appid: ${originalAppId} → ${config.TARO_APP_APPID}`,
    );
    // Restore on exit so git working tree stays clean
    const restore = () => {
      if (originalAppId) {
        try {
          const cfg = JSON.parse(readFileSync(projectConfigPath, "utf8"));
          cfg.appid = originalAppId;
          writeFileSync(projectConfigPath, JSON.stringify(cfg, null, 2) + "\n");
          console.log(`[build-region] Restored project.config.json appid: ${originalAppId}`);
        } catch { /* ignore */ }
      }
    };
    process.on("exit", restore);
    process.on("SIGINT", () => { restore(); process.exit(130); });
    process.on("SIGTERM", () => { restore(); process.exit(143); });
  } catch (err) {
    console.error(`Failed to patch project.config.json:`, err.message);
    process.exit(2);
  }
}

const env = { ...process.env };
for (const [key, value] of Object.entries(config)) {
  if (key.startsWith("_")) continue;
  env[key] = String(value);
}

// Per-region output directory keeps both builds side-by-side for review.
env.TARO_BUILD_PROJECT_OUTPUT_ROOT = resolve(repoRoot, "dist", region);

console.log(`[build-region] region=${region}`);
console.log(`[build-region] TARO_APP_API_BASE=${env.TARO_APP_API_BASE}`);
console.log(`[build-region] output: ${env.TARO_BUILD_PROJECT_OUTPUT_ROOT}`);

const child = spawn("npx", ["taro", "build", "--type", "weapp"], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
