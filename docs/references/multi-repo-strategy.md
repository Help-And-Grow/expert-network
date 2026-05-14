# Repo & Showcase Deployment Strategy

This document defines how Help & Grow is operated across two GitHub repositories while keeping the live Vercel deployment stable and predictable.

> **2026-05-13 — MVP rollout: roles inverted.** Previously `jlzxwt8/expert-network` was the active daily-push target and `Help-And-Grow/expert-network` was a periodic mirror. With MVP rollout underway, the relationship flipped: `Help-And-Grow` is now the active development repo, and `jlzxwt8` is locked down as the production-only (Vercel-connected) repo that's touched only for verified bugfixes. The remaining sections reflect the new model; commit `65193be` (and earlier) documented the legacy dual-push model and is preserved in git history if you need to look it up.

## 1. Source of Truth — by responsibility

Help & Grow now uses a **production-locked source repo + active development repo** model. The two repos serve different audiences and have different push cadences.

### A. Production-locked repo: `jlzxwt8/expert-network`
- **Local remote name:** `production`
- **Role:** The Vercel GitHub App is connected here; every push to `jlzxwt8/main` auto-builds and deploys to **www.help-and-grow.com**.
- **Push cadence:** Rare. Touched only for verified bugfixes that the live site needs.
- **Read cadence:** Continuous. This is the canonical state of production.
- **Default rule:** Do **not** push here for new features, refactors, or experiments. The whole point of the lockdown is to stop the live site from drifting with every iteration.
- **Hotfix mechanism:**
  ```bash
  git fetch production
  git checkout -b hotfix/<short-name> production/main
  git cherry-pick <sha-from-Help-And-Grow>
  git push production HEAD:main
  # Then verify via `vercel logs --follow https://www.help-and-grow.com`.
  ```

### B. Active development repo: `Help-And-Grow/expert-network`
- **Local remote name:** `origin`
- **Role:** Daily feature work, hackathon demos, investor pitches, OpenAI + ByteDance credit-grant showcases, schema experiments, infrastructure prototyping. Every routine commit lands here first.
- **Push cadence:** Multiple times per day.
- **Vercel connection:** Not wired to www.help-and-grow.com. A separate Vercel project (or IGA Pages once it's set up) can be hooked up if you want a publicly addressable URL for the demos — that's an explicit decision per surface.
- **Default rule:** `git push origin main` is the routine command. All AI agents, the lead, and any future intern PRs target this repo unless explicitly told otherwise.

---

## 2. Deployment Architecture

The production Vercel project is owned by the **Help And Grow** Vercel team and is connected to `jlzxwt8/expert-network` (the locked-down repo). The mismatch between the GitHub org name (`Help-And-Grow`) and the connected repo (`jlzxwt8/…`) is intentional — see §1.

Current operating model:
1. **Git source for production deploys:** `jlzxwt8/expert-network`
2. **Vercel project owner:** `Help And Grow` team
3. **Daily commit target:** `Help-And-Grow/expert-network` (no auto-deploy)
4. **Default AI provider on production:** Qwen → Gemini chain (`AI_PROVIDER="qwen"`); the Volcengine/Doubao stack on Help-And-Grow can be enabled per-deploy via env vars (see [`iga-pages-volcengine-deployment.md`](../exec-plans/active/iga-pages-volcengine-deployment.md))

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

### Daily development (the routine path)

```bash
git push origin main   # → Help-And-Grow/main only
```

Every routine commit goes to `Help-And-Grow/expert-network`. No production deploy is triggered; nothing on www.help-and-grow.com changes. Iterate freely.

### Bug-fix promotion (the production path)

When a fix is verified and needs to reach the live site:

```bash
git fetch production
git checkout -b hotfix/<short-name> production/main
git cherry-pick <sha-from-Help-And-Grow>   # the verified-good commit
git push production HEAD:main              # → triggers Vercel auto-deploy
```

Verify:

```bash
vercel logs --follow https://www.help-and-grow.com
```

Wait for the Ready state, then smoke-test the live site. Delete the local `hotfix/<short-name>` branch.

### Required local remote configuration

```bash
# One-time setup on the maintainer's clone:
git remote remove origin       2>/dev/null || true
git remote remove helpandgrow  2>/dev/null || true
git remote remove production   2>/dev/null || true

git remote add origin     https://github.com/Help-And-Grow/expert-network.git
git remote add production https://github.com/jlzxwt8/expert-network.git

# Verify:
git remote -v
# Expected output:
#   origin      https://github.com/Help-And-Grow/expert-network.git (fetch)
#   origin      https://github.com/Help-And-Grow/expert-network.git (push)
#   production  https://github.com/jlzxwt8/expert-network.git       (fetch)
#   production  https://github.com/jlzxwt8/expert-network.git       (push)
```

### Keeping the two repos from drifting

Both repos hold the same `main` branch in spirit, but only the bugfix subset reaches `production`. The full feature history accumulates on `origin`. To compare:

```bash
git fetch origin production
git log production/main..origin/main --oneline   # commits on Help-And-Grow not yet promoted to jlzxwt8
git log origin/main..production/main --oneline   # commits on jlzxwt8 not in Help-And-Grow (should normally be 0 — out-of-band production push)
```

If `production/main` ever has commits not in `origin/main` (i.e. someone pushed directly to jlzxwt8 without going through Help-And-Grow), pull those into Help-And-Grow promptly to re-align:

```bash
git fetch production
git checkout main
git merge --ff-only production/main || git rebase production/main
git push origin main
```

### Why not a CI workflow?

GitHub Actions on `jlzxwt8` are paused until 2026-06-01 (account minutes exhausted — see commit `ddf8519`). When they resume, the bug-fix-promotion step could be automated, but the manual cherry-pick is the right default during MVP rollout because each production push deserves explicit thought.

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
