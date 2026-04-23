# Vercel environments, local `.env`, and CI (solo PM)

This doc matches **Help & Grow** (Next.js on Vercel, AI + payments, small team). It does **not** copy real secrets into git—only **you** run `vercel env pull` on your machine.

## Vercel’s three scopes

| Environment | Used for | Typical variables differ how? |
|-------------|----------|--------------------------------|
| **Development** | `vercel dev` and local pulls | Often same as Preview or trimmed; safe test DB / `sk_test` if you set them here. |
| **Preview** | Every **PR / branch** deployment (`*.vercel.app`) | May use preview DB, Stripe test keys, feature flags—**not** live money. |
| **Production** | **Production** domain (e.g. `expert-network.vercel.app`) | Live `DATABASE_URL`, OAuth callbacks, optional `sk_live` when you go live. |

**Important:** Variables are **per key**: in the Vercel UI each key can be enabled for Development only, Preview only, Production only, or any combination. So “Preview vs Production” is both **scope** and **which keys exist** in that scope.

## Best practice for a solo PM / AI product

1. **Single source of truth:** Vercel **Environment Variables** (not Slack screenshots). Change there, redeploy.
2. **Local dev:** Pull **Development** (or Preview) into a **gitignored** file—never commit `.env*.local`.
3. **Compare environments:** Use `npm run vercel:env:list:production` vs `vercel:env:list:preview` (names only) or pull two files and `diff` **on your laptop** (diff may contain secrets—do not paste into tickets).
4. **CI / Playwright:** GitHub Actions **does not** need your full `.env`. E2E hits the **deployed URL**; secrets stay on Vercel.
5. **Corporate laptop / DB:** If local DB TLS fails, rely on **deployed** Preview/Production for integration checks—documented in project dev rules.

## Commands (after `vercel link` + `vercel login`)

List variable **names** (and encrypted values) per environment:

```bash
npm run vercel:env:list:development
npm run vercel:env:list:preview
npm run vercel:env:list:production
```

Pull full values to **local files** (gitignored):

```bash
npm run vercel:env:pull:dev
npm run vercel:env:pull:preview
npm run vercel:env:pull:production
```

Legacy single file (often Development):

```bash
npm run vercel:env:pull
# writes .env.vercel.local — see package.json target
```

### Compare two pulls (local only)

```bash
diff -u .env.vercel.preview.local .env.vercel.production.local | less
```

Use a GUI diff if you prefer. **Do not commit** these files.

### Compare key names only (safe — no secret values)

```bash
npm run vercel:env:compare-keys
```

Runs [`scripts/vercel-env-list-keys.mjs`](../../scripts/vercel-env-list-keys.mjs): prints sorted **keys** per file and keys that appear in **only one** file.

## Vercel-injected names vs your app keys

When you **`vercel env pull`**, the file usually contains **two kinds** of names:

### A. Names you set in the Vercel dashboard (or via CLI)

Examples: `DATABASE_URL`, `AUTH_SECRET`, `STRIPE_SECRET_KEY`, `NEXTAUTH_URL`. These are **your** configuration for Next.js, Prisma, Stripe, OAuth, etc.

### B. Vercel-injected / system-style names (`VERCEL_*`, sometimes others)

Vercel’s build and runtime expose **standard environment variables** on deployments. Official overview: [System environment variables](https://vercel.com/docs/projects/environment-variables/system-environment-variables).

Common patterns:

| Prefix / name | Role |
|---------------|------|
| `VERCEL` | `1` when running on Vercel. |
| `VERCEL_ENV` | `production`, `preview`, or `development`. |
| `VERCEL_URL` | Canonical URL of the **current** deployment (preview or production hostname). |
| `VERCEL_TARGET_ENV` | Target environment for the running build step. |
| `VERCEL_GIT_*` | Git metadata for the deployment (branch, commit SHA, PR id, repo slug, etc.). |

**Why they show up in a pulled file:** The CLI can include variables that exist for that **environment scope**’s resolved configuration—including system vars that mirror what a deployment would see. They are **not** secrets you typed; they describe **where** and **how** the build runs.

**For comparison:** Treat `VERCEL_*` as **noise** when diffing “do I have the same app secrets?” Focus on names like `DATABASE_URL`, `STRIPE_*`, `AUTH_*`.

### Turbo / Nx names (`TURBO_*`, `NX_DAEMON`)

Vercel can run **[Turborepo](https://vercel.com/docs/monorepos/turborepo)** (and related tooling) for builds. Variables such as:

| Name | Role |
|------|------|
| `TURBO_CACHE`, `TURBO_REMOTE_ONLY`, `TURBO_DOWNLOAD_LOCAL_ENABLED`, `TURBO_RUN_SUMMARY` | Control **remote caching** and Turbo behavior during `turbo build` / CI. |
| `NX_DAEMON` | Related to **Nx** tooling when the monorepo uses Nx + Turbo patterns. |

These are **build-pipeline** settings, not your application’s business secrets. They often appear next to `VERCEL_*` in pulled envs for Preview/Production when the platform attaches build context.

**Summary:** **`VERCEL_*` / `TURBO_*` / `NX_*`** = platform and build tooling. **`DATABASE_URL`**, **`STRIPE_*`**, **`AUTH_*`**, etc. = your app. Compare the latter when checking “Preview vs Production parity.”

## File layout

| Local file | Source |
|------------|--------|
| `.env.vercel.development.local` | `vercel env pull --environment=development` |
| `.env.vercel.preview.local` | `vercel env pull --environment=preview` |
| `.env.vercel.production.local` | `vercel env pull --environment=production` |
| `.env.example` | **Committed** — placeholders only, no secrets |

Next.js loads `.env.local` by default; for Vercel-pulled files either **rename/copy** the one you need to `.env.local` or use a tool to merge—many devs symlink or copy Preview → `.env.local` when working against a preview DB.

## Automated test pipeline (overview)

| Layer | What runs | Where |
|-------|-----------|--------|
| **PR / push** | `lint` + Playwright `test:e2e:ci` vs production URL | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| **After prod deploy** | curl smoke: `/api/health`, tRPC | [`deploy-smoke.yml`](../../.github/workflows/deploy-smoke.yml) |
| **Schedule / manual** | Playwright `test:e2e:ci` | [`playwright-e2e.yml`](../../.github/workflows/playwright-e2e.yml) |

See also [`e2e/README.md`](../../e2e/README.md).

## References

- [Vercel: Environment variables](https://vercel.com/docs/projects/environment-variables)
- [Vercel CLI: `env pull`](https://vercel.com/docs/cli/env)
- [Vercel Marketplace Supabase → this repo](vercel-supabase-marketplace.md) — `POSTGRES_PRISMA_URL`, publishable vs anon key
