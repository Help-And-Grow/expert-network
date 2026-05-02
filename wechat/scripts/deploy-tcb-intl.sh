#!/usr/bin/env bash
# Legacy helper: build Help & Grow Intl and upload the generated static files
# to Tencent CloudBase hosting. This is not the normal mini-program release
# path; for user testing prefer:
#   npm run wechat:upload:intl -- <version> "<description>"
#
# Prerequisites:
#   1. npm install -g @cloudbase/cli
#   2. tcb login (OAuth login)
#   3. A CloudBase hosting target, if you intentionally need static hosting
#
# Usage:
#   bash scripts/deploy-tcb-intl.sh [envId]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WECHAT_DIR="$(dirname "$SCRIPT_DIR")"
TCB_ENV_ID="${1:-cn-wechat-d1gzncs8i34827c98}"

echo "============================================"
echo "  Deploying to TCB: ${TCB_ENV_ID}"
echo "  Region: ap-shanghai"
echo "============================================"

# Step 1: Login check
if ! tcb env:list &>/dev/null; then
  echo "[ERROR] Not logged in to TCB. Run: tcb login"
  exit 1
fi

# Step 2: Build WeChat mini program (intl)
echo ""
echo "[Step 1/3] Building WeChat mini program (intl)..."
cd "$WECHAT_DIR"
npm run build:weapp:intl

if [ $? -ne 0 ]; then
  echo "[ERROR] Build failed!"
  exit 1
fi

echo "[OK] Build complete: dist-intl/"

# Step 3: Deploy to TCB Cloud Hosting
echo ""
echo "[Step 2/3] Deploying to TCB Cloud Hosting..."

# Option A: Static Hosting (simple, for mini program assets)
tcb hosting deploy ./dist-intl -e "${TCB_ENV_ID}"

# Option B: Containerized Hosting (for full API server)
# Uncomment below if you need Node.js API server on TCB:
# tcb run deploy \
#   --env "${TCB_ENV_ID}" \
#   -f Dockerfile.tcb \
#   -p .

if [ $? -eq 0 ]; then
  echo "[OK] Deployed to TCB successfully!"
else
  echo "[WARNING] TCB hosting deploy may have issues."
  echo "         Try manual upload via TCB console:"
  echo "         https://console.cloud.tencent.com/tcb/env/${TCB_ENV_ID}/hosting"
fi

# Step 4: Verify
echo ""
echo "[Step 3/3] Verifying deployment..."
tcb hosting detail -e "${TCB_ENV_ID}" || true

echo ""
echo "============================================"
echo "  Deployment Summary"
echo "============================================"
echo "  Environment ID : ${TCB_ENV_ID}"
echo "  Region         : ap-shanghai (Shanghai)"
echo "  API Domain     : https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com"
echo ""
echo "  Next steps:"
echo "  1. Open WeChat DevTools → Import project from wechat/"
echo "  2. Set AppID to: wx09d0eb079596060d"
echo "  3. Preview or upload for review"
echo "============================================"
