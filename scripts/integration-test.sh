#!/bin/bash
# Comprehensive API integration test
# Usage: bash scripts/integration-test.sh [base_url]

BASE="${1:-https://www.help-and-grow.com}"
PASS=0
FAIL=0
WARN=0

green() { printf "\033[32m%s\033[0m" "$1"; }
red()   { printf "\033[31m%s\033[0m" "$1"; }
yellow(){ printf "\033[33m%s\033[0m" "$1"; }

check() {
  local label="$1" expected_code="$2" url="$3" method="${4:-GET}" body="$5"
  local args=(-s -o /tmp/test_body.txt -w "%{http_code}" -X "$method")
  if [ -n "$COOKIE" ]; then
    args+=(-b "$COOKIE")
  fi
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  
  local code
  code=$(curl "${args[@]}" "$url" 2>/dev/null)
  local response
  response=$(cat /tmp/test_body.txt 2>/dev/null)
  
  if [ "$code" = "$expected_code" ]; then
    echo "  $(green '✓') $label → HTTP $code"
    PASS=$((PASS+1))
  else
    echo "  $(red '✗') $label → HTTP $code (expected $expected_code)"
    echo "    Response: ${response:0:200}"
    FAIL=$((FAIL+1))
  fi
}

check_contains() {
  local label="$1" expected_code="$2" url="$3" needle="$4" method="${5:-GET}" body="$6"
  local args=(-s -o /tmp/test_body.txt -w "%{http_code}" -X "$method")
  if [ -n "$COOKIE" ]; then
    args+=(-b "$COOKIE")
  fi
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  
  local code
  code=$(curl "${args[@]}" "$url" 2>/dev/null)
  local response
  response=$(cat /tmp/test_body.txt 2>/dev/null)
  
  if [ "$code" = "$expected_code" ] && echo "$response" | grep -q "$needle"; then
    echo "  $(green '✓') $label → HTTP $code (contains '$needle')"
    PASS=$((PASS+1))
  elif [ "$code" = "$expected_code" ]; then
    echo "  $(yellow '⚠') $label → HTTP $code but missing '$needle'"
    echo "    Response: ${response:0:200}"
    WARN=$((WARN+1))
  else
    echo "  $(red '✗') $label → HTTP $code (expected $expected_code)"
    echo "    Response: ${response:0:200}"
    FAIL=$((FAIL+1))
  fi
}

echo "=============================================="
echo "  API Integration Test Suite"
echo "  Target: $BASE"
echo "  Time:   $(date)"
echo "=============================================="
echo ""

# ──────────────────────────────────────────────────
# 1. AUTH / SESSION APIs
# ──────────────────────────────────────────────────
echo "┌─ 1. AUTH / SESSION ─────────────────────────"

check_contains "GET /api/auth/providers" "200" "$BASE/api/auth/providers" "google"
check_contains "GET /api/auth/csrf"      "200" "$BASE/api/auth/csrf"      "csrfToken"
check         "GET /api/auth/session (no cookie)" "200" "$BASE/api/auth/session"

echo "└────────────────────────────────────────────"
echo ""

# ──────────────────────────────────────────────────
# 2. PUBLIC EXPERT APIs (no auth required)
# ──────────────────────────────────────────────────
echo "┌─ 2. PUBLIC EXPERT LIST & SEARCH ────────────"

# GET /api/experts — list
EXPERTS_RESPONSE=$(curl -s "$BASE/api/experts" 2>/dev/null)
EXPERT_COUNT=$(echo "$EXPERTS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('experts',[])))" 2>/dev/null || echo "0")
if [ "$EXPERT_COUNT" -gt 0 ]; then
  echo "  $(green '✓') GET /api/experts → $EXPERT_COUNT experts returned"
  PASS=$((PASS+1))
else
  echo "  $(yellow '⚠') GET /api/experts → 0 experts (DB might be empty)"
  WARN=$((WARN+1))
fi

# Extract first expert ID
EXPERT_ID=$(echo "$EXPERTS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['experts'][0]['id'] if d.get('experts') else '')" 2>/dev/null || echo "")

# GET /api/experts?domain=...
check "GET /api/experts?domain=Technology" "200" "$BASE/api/experts?domain=Technology"

# POST /api/experts/match (AI match)
check "POST /api/experts/match (no auth)" "200" "$BASE/api/experts/match" "POST" '{"query":"I need help with AI startup strategy"}'

echo "└────────────────────────────────────────────"
echo ""

# ──────────────────────────────────────────────────
# 3. SINGLE EXPERT PUBLIC PROFILE
# ──────────────────────────────────────────────────
echo "┌─ 3. SINGLE EXPERT PUBLIC PROFILE ───────────"

if [ -n "$EXPERT_ID" ]; then
  check_contains "GET /api/experts/:id"       "200" "$BASE/api/experts/$EXPERT_ID"        "avatarScript"
  check         "GET /api/experts/:id/avatar"  "200" "$BASE/api/experts/$EXPERT_ID/avatar"
  
  # Audio might not exist
  AUDIO_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/experts/$EXPERT_ID/audio" 2>/dev/null)
  if [ "$AUDIO_CODE" = "200" ]; then
    echo "  $(green '✓') GET /api/experts/:id/audio → HTTP 200 (audio exists)"
    PASS=$((PASS+1))
  elif [ "$AUDIO_CODE" = "404" ]; then
    echo "  $(yellow '⚠') GET /api/experts/:id/audio → HTTP 404 (no audio yet — expected for new experts)"
    WARN=$((WARN+1))
  else
    echo "  $(red '✗') GET /api/experts/:id/audio → HTTP $AUDIO_CODE"
    FAIL=$((FAIL+1))
  fi
  
  # Document download
  DOC_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/experts/$EXPERT_ID/document" 2>/dev/null)
  if [ "$DOC_CODE" = "200" ] || [ "$DOC_CODE" = "404" ]; then
    echo "  $(green '✓') GET /api/experts/:id/document → HTTP $DOC_CODE (OK)"
    PASS=$((PASS+1))
  else
    echo "  $(red '✗') GET /api/experts/:id/document → HTTP $DOC_CODE"
    FAIL=$((FAIL+1))
  fi
  
  # Slots
  check "GET /api/experts/:id/slots" "200" "$BASE/api/experts/$EXPERT_ID/slots"
else
  echo "  $(yellow '⚠') Skipping single expert tests — no experts in DB"
  WARN=$((WARN+3))
fi

echo "└────────────────────────────────────────────"
echo ""

# ──────────────────────────────────────────────────
# 4. UNAUTHENTICATED ACCESS CONTROL
# ──────────────────────────────────────────────────
echo "┌─ 4. AUTH-REQUIRED ENDPOINTS (expect 401) ───"

check "GET  /api/expert/profile (no auth)"       "401" "$BASE/api/expert/profile"
check "POST /api/onboarding (no auth)"           "401" "$BASE/api/onboarding" "POST" '{"linkedIn":"test"}'
check "GET  /api/onboarding (no auth)"           "401" "$BASE/api/onboarding"
check "POST /api/onboarding/generate (no auth)"  "401" "$BASE/api/onboarding/generate" "POST"
check "POST /api/onboarding/publish (no auth)"   "401" "$BASE/api/onboarding/publish" "POST"
check "POST /api/expert/regenerate-image (no auth)" "401" "$BASE/api/expert/regenerate-image" "POST"
check "POST /api/expert/generate-audio (no auth)" "401" "$BASE/api/expert/generate-audio" "POST"
check "POST /api/expert/voice-clone (no auth)"    "401" "$BASE/api/expert/voice-clone" "POST"
check "POST /api/expert/improve (no auth)"       "401" "$BASE/api/expert/improve" "POST"
check "PATCH /api/user (no auth)"                "401" "$BASE/api/user" "PATCH" '{"nickName":"test"}'
check "GET  /api/bookings (no auth)"             "401" "$BASE/api/bookings"
check "POST /api/bookings (no auth)"             "401" "$BASE/api/bookings" "POST" '{"expertId":"x","date":"2026-01-01","time":"10:00"}'

echo "└────────────────────────────────────────────"
echo ""

# ──────────────────────────────────────────────────
# 5. AUTHENTICATED TESTS (requires session cookie)
# ──────────────────────────────────────────────────
echo "┌─ 5. AUTHENTICATED ENDPOINTS ────────────────"

# Try to get a session cookie via CSRF flow
# The user can set COOKIE env var manually for full auth testing
if [ -z "$COOKIE" ]; then
  echo "  $(yellow '⚠') No COOKIE env var set — skipping authenticated tests"
  echo "  To test authenticated endpoints, set COOKIE:"
  echo "    export COOKIE='next-auth.session-token=YOUR_TOKEN'"
  echo "    bash scripts/integration-test.sh"
  WARN=$((WARN+1))
else
  check_contains "GET /api/expert/profile"      "200" "$BASE/api/expert/profile"    "id"
  check_contains "GET /api/onboarding"          "200" "$BASE/api/onboarding"        "onboardingStep"
  check_contains "GET /api/bookings"            "200" "$BASE/api/bookings"          "bookings"
  
  # POST /api/onboarding — save gender
  check "POST /api/onboarding (save gender)"    "200" "$BASE/api/onboarding" "POST" '{"gender":"male"}'
  
  # POST /api/expert/generate-audio
  AUDIO_GEN_CODE=$(curl -s -o /tmp/test_body.txt -w "%{http_code}" -b "$COOKIE" -X POST "$BASE/api/expert/generate-audio" 2>/dev/null)
  AUDIO_GEN_RESP=$(cat /tmp/test_body.txt 2>/dev/null)
  if [ "$AUDIO_GEN_CODE" = "200" ]; then
    echo "  $(green '✓') POST /api/expert/generate-audio → HTTP 200"
    PASS=$((PASS+1))
  elif [ "$AUDIO_GEN_CODE" = "503" ]; then
    echo "  $(yellow '⚠') POST /api/expert/generate-audio → HTTP 503 (voice synthesis not configured)"
    WARN=$((WARN+1))
  elif [ "$AUDIO_GEN_CODE" = "400" ]; then
    echo "  $(yellow '⚠') POST /api/expert/generate-audio → HTTP 400 (no script yet)"
    WARN=$((WARN+1))
  else
    echo "  $(red '✗') POST /api/expert/generate-audio → HTTP $AUDIO_GEN_CODE"
    echo "    Response: ${AUDIO_GEN_RESP:0:200}"
    FAIL=$((FAIL+1))
  fi
  
  # PATCH /api/user
  check "PATCH /api/user (nickName)" "200" "$BASE/api/user" "PATCH" '{"nickName":"Test User"}'
fi

echo "└────────────────────────────────────────────"
echo ""

# ──────────────────────────────────────────────────
# 6. EDGE CASES & ERROR HANDLING
# ──────────────────────────────────────────────────
echo "┌─ 6. EDGE CASES & ERROR HANDLING ────────────"

check "GET /api/experts/nonexistent"                "404" "$BASE/api/experts/nonexistent-id-12345"
check "GET /api/experts/nonexistent/avatar"          "404" "$BASE/api/experts/nonexistent-id-12345/avatar"
check "POST /api/onboarding (empty body, no auth)"   "401" "$BASE/api/onboarding" "POST" '{}'
check "POST /api/experts/match (empty query → 400)"   "400" "$BASE/api/experts/match" "POST" '{"query":""}'

echo "└────────────────────────────────────────────"
echo ""

# ──────────────────────────────────────────────────
# SUMMARY
# ──────────────────────────────────────────────────
echo "=============================================="
echo "  RESULTS"
echo "=============================================="
echo "  $(green "✓ PASS: $PASS")"
echo "  $(yellow "⚠ WARN: $WARN")"
echo "  $(red "✗ FAIL: $FAIL")"
TOTAL=$((PASS+WARN+FAIL))
echo "  TOTAL: $TOTAL tests"
echo "=============================================="

if [ $FAIL -gt 0 ]; then
  exit 1
else
  exit 0
fi
