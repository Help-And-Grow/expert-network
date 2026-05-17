# Repo & Showcase Deployment Strategy

This document defines how Help & Grow is operated across two GitHub repositories while keeping the live Vercel deployment stable and predictable.

> **2026-05-17 — dual-push restored, divergence moved to the env layer.** The Help-And-Grow-only-active phase (commit `84e2c0b` to `def0d1a3`) created too much friction maintaining two histories. Same code now ships to both repos via a single dual-push `origin`; the per-deploy provider/storage/etc. choices live entirely in environment variables on each platform. The repos converge in code, diverge only at deploy config.

## 1. Source of Truth — by responsibility

Help & Grow uses a **dual-push** model: one `git push origin main` publishes to both repos, and each repo's deploy target picks up the same code with its own env vars.

### A. `jlzxwt8/expert-network` — Vercel production
- **Local remote alias:** `origin` (push) + `production` (push & fetch). `git push origin main` covers it as part of the dual-push.
- **Deploy:** Vercel GitHub App on push → www.help-and-grow.com.
- **AI provider:** whatever's set in the **admin page** (`/admin/providers`) → SystemConfig + ProviderRoutingScope in Cloud SQL. Currently Qwen-primary, Gemini fallback.
- **Storage:** Vercel Blob / GCS / Tencent COS (admin-driven).

### B. `Help-And-Grow/expert-network` — Cloud Run demo
- **Local remote alias:** `origin` (push & fetch). `git push origin main` covers it as part of the dual-push.
- **Deploy:** Cloud Build trigger on push → Cloud Run service `expert-network` in `asia-southeast1` → https://expert-network-druobkk2ma-as.a.run.app. Full runbook: [`docs/exec-plans/active/help-and-grow-cloud-run-deployment.md`](../exec-plans/active/help-and-grow-cloud-run-deployment.md).
- **AI provider:** **Gemini only.** Locked via `AI_PROVIDER_LOCK=gemini` env on Cloud Run, which short-circuits all DB-driven routing (SystemConfig + ProviderRoutingScope). Vercel leaves this var unset, so the admin page continues to drive Vercel.
- **Storage:** `STORAGE_PROVIDER=db` for now (no dedicated GCS bucket yet).

---

## 2. Deployment Architecture

| Aspect | jlzxwt8 → Vercel | Help-And-Grow → Cloud Run |
|---|---|---|
| Vercel team / GCP project | `Help And Grow` team | `expert-network-489508` (`asia-southeast1`) |
| Service / URL | `expert-network` → www.help-and-grow.com | `expert-network` → https://expert-network-druobkk2ma-as.a.run.app |
| Build trigger | Vercel GitHub App | Cloud Build trigger `rmgpgab-…-Help-And-Grow-expert-gps` |
| DB | Cloud SQL `hg-postgres-prod` (shared) | Cloud SQL `hg-postgres-prod` (shared) |
| Storage | admin-driven (Vercel Blob / GCS / Tencent COS) | `STORAGE_PROVIDER=db` (until dedicated GCS bucket lands) |
| Text LLM | admin-page driven (`AI_PROVIDER=qwen` default) | **Gemini only** via `AI_PROVIDER_LOCK=gemini` |
| Secrets storage | Vercel encrypted env | Google Secret Manager refs (see [Cloud Run runbook §3](../exec-plans/active/help-and-grow-cloud-run-deployment.md)) |

Both deploys read the **same Cloud SQL DB**, so schema migrations propagate to both. The auto-migration postinstall (`prisma-migrate-if-vercel.mjs`) only fires when `VERCEL=1` is set — so Vercel pushes migrate, Cloud Build pushes don't. This is intentional: production migration is one source of truth, Cloud Run picks up the new columns on its next deploy.

### The `AI_PROVIDER_LOCK` env

Cloud Run sets `AI_PROVIDER_LOCK=gemini`. When set, the application short-circuits **all** AI provider resolution (DB-driven `ProviderRoutingScope`, `SystemConfig.AI_PROVIDER`, `SystemConfig.AI_TEXT_PROVIDER_CHAIN`, env `AI_PROVIDER`, env `AI_TEXT_PROVIDER_CHAIN`) and routes every call — `chat`, `improveWriting`, `generateExpertProfile`, `normalizeQuery`, `generateProfileImage` — to the named provider directly. This is how Cloud Run stays Gemini-only despite the shared Cloud SQL holding production's Qwen-first routing rules. Implemented in `src/lib/ai/index.ts`.

Vercel leaves `AI_PROVIDER_LOCK` unset, so the admin page (`/admin/providers`) keeps full control over production routing.

### Vercel dashboard URLs (avoid 404)

Deployment pages use:

`https://vercel.com/<team-slug>/<project-slug>`  
`https://vercel.com/<team-slug>/<project-slug>/dpl_<id>`

If **`<team-slug>`** is wrong, Vercel returns **404 NOT_FOUND** for the **dashboard** URL only. That does **not** change how `*.vercel.app` resolves; dashboard 404 and live-site 404 are different problems (see below).

Vercel teams can differ from GitHub orgs. The **team switcher** in the dashboard is authoritative: projects may live under **`jlzxwt8s-projects`**, **`helpandgrow`**, or another team you were invited to.

| Project | Production URL | Example dashboard path |
|---------|----------------|-------------------------|
| `expert-network` | https://www.help-and-grow.com (canonical) · `https://expert-network.vercel.app` (deployment alias) | `https://vercel.com/<team-slug>/expert-network` |

Copy **deployment** links from the Deployments list; the id must look like **`dpl_…`**. **Branch/deployment** hostnames embed the owning team, e.g. `…-git-main-helpandgrow.vercel.app` or `…-git-main-jlzxwt8s-projects.vercel.app` — use the suffix shown on **your** deployment card.

### Live site `*.vercel.app` returns 404 (`NOT_FOUND`) while deployment shows Ready

If **`https://<project-slug>.vercel.app/`** returns **HTTP 404** with **`content-type: text/plain`**, body like `The page could not be found`, and **`x-vercel-error: NOT_FOUND`**, that response comes from **Vercel’s edge**, not from Next.js (a Next.js app 404 is usually HTML). The build can still be **Ready** in the UI.

**Checklist (per project):**

1. **Settings → Domains** — Confirm **`<project-slug>.vercel.app`** is attached to **this** project, shows **Valid**, and serves **Production**. Re-add the default domain if it is missing or conflicting.
2. **Deployments** — Confirm a **Production** deployment exists for the expected branch (e.g. `main`). **Redeploy** after fixing domains if needed. If **`project-git-main-….vercel.app`** returns **401** (deployment protection) but **`project.vercel.app`** still returns edge **`NOT_FOUND`**, the domain is fine but the **production slot is empty or not wired**: open the latest successful **`main`** deployment → **Promote to Production**, or trigger a fresh production deploy from **Deployments**.
3. **Git** — Confirm the connected repo and **Production Branch** match the deployment you expect.
4. **Deployment Protection** — URLs like **`*-git-main-*.vercel.app`** may return **401 Authentication Required** for unauthenticated clients (including `curl` and sometimes the dashboard preview). That is separate from production-domain **404**; use [protection bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) for automation or adjust protection in **Project → Settings → Deployment Protection**.
5. **Vercel CLI** — If `vercel project ls` shows no projects, the CLI scope may be the wrong team (e.g. `helpandgrow` vs **`jlzxwt8s-projects`**). Match the **team switcher** in the dashboard before running `vercel link` / env commands.
6. **Redeploy did not help** — Compare **Project → Settings → General** (Root Directory, Framework Preset, Build / Output settings) with a project that works (e.g. `expert-network`). Open the production deployment → confirm **Functions** / build output lists Next routes. If the domain is **Valid**, production is **Ready**, and unauthenticated requests still get **`x-vercel-error: NOT_FOUND`** on **`project.vercel.app`**, contact **Vercel support** with that header’s **`x-vercel-id`** — this is platform routing, not application HTML.

### How it works

The live project should be treated as:

- **Team / dashboard owner:** `helpandgrow`
- **Git deployment source:** `jlzxwt8/expert-network`
- **Default production branch:** `main`

Do not assume the GitHub org and the Vercel team are the same thing. The dashboard owner controls the project, but the connected Git repository controls automatic deploys.

---

## 3. Operational Guidelines

### Daily development (single dual-push)

```bash
git push origin main   # → Help-And-Grow/main AND jlzxwt8/main, in one command
```

`fetch` resolves to Help-And-Grow only (the active code stream). `push` fires both URLs. Both deploys auto-build from their respective triggers. After the push, verify both surfaces:

```bash
# Vercel build status
vercel logs --follow https://www.help-and-grow.com

# Cloud Build / Cloud Run status
gcloud builds list --limit=1 --filter="source.repoSource.repoName:Help-And-Grow*"
gcloud run services describe expert-network --region=asia-southeast1 --format="value(status.traffic[0].revisionName)"
```

### Required local remote configuration

```bash
# One-time setup on the maintainer's clone:
git remote remove origin       2>/dev/null || true
git remote remove helpandgrow  2>/dev/null || true
git remote remove production   2>/dev/null || true

# origin: fetches from Help-And-Grow (the active code stream),
#         pushes to BOTH repos so a single `git push origin main` covers both deploys.
git remote add origin https://github.com/Help-And-Grow/expert-network.git
git remote set-url --add --push origin https://github.com/jlzxwt8/expert-network.git

# production: jlzxwt8-only convenience for the occasional Vercel-only push.
git remote add production https://github.com/jlzxwt8/expert-network.git

# Verify (origin should have 2× (push) URLs):
git remote -v
```

Expected output:
```
origin      https://github.com/Help-And-Grow/expert-network.git (fetch)
origin      https://github.com/Help-And-Grow/expert-network.git (push)
origin      https://github.com/jlzxwt8/expert-network.git       (push)
production  https://github.com/jlzxwt8/expert-network.git       (fetch)
production  https://github.com/jlzxwt8/expert-network.git       (push)
```

### Keeping the two repos at the same SHA

After `git push origin main` both repos should be at the same HEAD. Verify any time:

```bash
echo "jlzxwt8:        $(gh api repos/jlzxwt8/expert-network/branches/main --jq '.commit.sha')"
echo "Help-And-Grow:  $(gh api repos/Help-And-Grow/expert-network/branches/main --jq '.commit.sha')"
```

If they diverge — e.g. one push reached only one repo due to a transient network failure — re-push the missing one:

```bash
# Reach the lagging repo specifically:
git push origin main      # tries both; the up-to-date one is a no-op
git push production main  # explicit jlzxwt8 fallback
```

### Vercel-only push (rare)

For the unusual case where a change should reach production *without* simultaneously updating the Cloud Run demo (e.g. a Vercel-specific config tweak that doesn't apply on Cloud Run):

```bash
git push production main
```

This uses the dedicated `production` remote (jlzxwt8 only) and skips Help-And-Grow. Then run the dual-push later to re-sync once the change is ready for both surfaces.

### Managing Vercel environment variables
Treat the Help And Grow Vercel project as the runtime source of truth, regardless of which GitHub repo is public.

Managing environment variables is simpler when the live deployment stays on one provider stack. We keep the `scripts/vercel-merge-env.mjs` utility to safely propagate shared core settings (like database URLs and auth secrets) while preserving Alibaba-specific keys.

**Workflow to update environments:**
```bash
# 1. Pull the master configuration from your private origin project
npx vercel env pull /tmp/vercel-origin-production.env --project expert-network --environment production

# 2. Pull the showcase project's current configuration
npx vercel env pull /tmp/vercel-alibabacloud-production.env --project expert-network --environment production

# 3. Merge them intelligently using our script
npm run vercel:env:alibabacloud

# 4. Apply the merged configuration back to Vercel
npx vercel env push .env.vercel.alibabacloud.sync --project expert-network --environment production
```

This strategy ensures your product remains highly agile in private while maintaining a stable Alibaba/Qwen public showcase.
