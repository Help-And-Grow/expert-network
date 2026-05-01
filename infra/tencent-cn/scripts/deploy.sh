#!/usr/bin/env bash
# Build and deploy the Next.js standalone app to SCF CN, then expose it via
# the TCB env's default cloudbase domain.
#
# Run from repo root: `npm run cn:deploy`
#
# Pipeline:
#   1. next build (output: standalone) + prisma generate (Linux engines)
#   2. Assemble infra/tencent-cn/build/scf-cn/ — standalone server + static
#      + public + scf_bootstrap that just starts Next.js
#   3. tcb fn deploy hg-app-cn --httpFn --force (with cloudbaserc.json)
#   4. tcb routes add — bind /* on the cloudbase domain to the SCF (idempotent)
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
# Next.js 15 standalone needs .next/build for runtime (output/log.js, etc.)
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
#    by `node server.js`. ~10 MB savings; runtime is unaffected.
NEXT_DIST="$BUNDLE_DIR/node_modules/next/dist"
if [ -d "$NEXT_DIST" ]; then
  # NOTE: Do NOT remove $NEXT_DIST/build — Next.js 15 standalone runtime requires
  # node_modules/next/dist/build/output/log.js at startup. Removing it causes:
  #   Error: Cannot find module '../build/output/log'
  # See: https://github.com/vercel/next.js/issues/64218
  rm -rf "$NEXT_DIST/next-devtools"               2>/dev/null || true
  rm -rf "$NEXT_DIST/compiled/babel"              2>/dev/null || true
  rm -rf "$NEXT_DIST/compiled/babel-packages"     2>/dev/null || true
  rm -rf "$NEXT_DIST/compiled/amphtml-validator"  2>/dev/null || true
  rm -rf "$NEXT_DIST/compiled/@vercel"            2>/dev/null || true
  rm -f  "$NEXT_DIST/server/capsize-font-metrics.json" 2>/dev/null || true
fi

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

# ─── 4. Deploy function ─────────────────────────────────────────────────
echo "▶ Deploying SCF $TENCENT_CN_FN_NAME to env $TENCENT_CN_ENV_ID …"
DEPLOY_RC=0
DEPLOY_OUT=$(
  cd "$BUNDLE_DIR"
  "$TCB_BIN" fn deploy "$TENCENT_CN_FN_NAME" --httpFn --force --dir . 2>&1
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
  STATUS=$("$TCB_BIN" fn list -e "$TENCENT_CN_ENV_ID" 2>&1 \
    | grep -F "$TENCENT_CN_FN_NAME" \
    | awk -F'│' '{print $7}' \
    | tr -d ' ')
  case "$STATUS" in
    Deploymentcompleted|Active|Running)
      echo "  ✓ Function is $STATUS (after $((i*10)) s)"
      ACTIVE=1
      break ;;
    Creationfailed|UpdateFailed|Failed*)
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
