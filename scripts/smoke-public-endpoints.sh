#!/usr/bin/env bash
# Public HTTP smoke checks (no OAuth). Use after toggling pgvector, Inngest, or DB URLs on staging.
# Usage: BASE_URL=https://your-staging.example ./scripts/smoke-public-endpoints.sh
set -euo pipefail
BASE="${BASE_URL:-http://127.0.0.1:5000}"

echo "== GET /api/health =="
curl -fsSL "${BASE}/api/health" | tee /tmp/smoke-health.json
grep -q '"ok"' /tmp/smoke-health.json

echo "== GET /api/trpc health (public query, batch) =="
# tRPC fetch adapter + superjson: batch index "0", json input null
curl -fsSL -G "${BASE}/api/trpc/health" \
  --data-urlencode "batch=1" \
  --data-urlencode 'input={"0":{"json":null}}' | tee /tmp/smoke-trpc.json
grep -q '"ok"' /tmp/smoke-trpc.json

echo "== GET /api/trpc expertsPublished (public query, batch) =="
curl -fsSL -G "${BASE}/api/trpc/expertsPublished" \
  --data-urlencode "batch=1" \
  --data-urlencode 'input={"0":{"json":{"take":1,"skip":0}}}' | tee /tmp/smoke-trpc-experts.json
grep -q '"experts"' /tmp/smoke-trpc-experts.json

echo "OK: public smokes passed for ${BASE}"
echo "Manual: complete one booking flow + one expert profile save in the browser when validating toggles."
