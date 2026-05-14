# Repo & Showcase Deployment Strategy

This document defines how Help & Grow is operated across two GitHub repositories while keeping the live Vercel deployment stable and predictable.

## 1. Source of Truth

Help & Grow uses a **primary repo + periodic public mirror** model.

### A. Primary Repository (`jlzxwt8/expert-network`)
- **Role:** Canonical engineering repo and default working remote.
- **Vercel:** This is the Git source that production and preview deployments are expected to follow unless explicitly reconfigured.
- **Purpose:**
  - Daily feature work
  - Schema and infrastructure changes
  - Production fixes
  - Experiments that are still part of the main product line
- **Default rule:** Agents should read from, branch from, merge into, and push to `origin` unless the user explicitly asks to sync the public repo.

### B. Public Repository (`Help-And-Grow/expert-network`)
- **Role:** Public, community-facing mirror.
- **Purpose:**
  - Open-source visibility
  - Hackathon submissions
  - Demo-ready snapshots for community contributors
- **Default rule:** Do **not** push every change here. Sync only when the user explicitly asks, typically before hackathons or curated public releases.

---

## 2. Deployment Architecture

The production Vercel project is operated under the **Help And Grow** Vercel team, but the connected Git source for normal iteration is the primary repository: `jlzxwt8/expert-network`.

Current operating model:
1. **Git source for deploys:** `jlzxwt8/expert-network`
2. **Vercel project owner:** `Help And Grow`
3. **Public mirror:** `Help-And-Grow/expert-network` only when explicitly synced
4. **Default provider stack for the public deployment:** Alibaba DashScope / Qwen (`AI_PROVIDER="qwen"`)

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

To avoid repository drift, use these workflows.

### Normal development
For normal product work:

```bash
git push origin <branch>
```

- Merge to `origin/main` for production-bound changes.
- Let Vercel build from the primary repository.
- Do not push to `hackathon` unless the user explicitly asks for a public sync.

### Public sync / hackathon prep

As of MVP rollout (2026-05-13), the repos are operated as a **one-way mirror**: every commit to `jlzxwt8/main` is mirrored to `Help-And-Grow/main` so the hackathon / investor / credit-grant audience always sees current production code. To make this a single command, the local `origin` remote is configured to push to **both** repos in one shot:

```bash
# One-time setup (already applied on the maintainer's clone):
git remote set-url --push origin https://github.com/jlzxwt8/expert-network.git
git remote set-url --add --push origin https://github.com/Help-And-Grow/expert-network.git

# Verify — `(push)` should list BOTH URLs:
git remote -v
```

With that configuration, the routine workflow is just:

```bash
git push origin main   # pushes to jlzxwt8/main AND Help-And-Grow/main
```

`fetch` still resolves to `jlzxwt8` only, preserving the source-of-truth model. If a divergence ever appears (e.g. Help-And-Grow gets an out-of-band commit), `git fetch helpandgrow main` reveals it; reconcile with a rebase or force-push as appropriate.

The pre-existing `helpandgrow` remote is kept around as an addressable alias for one-off operations (`git push helpandgrow …`, `git fetch helpandgrow …`).

**Why not a CI workflow?** GitHub Actions on `jlzxwt8` are paused until 2026-06-01 (account minutes exhausted — see commit `ddf8519`). When they resume, a `sync-to-help-and-grow.yml` workflow can replace the local-only multi-push config, but until then this is the simplest robust mirror.

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
