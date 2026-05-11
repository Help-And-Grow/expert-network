# Runbook — Local dev, Deploy, CI

Operational guide for getting the app up locally, deploying to Vercel, and understanding what each CI workflow does. Companion to [`README.md`](../README.md) and [`docs/ENV.md`](ENV.md).

---

## Local dev

### Prereqs
- Node.js 20.x (`.nvmrc`)
- PostgreSQL 14+ (local or hosted)
- Optional: Docker (for ten-agent voice)

### First-time setup
```bash
npm install        # postinstall: switch-db → prisma generate → prisma-migrate-if-vercel (no-op locally)
cp .env.example .env
```
Edit `.env` to set at minimum `DATABASE_URL`, `NEXTAUTH_URL`, and `AUTH_SECRET` (32+ chars). For everything else, see [`docs/ENV.md`](ENV.md).

### Provision the database
```bash
npm run db:push        # prisma db push --accept-data-loss (dev convenience)
# or, for tracked migrations:
npx prisma migrate dev
```

### Run
```bash
npm run dev            # next dev -p 5000 -H 0.0.0.0
# or:
npm run dev:3000
```

### Local sign-in shortcut
With `DEV_AUTH_EMAIL` set, `/auth/signin` exposes a "Continue as local dev" button — bypasses Google/magic-link. Optionally set `DEV_AUTH_ROLE=ADMIN`.

### Subsystems with Docker
| Subsystem | Path |
|---|---|
| ten-agent (realtime voice, Phase B) | `cd ten-agent && docker compose up` |

The Next.js app itself runs on Node directly via `npm run dev`. There is no top-level `docker-compose.yml`.

---

## Build pipeline

`npm run build` runs:
1. [`scripts/switch-db.mjs`](../scripts/switch-db.mjs) — enforces `provider = "postgresql"` in `prisma/schema.prisma` (rejects `mysql://`).
2. `prisma generate` — regenerates `@prisma/client` into `src/generated/prisma/`.
3. `next build`.

`postinstall` additionally runs [`scripts/prisma-migrate-if-vercel.mjs`](../scripts/prisma-migrate-if-vercel.mjs):
- No-op when `VERCEL !== "1"`.
- On Vercel: runs `prisma migrate deploy`. If it fails with **P3005** ("schema is not empty"), it auto-resolves the baseline migration `20260424120000_baseline` and retries. This unblocks deploys against databases provisioned outside of Prisma Migrate (added in commit `edf8faf`).

This means you can take a fresh Vercel project pointed at an existing Postgres database (created outside Prisma Migrate) and the first deploy will baseline cleanly. Don't treat this as a substitute for tracked migrations going forward.

---

## Deploy (Vercel)

The live `expert-network` project is owned by the **Help And Grow** Vercel team. Default Git iteration follows **`jlzxwt8/expert-network`**; sync to the public `Help-And-Grow/expert-network` mirror only on explicit request.

### Push-to-deploy
Pushing to `main` triggers Vercel to run `npm run build`. The auto-baseline migration runs first (postinstall → migrate deploy).

### Env management
| Action | Command |
|---|---|
| Pull dev env | `npm run vercel:env:pull:dev` → `.env.vercel.development.local` |
| Pull preview env | `npm run vercel:env:pull:preview` → `.env.vercel.preview.local` |
| Pull production env | `npm run vercel:env:pull:production` → `.env.vercel.production.local` |
| List names only | `npm run vercel:env:list:production` |
| Compare keys across pulled files | `npm run vercel:env:compare-keys` |
| Apply many vars from a file | `npm run vercel:env:apply -- production ./.env.vercel.sync` |
| Sync `TELEGRAM_BOT_TOKEN` to Vercel | `npm run vercel:env:telegram` |

Detail: [`docs/references/vercel-environments-solo-pm.md`](references/vercel-environments-solo-pm.md), [`vercel-env-and-secret-rotation.md`](references/vercel-env-and-secret-rotation.md).

### Post-deploy smoke
```bash
# Canonical production URL (the expert-network.vercel.app alias still works for fallback)
PLAYWRIGHT_BASE_URL=https://www.help-and-grow.com npm run test:e2e:ci
# or quick:
npm run smoke:public      # bash scripts/smoke-public-endpoints.sh
```

### Region / runtime
Functions are stateless + ephemeral (Vercel best practice). Set Function regions near your primary data source. Long-running LLM/webhook routes set `export const maxDuration` (Inngest = 300, Stripe webhook = 30).

---

## GitHub Actions

Workflows were re-enabled in commit `27f2570` after the Action-minute quota window reset; the prior `if: false` guards (commit `db60842`) have been removed.

| Workflow | Trigger | Purpose |
|---|---|---|
| [`ci.yml`](../.github/workflows/ci.yml) | push / PR to `main` | ESLint + Playwright smoke against production URL |
| [`deploy-smoke.yml`](../.github/workflows/deploy-smoke.yml) | `deployment_status` success | `curl /api/health`, `/api/trpc/health`, `/api/trpc/expertsPublished` after Vercel deploy |
| [`playwright-e2e.yml`](../.github/workflows/playwright-e2e.yml) | manual / schedule | Broader Playwright run |
| _(removed 2026-05-06)_ `ui-smoke.yml` | — | Previously bootstrapped local Next.js + ephemeral Postgres for browser smoke. Replaced by `ci.yml`'s `e2e` job which runs the same Playwright smoke against the canonical production URL — single source of truth, no ephemeral CI database to maintain. |
| [`wechat-ci.yml`](../.github/workflows/wechat-ci.yml) | PR / push | Builds `wechat/` Mini Program; uploads on `main` (needs `WECHAT_CI_PRIVATE_KEY`) |
| [`npm-audit.yml`](../.github/workflows/npm-audit.yml) | scheduled | npm audit triage |

If quota becomes a concern again, gate individual workflows with a job-level `if:` guard rather than flipping every job at once.

---

## Common operations

### Re-baseline after DB reset
The auto-baseline kicks in only on **Vercel** builds. Locally, if you reset your database and `prisma migrate deploy` errors with P3005, run:
```bash
npx prisma migrate resolve --applied 20260424120000_baseline
npx prisma migrate deploy
```

### Switch AI provider in production
Use `/admin/ai-provider` (requires `VERCEL_MANAGEMENT_TOKEN`, `VERCEL_MANAGED_TEAM_ID`, `VERCEL_MANAGED_PROJECT`). It writes the new `AI_PROVIDER` to Vercel and triggers a redeploy via `VERCEL_DEPLOY_HOOK_URL` if set.

### Register the POMP EAS schema (one-time per chain)
```bash
node scripts/register-pomp-eas-schema.mjs
```
Set `POMP_EAS_SCHEMA_UID` in Vercel env afterward.

### WeChat Mini Program upload
```bash
npm run wechat:build
npm run wechat:upload     # uses WECHAT_CI_KEY_PATH or WECHAT_CI_PRIVATE_KEY
```

### Manual db sanity check
```bash
curl -s https://www.help-and-grow.com/api/db-health | jq
```

---

## Troubleshooting

| Symptom | Likely cause | First step |
|---|---|---|
| Build fails "drift detected" / P3005 | DB has tables but no `_prisma_migrations` | Auto-baseline should handle on Vercel; locally run the resolve+deploy commands above |
| All Stripe webhooks 400 | `STRIPE_WEBHOOK_SECRET` mismatch (Stripe rotated, env didn't) | Compare prefixes in Vercel env vs Stripe dashboard; `npm run vercel:env:list:production` |
| `/api/voice-chat/*` returns "voice unavailable" | `DASHSCOPE_API_KEY` unset or `VOICE_CHAT_MODE` mismatch | Check `/api/voice-chat/config` response; reset env on Vercel |
| WeChat sign-in 401 loops | `WECHAT_APP_SECRET` rotated | Resync secret; verify `code2session` from `/api/auth/wechat` |
| `/admin/ai-provider` "permission denied" | Missing `VERCEL_MANAGEMENT_TOKEN` or wrong team/project | Set the three `VERCEL_MANAGED_*` vars |
| `/reputation/[id]` returns empty | `POMPCredential` rows missing or `onChainVerified` not flipped by Alchemy webhook | Inspect `POMPCredential` rows via Prisma; check Alchemy webhook delivery + HMAC on `/api/webhook/onchain` |
