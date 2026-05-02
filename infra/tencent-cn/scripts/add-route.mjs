#!/usr/bin/env node
/**
 * Idempotent HTTP route setup for the CN SCF.
 *
 * Looks up the env's default *.tcloudbase.com domain via `tcb domains ls`
 * and ensures a /* route forwards to the SCF function. Safe to re-run after
 * every deploy — "route already exists" is treated as success.
 *
 * Usage: add-route.mjs --tcb <tcb-binary> --env <env-file>
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) {
    throw new Error(`Missing --${name}`);
  }
  return process.argv[i + 1];
}

const tcb = resolve(arg("tcb"));
const envFile = resolve(arg("env"));

const env = {};
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i !== -1) env[t.slice(0, i)] = t.slice(i + 1);
}

const envId = env.TENCENT_CN_ENV_ID;
const fnName = env.TENCENT_CN_FN_NAME;
if (!envId || !fnName) {
  console.error("✖ TENCENT_CN_ENV_ID / TENCENT_CN_FN_NAME missing");
  process.exit(1);
}

console.log(`▶ Looking up default cloudbase domain for env ${envId} …`);
const raw = execSync(`${tcb} domains ls -e ${envId} --json`, {
  encoding: "utf8",
});
// Strip any leading spinner/progress lines before the JSON object
const i = raw.search(/[\[{]/);
const json = JSON.parse(raw.slice(i));
// tcb v3 returns { data: [...], meta: {...} }
// older versions returned { Domains: [...] } or a bare array
const list =
  (json.data && Array.isArray(json.data) ? json.data : null) ||
  json.Domains ||
  json.domains ||
  (Array.isArray(json) ? json : []);
const domain = list
  .map((d) => d.Domain || d.domain)
  .find((d) => typeof d === "string" && d.endsWith(".tcloudbase.com"));

if (!domain) {
  console.error("✖ Could not find default cloudbase domain");
  process.exit(1);
}
console.log(`  domain: ${domain}`);

const routeData = {
  domain,
  routes: [
    {
      path: "/*",
      upstreamResourceType: "WEB_SCF",
      upstreamResourceName: fnName,
      enable: true,
      enableAuth: false,
      enablePathTransmission: true,
    },
  ],
};

const edit = spawnSync(
  tcb,
  ["routes", "edit", "-e", envId, "--data", JSON.stringify(routeData)],
  { encoding: "utf8" },
);
const editOut = (edit.stdout || "") + (edit.stderr || "");
process.stdout.write(editOut);

if (edit.status === 0) {
  console.log(`\n✓ Deploy complete.`);
  console.log(`  WeChat CN endpoint: https://${domain}/`);
  console.log(`  Health check:       curl https://${domain}/api/health/origin`);
  process.exit(0);
}
if (!/不存在|not exist|not found|no route|missing/i.test(editOut)) {
  process.exit(edit.status || 1);
}

const result = spawnSync(
  tcb,
  ["routes", "add", "-e", envId, "--data", JSON.stringify(routeData)],
  { encoding: "utf8" },
);
const out = (result.stdout || "") + (result.stderr || "");
process.stdout.write(out);

if (result.status === 0) {
  console.log(`\n✓ Deploy complete.`);
  console.log(`  WeChat CN endpoint: https://${domain}/`);
  console.log(`  Health check:       curl https://${domain}/api/health/origin`);
  process.exit(0);
}
if (/已存在|already exists|exists/i.test(out)) {
  console.log("  route already exists — OK");
  console.log(`\n✓ Deploy complete.`);
  console.log(`  WeChat CN endpoint: https://${domain}/`);
  console.log(`  Health check:       curl https://${domain}/api/health/origin`);
  process.exit(0);
}
process.exit(result.status || 1);
