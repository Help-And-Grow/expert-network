# Multi-Repo & Multi-Tenant Deployment Strategy

This document outlines the architectural plan and operational guidelines for managing the Help & Grow platform across multiple GitHub repositories and multi-tenant Vercel deployments.

## 1. Dual Repository Strategy

To balance rapid, experimental development with stable, open-source presentations (for hackathons, investors, and partners), the codebase is split into two synchronized repositories:

### A. The Origin Repository (`jlzxwt8/expert-network`)
- **Visibility:** Private
- **Purpose:** 
  - Core R&D environment.
  - Testing bleeding-edge multi-agent frameworks (OpenClaw, HiClaw, Scion, BytePlus Coze).
  - Storing experimental prompts, proprietary AI logic, and sensitive integration keys.
- **Iteration Cycle:** High frequency, experimental branches, rapid prototyping.

### B. The Showcase Repository (`Help-And-Grow/expert-network`)
- **Visibility:** Public
- **Purpose:** 
  - Stable, open-source reference for the community.
  - Clean, sanitized codebase for hackathons, investor demos, and partner showcases.
- **Iteration Cycle:** Periodically synced from the Origin repository when features reach a stable, demo-ready state. Sensitive hardcoded keys and purely experimental logic must be stripped before pushing.

---

## 2. Multi-Tenant Vercel Architecture

Instead of duplicating code, the Showcase repository powers multiple distinct cloud-provider environments using a single codebase.

We have established three dedicated Vercel projects:
1. **`expert-network-alibabacloud`**: Uses the DashScope/Qwen provider (`AI_PROVIDER="qwen"`).
2. **`expert-network-googlecloud`**: Uses the Vertex AI/Gemini provider (`AI_PROVIDER="gemini"`).
3. **`expert-network-byteplus`**: Uses the ModelArk/Doubao provider (`AI_PROVIDER="byteplus"`).

### Vercel dashboard URLs (avoid 404)

Deployment pages use:

`https://vercel.com/<team-slug>/<project-slug>`  
`https://vercel.com/<team-slug>/<project-slug>/dpl_<id>`

If **`<team-slug>`** is wrong, Vercel returns **404 NOT_FOUND** for the **dashboard** URL only. That does **not** change how `*.vercel.app` resolves; dashboard 404 and live-site 404 are different problems (see below).

For the private origin repo **`jlzxwt8/expert-network`**, these projects are typically linked under team **`jlzxwt8s-projects`** (check **Vercel → team switcher → Project → Settings** if unsure).

| Project | Production URL | Dashboard (when team is `jlzxwt8s-projects`) |
|---------|----------------|-----------------------------------------------|
| `expert-network` | https://expert-network.vercel.app | https://vercel.com/jlzxwt8s-projects/expert-network |
| `expert-network-googlecloud` | https://expert-network-googlecloud.vercel.app | https://vercel.com/jlzxwt8s-projects/expert-network-googlecloud |
| `expert-network-alibabacloud` | https://expert-network-alibabacloud.vercel.app | https://vercel.com/jlzxwt8s-projects/expert-network-alibabacloud |
| `expert-network-byteplus` | https://expert-network-byteplus.vercel.app | https://vercel.com/jlzxwt8s-projects/expert-network-byteplus |

Copy **deployment** links from the Deployments list; the id must look like **`dpl_…`**. Paths such as `/helpandgrow/expert-network-googlecloud/…` only work if that team actually owns the project.

### Live site `*.vercel.app` returns 404 (`NOT_FOUND`) while deployment shows Ready

If **`https://<project-slug>.vercel.app/`** returns **HTTP 404** with **`content-type: text/plain`**, body like `The page could not be found`, and **`x-vercel-error: NOT_FOUND`**, that response comes from **Vercel’s edge**, not from Next.js (a Next.js app 404 is usually HTML). The build can still be **Ready** in the UI.

**Checklist (per project):**

1. **Settings → Domains** — Confirm **`<project-slug>.vercel.app`** is attached to **this** project, shows **Valid**, and serves **Production**. Re-add the default domain if it is missing or conflicting.
2. **Deployments** — Confirm a **Production** deployment exists for the expected branch (e.g. `main`). **Redeploy** after fixing domains if needed. If **`project-git-main-….vercel.app`** returns **401** (deployment protection) but **`project.vercel.app`** still returns edge **`NOT_FOUND`**, the domain is fine but the **production slot is empty or not wired**: open the latest successful **`main`** deployment → **Promote to Production**, or trigger a fresh production deploy from **Deployments**.
3. **Git** — Confirm the connected repo and **Production Branch** match the deployment you expect.
4. **Deployment Protection** — URLs like **`*-git-main-*.vercel.app`** may return **401 Authentication Required** for unauthenticated clients (including `curl` and sometimes the dashboard preview). That is separate from production-domain **404**; use [protection bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) for automation or adjust protection in **Project → Settings → Deployment Protection**.
5. **Vercel CLI** — If `vercel project ls` shows no projects, the CLI scope may be the wrong team (e.g. `helpandgrow` vs **`jlzxwt8s-projects`**). Match the **team switcher** in the dashboard before running `vercel link` / env commands.

### How it works:
All three Vercel projects are linked to the **same** GitHub repository branch (`Help-And-Grow/expert-network:main`). The codebase dynamically adapts its behavior based on the Vercel Environment Variables injected at runtime.

---

## 3. Operational Guidelines (Long-Term Self-Iteration)

To maintain this system long-term without configuration drift, follow these operational workflows:

### Syncing Code (Private -> Public)
When a feature in the private repository is ready for public showcase:
1. Ensure no sensitive keys (API keys, DB credentials) are hardcoded.
2. Push the changes to the public repository:
   ```bash
   git push origin main      # Pushes to private R&D repo
   git push hackathon main   # Pushes to public showcase repo
   ```
3. Vercel will automatically detect the push to the `hackathon` remote and trigger parallel builds across all three cloud provider projects.

### Managing Multi-Tenant Environment Variables
Managing separate environment variables for 3 projects can be tedious. We built the `scripts/vercel-merge-env.mjs` utility to safely propagate shared core settings (like Database URLs, Auth Secrets) while preserving provider-specific keys.

**Workflow to update environments:**
```bash
# 1. Pull the master configuration from your private origin project
npx vercel env pull /tmp/vercel-origin-production.env --project expert-network --environment production

# 2. Pull the target project's current configuration
npx vercel env pull /tmp/vercel-alibabacloud-production.env --project expert-network-alibabacloud --environment production

# 3. Merge them intelligently using our script
npm run vercel:env:alibabacloud

# 4. Apply the merged configuration back to Vercel
npx vercel env push .env.vercel.alibabacloud.sync --project expert-network-alibabacloud --environment production
```

This strategy ensures your product remains highly agile in private while maintaining a robust, multi-cloud presence publicly.