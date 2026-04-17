#!/usr/bin/env bash
# =============================================================================
# Local WeChat mini program upload (mirrors .github/workflows/wechat-ci.yml).
#
# Prerequisites
# ---------------
# 1. Node.js: Taro build uses your current node; upload uses Node 20 via npx when your
#    node is 23+ (miniprogram-ci breaks on newer runtimes). You can still use nvm/node@20 for everything.
# 2. A CI / "代码上传" private key from WeChat 微信公众平台 for appid wx09d0eb079596060d:
#    开发 → 开发管理 → 开发设置 → 小程序代码上传 → 生成 / 下载 key 文件
#    Save the PEM as a file and point WECHAT_CI_KEY_PATH at it, or place it at:
#      wechat/private.wx09d0eb079596060d.key   (gitignored; same basename as CI)
#
# 3. Repo root: run this script from anywhere, or use:
#      npm run wechat:upload:local -- [version] [description]
#
# Environment
# -------------
#   WECHAT_CI_KEY_PATH   Path to the .key PEM (overrides default locations)
#   WECHAT_UPLOAD_DESC   Default description if second CLI arg omitted
#
# After upload
# ------------
# Assign 体验版 or submit 审核 in the admin console; upload does not publish to all users.
#
# CI troubleshooting
# --------------------
# GitHub Actions needs secret WECHAT_CI_PRIVATE_KEY (full PEM text). If the workflow
# fails, check the job log on the "Write CI key" / "Upload to WeChat" steps.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    -q|--quick) QUICK=1 ;;
    -h|--help)
      cat <<'EOF'
Local WeChat mini program upload (same flow as GitHub Actions wechat-ci.yml).

Usage:
  bash scripts/wechat-upload-local.sh [version] [description]
  npm run wechat:upload:local -- [version] [description]

Options:
  -q, --quick   Skip "npm ci" in wechat/ (only run build:weapp)
  -h, --help    Show this help

Environment:
  WECHAT_CI_KEY_PATH   PEM path (default: wechat/private.wx09d0eb079596060d.key)
  WECHAT_UPLOAD_DESC   Default description when [description] is omitted

Requires the code-upload key from 微信公众平台 (see script header comments).
Tip: quote multi-word descriptions, e.g. ./scripts/wechat-upload-local.sh 1.0.3 "my notes"
EOF
      exit 0
      ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
# With "set -u", "${arr[@]}" on an empty array errors on some bash versions — avoid that.
if ((${#POSITIONAL[@]} > 0)); then
  set -- "${POSITIONAL[@]}"
else
  set --
fi

VERSION="${1:-$(node -p "require('./wechat/package.json').version")}"
DESC="${2:-${WECHAT_UPLOAD_DESC:-local $(git rev-parse --short HEAD 2>/dev/null || echo manual)}}"

KEY_NAME="private.wx09d0eb079596060d.key"
RESOLVED_KEY="${WECHAT_CI_KEY_PATH:-}"
if [[ -z "$RESOLVED_KEY" || ! -f "$RESOLVED_KEY" ]]; then
  if [[ -f "$ROOT/wechat/$KEY_NAME" ]]; then
    RESOLVED_KEY="$ROOT/wechat/$KEY_NAME"
  elif [[ -f "$ROOT/$KEY_NAME" ]]; then
    RESOLVED_KEY="$ROOT/$KEY_NAME"
  fi
fi

if [[ -z "$RESOLVED_KEY" || ! -f "$RESOLVED_KEY" ]]; then
  echo "Missing CI upload private key."
  echo "  Set WECHAT_CI_KEY_PATH to your PEM file, or save it as:"
  echo "    $ROOT/wechat/$KEY_NAME"
  exit 1
fi

NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0],10)")"
UPLOAD_CMD=(node)
if (( NODE_MAJOR > 22 )); then
  echo "Note: $(node -v) — miniprogram-ci needs Node ≤22; using \"npx -y node@20\" for the upload step only."
  UPLOAD_CMD=(npx -y node@20)
fi

if (( QUICK )); then
  echo "Quick mode: skipping npm ci in wechat/"
  (cd "$ROOT/wechat" && npm run build:weapp)
else
  (cd "$ROOT/wechat" && npm ci && npm run build:weapp)
fi

if [[ ! -d "$ROOT/wechat/dist" ]]; then
  echo "Build output missing: wechat/dist"
  exit 1
fi

export WECHAT_CI_KEY_PATH="$RESOLVED_KEY"
echo "Uploading version: $VERSION"
echo "Description: $DESC"
echo "Key: $WECHAT_CI_KEY_PATH"
"${UPLOAD_CMD[@]}" "$ROOT/scripts/wechat-upload.js" "$VERSION" "$DESC"
