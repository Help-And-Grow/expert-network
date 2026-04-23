#!/usr/bin/env node
/**
 * Lists variable NAMES only (no values) from Vercel-pulled .env files for safe comparison.
 * Usage: node scripts/vercel-env-list-keys.mjs
 *
 * Vercel-injected vs app keys: see docs/references/vercel-environments-solo-pm.md
 */

import fs from "fs";
import path from "path";

const root = process.cwd();
const files = [
  ".env.vercel.local",
  ".env.vercel.development.local",
  ".env.vercel.preview.local",
  ".env.vercel.production.local",
];

function parseKeys(content) {
  const keys = new Set();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    keys.add(trimmed.slice(0, eq).trim());
  }
  return keys;
}

const byFile = {};
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) {
    byFile[f] = null;
    continue;
  }
  byFile[f] = parseKeys(fs.readFileSync(p, "utf8"));
}

console.log("Vercel env files — variable NAMES only (values hidden)\n");

const allKeys = new Set();
for (const f of files) {
  const set = byFile[f];
  if (!set) {
    console.log(`--- ${f} (missing) ---\n`);
    continue;
  }
  set.forEach((k) => allKeys.add(k));
  const sorted = [...set].sort();
  console.log(`--- ${f} (${sorted.length} keys) ---`);
  sorted.forEach((k) => console.log(`  ${k}`));
  console.log("");
}

// Summary: keys unique to one file
const presentFiles = files.filter((f) => byFile[f] && byFile[f].size > 0);
if (presentFiles.length >= 2) {
  console.log("--- Keys only in ONE file (hint: env scope differences) ---\n");
  for (const f of presentFiles) {
    const set = byFile[f];
    const onlyHere = [...set].filter((k) => {
      return presentFiles.every((other) => {
        if (other === f) return true;
        return !byFile[other].has(k);
      });
    });
    if (onlyHere.length) {
      console.log(`${f}:`);
      onlyHere.sort().forEach((k) => console.log(`  ${k}`));
      console.log("");
    }
  }
}
