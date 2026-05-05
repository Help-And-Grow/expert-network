/**
 * Run wechat-upload.js under Node 20 (miniprogram-ci breaks on Node 23+).
 * Usage: node scripts/run-wechat-upload.cjs [version] [desc]
 * Defaults: version from wechat/package.json, desc from WECHAT_UPLOAD_DESC or "Help & Grow v{version}".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Corporate-network TLS quirk
 * ─────────────────────────────────────────────────────────────────────────
 * `npx -y node@20` ships its own CA bundle (Mozilla list only). On corp networks
 * that MITM TLS (Zscaler, Netskope, Palo Alto, ZTNA proxies, ...) the WeChat CI
 * call to https://servicewechat.com fails with `unable to get local issuer
 * certificate` even though `curl` works (curl uses macOS system keychain).
 *
 * Resolution order for the extra root cert(s):
 *   1. WECHAT_CI_EXTRA_CA_CERTS env var — explicit override, any platform.
 *   2. .local-certs/extra-ca.pem — gitignored cache; drop your corp root here
 *      manually if you're on Linux/Windows or want to avoid keychain scans.
 *   3. macOS auto-extract — scan System.keychain for known TLS-inspection root
 *      certs (Zscaler, Netskope, Palo Alto, Bluecoat/Symantec, Forcepoint,
 *      Cisco, Sophos, Fortinet, McAfee). Cached at .local-certs/extra-ca.pem
 *      on first hit so subsequent runs skip the keychain scan.
 *
 * Set WECHAT_CI_DISABLE_AUTO_CA=1 to disable the macOS auto-scan entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Normal-network safety
 * ─────────────────────────────────────────────────────────────────────────
 * On a machine without any corp proxy cert installed (e.g. a personal laptop
 * on home Wi-Fi), step 3 finds nothing → returns null → NODE_EXTRA_CA_CERTS
 * stays UNSET and Node 20 validates servicewechat.com via the bundled Mozilla
 * CA list (the real Tencent cert chain). No behavior change vs. the original
 * script.
 *
 * If a corp proxy cert IS in the keychain but you happen to be off-corp at
 * runtime (e.g. moved laptops to home Wi-Fi), Node still works correctly:
 * NODE_EXTRA_CA_CERTS *augments* the trust store rather than replacing it,
 * so real Tencent certs still validate via Mozilla while the corp root sits
 * unused. You don't have to clear .local-certs/ when you change networks.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "wechat/package.json"), "utf8"));
const version = process.argv[2] || pkg.version;
const desc =
  process.argv[3] ||
  process.env.WECHAT_UPLOAD_DESC ||
  `Help & Grow v${version}`;
const script = path.join(root, "scripts/wechat-upload.js");

/**
 * Try to make Node 20 trust the corp-network MITM root cert.
 * Returns the path of a CA bundle file, or null if no extra cert is needed/found.
 */
function resolveExtraCaCerts() {
  // 1. Explicit override (any OS)
  if (process.env.WECHAT_CI_EXTRA_CA_CERTS) {
    if (fs.existsSync(process.env.WECHAT_CI_EXTRA_CA_CERTS)) {
      return process.env.WECHAT_CI_EXTRA_CA_CERTS;
    }
    console.warn(
      `[wechat-upload] WECHAT_CI_EXTRA_CA_CERTS set but file not found: ${process.env.WECHAT_CI_EXTRA_CA_CERTS}`,
    );
  }

  // 2. Project-local cached bundle (any OS — manually drop your corp root here)
  const cached = path.join(root, ".local-certs/extra-ca.pem");
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) {
    return cached;
  }

  // 3. macOS auto-extract from System keychain
  if (os.platform() !== "darwin") return null;
  if (process.env.WECHAT_CI_DISABLE_AUTO_CA === "1") return null;

  const keychain = "/Library/Keychains/System.keychain";
  // Common enterprise TLS-inspection products. Add more here as needed.
  const corpRootNames = [
    "Zscaler",
    "Netskope",
    "Palo Alto",
    "Bluecoat",
    "Symantec",
    "Forcepoint",
    "Cisco",
    "Sophos",
    "Fortinet",
    "McAfee",
  ];

  let collected = "";
  for (const name of corpRootNames) {
    const r = spawnSync("security", ["find-certificate", "-a", "-c", name, "-p", keychain], {
      encoding: "utf8",
    });
    if (r.status === 0 && r.stdout.includes("BEGIN CERTIFICATE")) {
      collected += r.stdout;
    }
  }

  if (!collected) {
    // Normal-network case: no corp proxy detected. Return null so we don't
    // touch NODE_EXTRA_CA_CERTS — Node 20 will use its bundled Mozilla CAs.
    return null;
  }

  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, collected, { mode: 0o600 });
  console.log(
    `[wechat-upload] Detected corporate TLS-inspection root cert(s) in macOS ` +
      `keychain; extracted to ${path.relative(root, cached)} so Node 20 can ` +
      `validate the WeChat CI endpoint. Set WECHAT_CI_DISABLE_AUTO_CA=1 to ` +
      `opt out of this scan.`,
  );
  return cached;
}

const extraCa = resolveExtraCaCerts();
const env = { ...process.env };
if (extraCa) {
  env.NODE_EXTRA_CA_CERTS = extraCa;
}

const r = spawnSync("npx", ["-y", "node@20", script, version, desc], {
  cwd: root,
  stdio: "inherit",
  env,
});
process.exit(r.status === null ? 1 : r.status);
