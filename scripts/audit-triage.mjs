#!/usr/bin/env node
/**
 * Production dependency audit (same as `npm run audit:omit-dev`).
 * Use in CI or locally when triaging advisories; fix with `npm audit fix` where safe,
 * or document accepted risk for transitive issues.
 */
import { spawnSync } from "node:child_process";

const r = spawnSync(
  "npm",
  ["audit", "--omit=dev"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(typeof r.status === "number" ? r.status : 1);
