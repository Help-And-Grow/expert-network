#!/usr/bin/env node
/**
 * Copy NEXTAUTH_SECRET → AUTH_SECRET on Vercel (Auth.js v5 naming), then remove NEXTAUTH_SECRET.
 * Does not print secret values.
 *
 * Usage (from repo root, linked project):
 *   node scripts/vercel-migrate-auth-secret.mjs
 *
 * Requires: npx vercel, logged in, project linked.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const environments = ["production", "preview", "development"];

function parseNextAuthSecret(dotenvText) {
  for (const line of dotenvText.split("\n")) {
    if (!line.startsWith("NEXTAUTH_SECRET=")) continue;
    let v = line.slice("NEXTAUTH_SECRET=".length).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v.replace(/\\n$/, "").trim();
  }
  return null;
}

function pullEnv(environment) {
  const tmp = path.join(os.tmpdir(), `vercel-pull-${environment}-${Date.now()}.env`);
  const r = spawnSync(
    "npx",
    ["vercel@latest", "env", "pull", tmp, `--environment=${environment}`, "--yes"],
    { cwd: root, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] },
  );
  if (r.status !== 0) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { error: r.stderr || r.stdout || `pull failed (${r.status})` };
  }
  const text = fs.readFileSync(tmp, "utf8");
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  return { text };
}

function vercelEnvAdd(name, environment, value) {
  return spawnSync("npx", ["vercel@latest", "env", "add", name, environment, "--force"], {
    cwd: root,
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
}

function vercelEnvRm(name, environment) {
  return spawnSync("npx", ["vercel@latest", "env", "rm", name, environment, "--yes"], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
}

let exit = 0;
for (const env of environments) {
  const { text, error } = pullEnv(env);
  if (error) {
    console.error(`[skip ${env}] pull:`, error.trim());
    continue;
  }
  const secret = parseNextAuthSecret(text);
  if (!secret) {
    console.log(`[skip ${env}] no NEXTAUTH_SECRET in pull`);
    continue;
  }
  const add = vercelEnvAdd("AUTH_SECRET", env, secret);
  if (add.status !== 0) {
    console.error(`[fail] AUTH_SECRET add (${env})`);
    exit = 1;
    continue;
  }
  console.log(`[ok] AUTH_SECRET set (${env})`);
  const rm = vercelEnvRm("NEXTAUTH_SECRET", env);
  if (rm.status !== 0) {
    console.error(`[fail] NEXTAUTH_SECRET rm (${env}) — remove manually or re-run`);
    exit = 1;
    continue;
  }
  console.log(`[ok] NEXTAUTH_SECRET removed (${env})`);
}

process.exit(exit);
