#!/usr/bin/env bash
# Build and deploy the Next.js standalone app to Tencent SCF, then expose it via
# the TCB env's default cloudbase domain.
#
# Run from repo root: `npm run cn:deploy`
#
# Pipeline:
#   1. next build (output: standalone) + prisma generate (Linux engines)
#   2. Assemble infra/tencent-cn/build/scf-cn/ — standalone server + static
#      + public + scf_bootstrap that just starts Next.js
#   3. tcb fn deploy hg-app-cn --httpFn --force (with cloudbaserc.json)
#   4. tcb routes add — bind /api on the cloudbase domain to the SCF (idempotent)
#
# DB migrations are applied separately via `npm run cn:migrate` from the
# user's laptop with TencentDB 外网 access temporarily opened. Bundling the
# Prisma CLI into the SCF would add ~22 MB and the upload to ap-shanghai
# would routinely time out from outside China.
#
# Re-running this script is safe: --force overwrites the function and the
# CLI patches are idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="$REPO_ROOT/infra/tencent-cn/.env.cn"
BUNDLE_DIR="$REPO_ROOT/infra/tencent-cn/build/scf-cn"

if [ ! -f "$ENV_FILE" ]; then
  echo "✖ infra/tencent-cn/.env.cn not found — copy from .env.cn.example" >&2
  exit 1
fi

# Read .env.cn via a Node parser (not bash `source`) so values containing
# `$`, `#`, `!`, smart quotes, etc. are preserved verbatim.
read_env_var() {
  node -e '
    const fs = require("fs");
    const content = fs.readFileSync(process.argv[1], "utf8");
    const re = new RegExp("^" + process.argv[2] + "=(.*)$", "m");
    const m = content.match(re);
    if (!m) process.exit(0);
    let v = m[1].trim();
    if ((v.startsWith("\"") && v.endsWith("\"")) ||
        (v.startsWith("'\''") && v.endsWith("'\''"))) {
      v = v.slice(1, -1);
    }
    process.stdout.write(v);
  ' "$ENV_FILE" "$1"
}

DATABASE_URL_CN="$(read_env_var DATABASE_URL_CN)"
TENCENT_CN_ENV_ID="$(read_env_var TENCENT_CN_ENV_ID)"
TENCENT_CN_REGION="$(read_env_var TENCENT_CN_REGION)"
TENCENT_CN_FN_NAME="$(read_env_var TENCENT_CN_FN_NAME)"
TENCENT_COS_SECRET_ID="$(read_env_var TENCENT_COS_SECRET_ID)"
TENCENT_COS_SECRET_KEY="$(read_env_var TENCENT_COS_SECRET_KEY)"
TENCENT_CN_COS_BUCKET="$(read_env_var TENCENT_CN_COS_BUCKET)"
TENCENT_CN_COS_REGION="$(read_env_var TENCENT_CN_COS_REGION)"
HUNYUAN_API_KEY="$(read_env_var HUNYUAN_API_KEY)"
NEXTAUTH_SECRET="$(read_env_var NEXTAUTH_SECRET)"
WECHAT_APP_ID="$(read_env_var WECHAT_APP_ID)"
WECHAT_APP_SECRET="$(read_env_var WECHAT_APP_SECRET)"

require() {
  if [ -z "${!1:-}" ]; then
    echo "✖ $1 is empty in infra/tencent-cn/.env.cn" >&2
    exit 1
  fi
}
for v in DATABASE_URL_CN TENCENT_CN_ENV_ID TENCENT_CN_FN_NAME \
         TENCENT_COS_SECRET_ID TENCENT_COS_SECRET_KEY TENCENT_CN_COS_BUCKET \
         HUNYUAN_API_KEY NEXTAUTH_SECRET WECHAT_APP_ID WECHAT_APP_SECRET; do
  require "$v"
done

# Resolve the local tcb CLI — install once if missing. infra/tencent-cn/package.json
# pins @cloudbase/cli, so `npm install` in that dir lands the binary at
# infra/tencent-cn/node_modules/.bin/tcb regardless of any parent package.json.
TCB_DIR="$REPO_ROOT/infra/tencent-cn"
TCB_BIN="$TCB_DIR/node_modules/.bin/tcb"
if [ ! -x "$TCB_BIN" ]; then
  echo "▶ Installing @cloudbase/cli locally …"
  (cd "$TCB_DIR" && npm install --silent --no-package-lock)
fi
if [ ! -x "$TCB_BIN" ]; then
  echo "✖ tcb CLI install failed — expected at $TCB_BIN" >&2
  echo "  Try manually: (cd $TCB_DIR && npm install)" >&2
  exit 1
fi

# Patch two well-known bugs in the local @cloudbase/cli before running deploy:
#
#   1. Hardcoded 60 s COS upload timeout — bundles >50 MB hit this routinely.
#      Fix: bump to 600 s (10 min).
#
#   2. The COS upload uses one-shot temp credentials from GetTempCosInfo. The
#      Sign object is reused for every chunk of the multipart upload, but
#      individual signatures are short-lived (~60 s). On a slow link to
#      ap-shanghai the latter chunks fail with `Request has expired
#      (AccessDenied)`. Fix: patch `getAuthorization` to refresh Sign by
#      re-calling GetTempCosInfo when the cached one is older than 25 s.
#
# Both patches are idempotent.
TCB_CLI_JS="$TCB_DIR/node_modules/@cloudbase/cli/dist/standalone/cli.js"
if [ -f "$TCB_CLI_JS" ]; then
  python3 - "$TCB_CLI_JS" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

orig = c
patched = []

# Patch 1: COS upload timeout 60 s → 1800 s (30 min). Slow international links
# to ap-shanghai routinely upload at 50-200 KB/s; combined with the
# Sign-refresh patch below, this keeps the upload alive long enough.
old_to_60 = 'reject(new error_1.CloudBaseError(`[${func.name}] COS 上传超时（60秒）`));\n            }, 60000);'
old_to_600 = 'reject(new error_1.CloudBaseError(`[${func.name}] COS 上传超时（60秒）`));\n            }, 600000);'
new_to     = 'reject(new error_1.CloudBaseError(`[${func.name}] COS 上传超时（60秒）`));\n            }, 1800000);'
for old_to in (old_to_60, old_to_600):
    if old_to in c:
        c = c.replace(old_to, new_to, 1)
        patched.append('upload timeout → 1800 s')
        break

# Patch 2: refresh Sign on each getAuthorization call (cache 25 s)
old_auth = '''const cos = new cos_nodejs_sdk_v5_1.default({
            getAuthorization: function (options, callback) {
                // 注入上一步获取的临时密钥
                callback(Sign);
            }
        });'''
new_auth = '''let _hgSign = Sign;
        let _hgSignAt = Date.now();
        const _hgScf = this.scfService;
        const _hgObj = objectPath;
        const cos = new cos_nodejs_sdk_v5_1.default({
            getAuthorization: async function (options, callback) {
                if (Date.now() - _hgSignAt > 25000) {
                    try {
                        const r = await _hgScf.request('GetTempCosInfo', { ObjectPath: _hgObj });
                        if (r && r.Sign) { _hgSign = r.Sign; _hgSignAt = Date.now(); }
                    } catch (e) { /* keep stale */ }
                }
                callback(_hgSign);
            }
        });'''
if old_auth in c:
    # Apply to ALL occurrences — webpack bundles two copies of uploadFunctionZipToCos
    n = c.count(old_auth)
    c = c.replace(old_auth, new_auth)
    patched.append(f'refresh Sign per request ({n} occurrence{"s" if n != 1 else ""})')

if c != orig:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)
    print('  ✓ Patched tcb CLI: ' + ', '.join(patched))
else:
    print('  tcb CLI already patched — skipping')
PYEOF
fi

cd "$REPO_ROOT"

# Clean any leftover SCF bundle FIRST. Otherwise tsc on the second run picks
# up partial source files from the previous bundle (`infra/tencent-cn/build/...`)
# and the build fails with module-resolution errors.
echo "▶ Cleaning previous SCF bundle …"
rm -rf "$BUNDLE_DIR"

# ─── 1. Build ────────────────────────────────────────────────────────────
echo "▶ Generating Prisma client (incl. Linux engines) …"
npx prisma generate --schema prisma/schema.prisma

echo "▶ Building Next.js (standalone) …"
npm run build

# ─── 2. Assemble bundle ──────────────────────────────────────────────────
echo "▶ Assembling SCF bundle at $BUNDLE_DIR …"
mkdir -p "$BUNDLE_DIR"
cp -R .next/standalone/. "$BUNDLE_DIR/"
mkdir -p "$BUNDLE_DIR/.next"
cp -R .next/static "$BUNDLE_DIR/.next/static"
# Next.js 15 standalone runtime imports next/dist/build/output/log.js from
# production server modules. Most builds trace this into .next/standalone, but
# keep an explicit fallback so the SCF bundle is deterministic across machines.
NEXT_DIST="$BUNDLE_DIR/node_modules/next/dist"
if [ ! -f "$NEXT_DIST/build/output/log.js" ] && [ -d node_modules/next/dist/build ]; then
  echo "  Restoring next/dist/build runtime files into standalone bundle …"
  mkdir -p "$NEXT_DIST"
  cp -R node_modules/next/dist/build "$NEXT_DIST/build"
fi
# Older experiments copied .next/build when present; harmless no-op on current
# Next.js 15 builds, where the required files live under node_modules/next/dist.
[ -d .next/build ] && cp -R .next/build "$BUNDLE_DIR/.next/build" || true
[ -d public ] && cp -R public "$BUNDLE_DIR/public" || true

# NOTE: Prisma CLI + migrations are NOT bundled into the SCF.
# Rationale:
#   - The CLI + schema engine WASM + supporting @prisma/* internals add ~22 MB,
#     which on a slow international link to ap-shanghai pushes upload past the
#     COS credential TTL window and the deploy fails.
#   - TencentDB CN's 外网 is normally closed, but we can open it briefly from
#     the user's laptop, run `npm run cn:migrate`, and close it again.
#   - The SCF only needs the Prisma *client* runtime (already in the standalone
#     trace via @prisma/client) to query the DB at request time.
# Workflow: run `npm run cn:migrate` whenever the schema changes (rare), then
# `npm run cn:deploy` for code-only changes (frequent).

# ── Bundle pruning ───────────────────────────────────────────────────────────
# The standalone tracer pulls in macOS-specific natives (sharp), build-time
# tools (babel, amphtml-validator, capsize fonts), and TS source we don't need.
# Stripping these gets the bundle from ~135 MB down to ~45 MB.
echo "▶ Pruning bundle …"

# 1. macOS Sharp binaries — traced from the macOS dev env but crash Linux SCF.
find "$BUNDLE_DIR/node_modules" \
  \( -path "*/@img/sharp-darwin*" -o -path "*/@img/sharp-libvips-darwin*" \) \
  \( -type f -o -type l \) -delete 2>/dev/null || true

# 2. Strip non-rhel Prisma engine binaries from @prisma/client (the runtime)
#    so we ship one platform binary per architecture at most.
find "$BUNDLE_DIR/node_modules/@prisma/client" \( \
    -name "*darwin*"  -o -name "*windows*" -o \
    -name "*musl*"    -o -name "*debian*" \
  \) \( -type f -o -type l \) -delete 2>/dev/null || true

# 3. TypeScript package — traced by build tooling, not needed at runtime
rm -rf "$BUNDLE_DIR/node_modules/typescript" 2>/dev/null || true

# 4. Prisma client TS source files — Next.js standalone uses the compiled
#    runtime from node_modules/@prisma/client; the .ts source is build-only.
rm -rf "$BUNDLE_DIR/src/generated" 2>/dev/null || true

# 5. Source maps in .next/server
find "$BUNDLE_DIR/.next" -name "*.js.map" -type f -delete 2>/dev/null || true

# 6. Next.js build-only tooling traced into standalone but never executed
#    by `node server.js`. Keep any modules required by Next's server startup
#    path; the runtime smoke below catches accidental over-pruning.
if [ -d "$NEXT_DIST" ]; then
  # NOTE: Keep $NEXT_DIST/build in the local bundle when available, but do not
  # depend on it surviving CloudBase's COS/SCF packaging. Live SCF has stripped
  # it before, causing:
  #   Error: Cannot find module '../build/output/log'
  # See: https://github.com/vercel/next.js/issues/64218
  # NOTE: Do NOT remove $NEXT_DIST/next-devtools — Next.js 15.5 server startup
  # imports next-devtools/server/shared from server/patch-error-inspect.js.
  # NOTE: Do NOT remove $NEXT_DIST/compiled/babel — next-devtools/server/shared
  # imports compiled/babel/code-frame during server startup.
  rm -rf "$NEXT_DIST/compiled/babel-packages"     2>/dev/null || true
  rm -rf "$NEXT_DIST/compiled/amphtml-validator"  2>/dev/null || true
  rm -rf "$NEXT_DIST/compiled/@vercel"            2>/dev/null || true
  rm -f  "$NEXT_DIST/server/capsize-font-metrics.json" 2>/dev/null || true
fi

if [ -d "$NEXT_DIST" ]; then
  node - "$NEXT_DIST" <<'NODE'
const { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = require("fs");
const { join } = require("path");

const nextDist = process.argv[2];
const shimDir = join(nextDist, "server");
mkdirSync(shimDir, { recursive: true });
writeFileSync(join(shimDir, "scf-output-log-shim.js"), `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prefixes = {
  wait: "...",
  error: "x",
  warn: "!",
  ready: ">",
  info: " ",
  event: "ok",
  trace: ">"
};
const seen = new Set();
function debug(...message) {
  if (process.env.SCF_NEXT_LOG_SHIM_DEBUG === "1" && message.length) {
    console.log(...message);
  }
}
function warn(...message) {
  if (message.length) console.warn(...message);
}
function error(...message) {
  if (message.length) console.error(...message);
}
function warnOnce(...message) {
  const key = message.join(" ");
  if (!seen.has(key)) {
    seen.add(key);
    warn(...message);
  }
}
exports.prefixes = prefixes;
exports.bootstrap = debug;
exports.wait = debug;
exports.error = error;
exports.warn = warn;
exports.ready = debug;
exports.info = debug;
exports.event = debug;
exports.trace = debug;
exports.warnOnce = warnOnce;
`);
writeFileSync(join(shimDir, "scf-transpile-config-shim.js"), `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transpileConfig = async function transpileConfig() {
  throw new Error("next.config.ts is not supported in the Tencent SCF bundle when next/dist/build is stripped. Use next.config.mjs for this deployment target.");
};
`);

const logReplacement = 'require("next/dist/server/scf-output-log-shim")';
const transpileConfigReplacement = 'require("next/dist/server/scf-transpile-config-shim")';
const relativeLogImport = /require\((['"])(?:\.\.\/)+build\/output\/log\1\)/g;
const absoluteLogImport = /require\((['"])next\/dist\/build\/output\/log\1\)/g;
const transpileConfigImport = /require\((['"])(?:\.\.\/)+build\/next-config-ts\/transpile-config\1\)/g;
let patchedFiles = 0;
let patchedRuntimeImports = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.endsWith(".js")) continue;
    const before = readFileSync(full, "utf8");
    let importsInFile = 0;
    const after = before
      .replace(relativeLogImport, () => {
        importsInFile += 1;
        return logReplacement;
      })
      .replace(absoluteLogImport, () => {
        importsInFile += 1;
        return logReplacement;
      })
      .replace(transpileConfigImport, () => {
        importsInFile += 1;
        return transpileConfigReplacement;
      });
    if (after !== before) {
      writeFileSync(full, after);
      patchedFiles += 1;
      patchedRuntimeImports += importsInFile;
    }
  }
}

walk(nextDist);
console.log(`  Patched ${patchedRuntimeImports} Next.js runtime import${patchedRuntimeImports === 1 ? "" : "s"} in ${patchedFiles} file${patchedFiles === 1 ? "" : "s"}`);
NODE
fi

run_next_runtime_smoke() {
  (
    cd "$BUNDLE_DIR"
    node -e "require('./node_modules/next/dist/server/next.js'); require('./node_modules/next/dist/server/lib/router-server.js')"
  )
}

if [ -d "$NEXT_DIST/build" ]; then
  NEXT_BUILD_SMOKE_BACKUP="$NEXT_DIST/build.__scf_smoke_backup"
  rm -rf "$NEXT_BUILD_SMOKE_BACKUP"
  mv "$NEXT_DIST/build" "$NEXT_BUILD_SMOKE_BACKUP"
  restore_next_build() {
    if [ -d "$NEXT_BUILD_SMOKE_BACKUP" ]; then
      mv "$NEXT_BUILD_SMOKE_BACKUP" "$NEXT_DIST/build"
    fi
  }
  trap restore_next_build EXIT
  run_next_runtime_smoke
  restore_next_build
  trap - EXIT
else
  run_next_runtime_smoke
fi
echo "  Next.js runtime module smoke: ok (without next/dist/build)"

echo "  Bundle size after prune: $(du -sh "$BUNDLE_DIR" | cut -f1)"

# scf_bootstrap: SCF Web Function entrypoint. Runs `prisma migrate deploy`
# (idempotent — no-op when schema is up to date) before starting Next.js.
# Migrations apply via TencentDB CN's 内网 endpoint, which the SCF can
# reach without 外网 access being open on the DB.
cat > "$BUNDLE_DIR/scf_bootstrap" <<'BOOT'
#!/bin/bash
# SCF Web Function entrypoint. Migrations are applied separately
# (run `npm run cn:migrate` from your laptop with 外网 temporarily open).
export PORT=${PORT:-9000}
export HOSTNAME=0.0.0.0
echo "[bootstrap] Starting Next.js …"
exec node server.js
BOOT
chmod +x "$BUNDLE_DIR/scf_bootstrap"

# ─── 3. Write cloudbaserc.json with runtime env ─────────────────────────
node "$REPO_ROOT/infra/tencent-cn/scripts/write-cloudbaserc.mjs" \
  --bundle "$BUNDLE_DIR" --env "$ENV_FILE"

if grep -q "../build/output/log" "$BUNDLE_DIR/node_modules/next/dist/server/next.js"; then
  echo "✖ SCF bundle still has an unpatched Next.js startup import:" >&2
  echo "  node_modules/next/dist/server/next.js -> ../build/output/log" >&2
  exit 1
fi
if [ ! -f "$BUNDLE_DIR/node_modules/next/dist/server/scf-output-log-shim.js" ]; then
  echo "✖ SCF bundle is missing node_modules/next/dist/server/scf-output-log-shim.js" >&2
  exit 1
fi
HEALTH_ROUTE_JS="$BUNDLE_DIR/.next/server/app/api/health/origin/route.js"
if [ ! -f "$HEALTH_ROUTE_JS" ]; then
  echo "✖ SCF bundle is missing /api/health/origin route output" >&2
  exit 1
fi
if ! grep -q "IS_WECHAT" "$HEALTH_ROUTE_JS" || ! grep -q "PROXY_REGION" "$HEALTH_ROUTE_JS"; then
  echo "✖ /api/health/origin was compiled without runtime WeChat env checks" >&2
  echo "  Expected bundled route to retain IS_WECHAT and PROXY_REGION lookups." >&2
  exit 1
fi
BUNDLE_RUNTIME=$(
  node -e 'const cfg = require(process.argv[1]); process.stdout.write(cfg.functions?.[0]?.runtime || "")' \
    "$BUNDLE_DIR/cloudbaserc.json"
)
echo "  SCF runtime: ${BUNDLE_RUNTIME:-unknown}"
echo "  Next.js startup import patch: ok"
echo "  WeChat runtime env origin check: ok"

# ─── 4. Deploy function ─────────────────────────────────────────────────
echo "▶ Deploying SCF $TENCENT_CN_FN_NAME to env $TENCENT_CN_ENV_ID …"
DEPLOY_RC=0
DEPLOY_OUT=$(
  cd "$BUNDLE_DIR"
  "$TCB_BIN" fn deploy "$TENCENT_CN_FN_NAME" \
    -e "$TENCENT_CN_ENV_ID" \
    --runtime "$BUNDLE_RUNTIME" \
    --httpFn \
    --force \
    --dir . 2>&1
) || DEPLOY_RC=$?
echo "$DEPLOY_OUT"
if [ "$DEPLOY_RC" -ne 0 ]; then
  # The tcb CLI's status-polling loop has a ~60 s budget. Large bundles
  # (100+ MB) take longer to provision than that, producing
  # `函数状态异常，检查超时`. This is NOT a real failure — the upload and
  # CreateFunction API call both succeeded; SCF is still provisioning.
  if ! echo "$DEPLOY_OUT" | grep -qE '检查超时|status.*timeout|state.*abnormal|函数状态异常'; then
    echo "✖ TCB deploy failed (exit $DEPLOY_RC) — see error above" >&2
    exit 1
  fi
  echo ""
  echo "  ⚠ TCB status-check timed out — upload succeeded, SCF still provisioning."
fi

# ─── 5. Wait for the function to reach Active (or fail fast) ─────────────
echo "▶ Waiting for $TENCENT_CN_FN_NAME to become Active …"
ACTIVE=0
for i in $(seq 1 30); do
  STATUS_RAW=$("$TCB_BIN" fn list -e "$TENCENT_CN_ENV_ID" 2>&1 \
    | grep -F "$TENCENT_CN_FN_NAME" \
    | awk -F'│' '{print $7}' \
    | head -n 1)
  STATUS=$(printf "%s" "$STATUS_RAW" | tr -cd '[:alnum:]')
  case "$STATUS" in
    *Deploymentcompleted*|*Active*|*Running*)
      echo "  ✓ Function is $STATUS (after $((i*10)) s)"
      ACTIVE=1
      break ;;
    *Creationfailed*|*UpdateFailed*|*Failed*)
      echo "✖ Function is in $STATUS state — check the SCF console for the real cause" >&2
      echo "  console.cloud.tencent.com → 云开发 → 云函数 → $TENCENT_CN_FN_NAME → 函数日志" >&2
      exit 1 ;;
    *)
      printf "  status=%s (poll %d/30)\r" "$STATUS" "$i"
      sleep 10 ;;
  esac
done
echo ""
if [ "$ACTIVE" -ne 1 ]; then
  echo "✖ Function did not become Active within 5 minutes — last status: $STATUS" >&2
  exit 1
fi

# ─── 6. Add HTTP route (idempotent) ──────────────────────────────────────
node "$REPO_ROOT/infra/tencent-cn/scripts/add-route.mjs" \
  --tcb "$TCB_BIN" --env "$ENV_FILE"
