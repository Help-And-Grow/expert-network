/**
 * Run wechat-upload.js under Node 20 (miniprogram-ci breaks on Node 23+).
 * Usage: node scripts/run-wechat-upload.cjs [version] [desc]
 * Defaults: version from wechat/package.json, desc from WECHAT_UPLOAD_DESC or "Help & Grow v{version}".
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "wechat/package.json"), "utf8"));
const version = process.argv[2] || pkg.version;
const desc =
  process.argv[3] ||
  process.env.WECHAT_UPLOAD_DESC ||
  `Help & Grow v${version}`;
const script = path.join(root, "scripts/wechat-upload.js");

const r = spawnSync("npx", ["-y", "node@20", script, version, desc], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status === null ? 1 : r.status);
