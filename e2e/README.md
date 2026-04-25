# End-to-end tests (Playwright)

Tests are grouped **by area** under `e2e/`:

| Directory | Purpose |
|-----------|---------|
| `e2e/smoke/` | Liveness, marketing home, public API contracts (no login). |
| `e2e/booking/` | Book-session page shell (public expert from `/api/v1/experts`). |
| `e2e/auth/` | Sign-in UI; **optional** authenticated flows (storage state). |

### PRD environment (canonical for E2E)

Use the **production (PRD)** deployment as the single source for **storage state** and Playwright runs that should match real auth + Stripe behavior:

- **PRD origin:** `https://expert-network.vercel.app` (same as `playwright.config.ts` default).

Generate `e2e/.auth/user.json` against **PRD** sign-in, and set `PLAYWRIGHT_BASE_URL` to that origin when running authenticated specs. Local `http://localhost:5000` is only for debugging app code — **do not** mix localhost storage state with PRD URLs (cookie domains will not match).

Default `PLAYWRIGHT_BASE_URL` in `playwright.config.ts` is PRD. Override only when you intentionally test another deployment.

## Solo PM: make Stripe + automated tests work (minimal tech)

You do **not** put Stripe keys in GitHub or in this git repo. Two places only:

| Where | What you set | Why |
|-------|----------------|-----|
| **Vercel** → Project → Settings → Environment Variables | `STRIPE_SECRET_KEY` = your **Test mode** secret (`sk_test_…`) from [Stripe Dashboard → API keys](https://dashboard.stripe.com/test/apikeys) | The **deployed app** creates Checkout sessions and calls Stripe’s API. Test keys = no real money. |
| **Stripe Dashboard** (same account) | Ensure you are in **Test mode** when copying keys | Keeps checkout in test mode. |

**GitHub Actions / Playwright** do **not** need `STRIPE_SECRET_KEY`. The workflow opens a browser and calls your **public PRD URL**; your server already uses whatever key Vercel injected at runtime.

**Smooth weekly run:** The [Playwright workflow](../.github/workflows/playwright-e2e.yml) runs **`npm run test:e2e:ci`** on a **schedule** (Mondays 06:00 UTC) and can still be run **manually** from the Actions tab. No Stripe variables required in GitHub.

**Optional Checkout redirect test** (`PLAYWRIGHT_RUN_CHECKOUT_TEST=1`): only after you save `e2e/.auth/user.json` and set a paid `PLAYWRIGHT_EXPERT_ID` — still no Stripe key in GitHub.

---

## CI pipeline (GitHub Actions)

| Workflow | Trigger | What it runs |
|----------|---------|----------------|
| **[`ci.yml`](../.github/workflows/ci.yml)** | Every **push** and **pull request** to `main` | `npm run lint` + **`npm run test:e2e:ci`** against `https://expert-network.vercel.app` (no secrets in repo). |
| **[`playwright-e2e.yml`](../.github/workflows/playwright-e2e.yml)** | **Weekly** + **manual** | Same Playwright CI subset; use when you want a run without a PR. |
| **[`deploy-smoke.yml`](../.github/workflows/deploy-smoke.yml)** | After **successful production deploy** | `curl` health checks only (not Playwright). |

Vercel env sync (development / preview / production) is documented in [**vercel-environments-solo-pm.md**](../docs/references/vercel-environments-solo-pm.md) — it does **not** duplicate secrets into GitHub; CI stays keyless.

---

## Deploy smoke vs Playwright `e2e/` (not the same)

| | **Deploy smoke** ([`deploy-smoke.yml`](../.github/workflows/deploy-smoke.yml)) | **Playwright E2E** ([`playwright-e2e.yml`](../.github/workflows/playwright-e2e.yml)) |
|---|------------------|------------------|
| **When** | Automatically after a **successful deploy** to **`expert-network.vercel.app`** only | Manual **or** weekly schedule (browser tests) |
| **What** | Three **`curl`** checks: `/api/health`, tRPC `health`, tRPC `expertsPublished` | `npm run test:e2e:ci` — home, APIs, booking page, sign-in UI |
| **Includes all `e2e/` tests?** | **No** — it does **not** run Playwright at all | Runs the **CI subset** of `e2e/` (`test:e2e:ci`), not the optional authenticated specs unless you change the command |
| **Stripe** | Not involved | Not involved (no keys in workflow) |

Full Playwright suite (`npm run test:e2e`), including authenticated files, runs **on your machine** or in CI only if you change the workflow command and add storage state.

## Commands

```bash
# One-time: install Chromium for this machine
npm run test:e2e:install

# Full suite (includes auth specs — many skip without storage / env)
npm run test:e2e

# Fast path for CI: smoke + booking + sign-in page only (no authenticated folder)
npm run test:e2e:ci

# UI mode (debug)
npm run test:e2e:ui

# Headed browser
npm run test:e2e:headed

# Optional: local app debugging only (auth + Stripe flows still use PRD + storage state above)
# Terminal A: npm run dev
# Terminal B:
PLAYWRIGHT_BASE_URL=http://localhost:5000 npm run test:e2e
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_BASE_URL` | Origin for `page.goto` and `request` (no trailing slash). |
| `PLAYWRIGHT_STORAGE_STATE` | Path to a saved `storageState` JSON (cookies/session). Defaults to `e2e/.auth/user.json` in authenticated specs. |
| `PLAYWRIGHT_EXPERT_ID` | Expert id for targeted booking / Stripe tests. |
| `PLAYWRIGHT_RUN_CHECKOUT_TEST` | Set to `1` to enable the opt-in Stripe Checkout redirect test (needs auth + paid expert). |

---

## Authentication (storage state) — OAuth / sessions

NextAuth uses **HTTP-only cookies**. Playwright cannot “type a password” for **Google OAuth** inside automated CI the way it can for a static form. Recommended approaches:

### A. Manual login once, reuse cookies (PRD)

1. Create the directory: `e2e/.auth/` (tracked via `.gitkeep`; JSON files are gitignored).
2. Run the **Codegen** recorder against **PRD** and save storage:

   ```bash
   PLAYWRIGHT_BASE_URL=https://expert-network.vercel.app npx playwright codegen \
     --save-storage=e2e/.auth/user.json \
     https://expert-network.vercel.app/auth/signin
   ```

3. Complete **Google** or **magic link** in the opened browser. After you land signed-in, close the window; `user.json` holds cookies for that origin.
4. Run tests (PRD):

   ```bash
   PLAYWRIGHT_BASE_URL=https://expert-network.vercel.app npm run test:e2e
   ```

   Specs under `e2e/auth/authenticated/` use `e2e/.auth/user.json` automatically (or `PLAYWRIGHT_STORAGE_STATE`).

**Test user:** Use a **dedicated** account for E2E only. Never commit `user.json` — it is session-equivalent.

**Stripe test keys:** Configure `pk_test_…` and `sk_test_…` only in **Vercel** (or your host) environment variables — **never** commit them to git or paste them into tickets/chat. If a secret was exposed, **rotate** it in the [Stripe Dashboard](https://dashboard.stripe.com/apikeys) and update Vercel. The Playwright Checkout redirect test does not need keys in the repo; the app must already be using test keys on PRD for test-mode Checkout sessions.

### B. Programmatic login (only if you add a test-only path)

If you later add a **non-production** credential login or a test header restricted to staging, you can replace codegen with a `globalSetup` that calls `page.request.post(...)` and writes `storageState`. Do **not** add production backdoors.

### C. Stripe / PayNow

- **Stripe Checkout** is on `checkout.stripe.com`. The opt-in full-payment redirect test `e2e/auth/authenticated/stripe-deposit.spec.ts` only checks **redirect** to Stripe; it does not complete payment.
- Use **Stripe test mode** on staging (`pk_test_…`, `sk_test_…`) and [test cards](https://docs.stripe.com/testing).
- **PayNow** appears on Stripe’s hosted page for eligible regions/methods — assert URL on Stripe, not bank completion.

### D. WeChat Pay (JSAPI)

The **WeChat Mini Program** flow is not the same as desktop Chrome. Exercise it with **device/emulator** or vendor tooling; keep API contract tests (`401` without session) in `e2e/smoke/api-contracts.spec.ts`.

---

## GitHub Actions — what it is and why use it

**GitHub Actions** is GitHub’s built-in automation: workflows (YAML under `.github/workflows/`) run on events (push, schedule, **workflow_dispatch**, etc.) on GitHub-hosted runners. They install your repo, run scripts, and can upload artifacts.

**Helpful for this project when you want:**

- Scheduled or manual **smoke tests** against production or a fixed URL (`workflow_dispatch` + `PLAYWRIGHT_BASE_URL`).
- **Regression gates** before release (expand the workflow to block merges once you trust flakiness is low).

**Caveats:**

- **No OAuth secrets** are stored in the repo by default — the sample workflow runs `npm run test:e2e:ci` only (no saved `user.json`).
- **Vercel Deployment Protection** on preview URLs can break automated hits; production smoke already uses curl in [`deploy-smoke.yml`](../.github/workflows/deploy-smoke.yml).

This repo includes **[`.github/workflows/playwright-e2e.yml`](../.github/workflows/playwright-e2e.yml)** — run it from the **Actions** tab → **Playwright E2E** → **Run workflow** (optional `base_url` input).

### Does this workflow run on every commit?

**No.** This workflow is triggered only by **`workflow_dispatch`** (manual). Pushing to `main` or opening a PR does **not** start it unless you add triggers such as:

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

Use manual runs for PRD smoke until you want every push to pay the runner cost and accept occasional flakiness. The **[`deploy-smoke.yml`](../.github/workflows/deploy-smoke.yml)** workflow *does* run automatically after a **successful production deployment** (curl health checks — not Playwright).

---

## Playwright MCP in Cursor (optional)

Microsoft publishes **`@playwright/mcp`** (free / open source). Cursor **Settings → MCP → Add server**: command `npx`, args `-y`, `@playwright/mcp@latest`. This repo gitignores `.cursor/mcp.json`; keep MCP config in user settings or a private file.

**MCP vs `npm run test:e2e`:** MCP is for exploratory agent-driven runs; the `e2e/` suite is for repeatable checks.
