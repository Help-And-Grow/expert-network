# Repo & Deployment Strategy

This document defines the current repo policy after the Alibaba database migration decision on `2026-06-14`.

> **2026-06-14 — dual-push retired.** The project now uses a single routine source of truth: **`jlzxwt8/expert-network`**. The earlier Cloud Run / dual-push / showcase flow is retired. `Help-And-Grow/expert-network` remains only as a frozen public mirror / historical reference.

## 1. Source of truth

### `jlzxwt8/expert-network` — production source of truth

- **Local remote alias:** `origin`
- **Deploy:** Vercel GitHub App on push → `https://www.help-and-grow.com`
- **Database:** Alibaba ApsaraDB RDS Serverless (`helpgrow`)
- **AI provider:** whatever is active in the admin page (`/admin/providers`)
- **Routine policy:** all normal development, bug fixes, and deploy-triggering pushes happen here

### `Help-And-Grow/expert-network` — frozen public mirror

- **Deploy:** none
- **Routine policy:** do not push as part of normal development
- **Purpose:** historical reference, public visibility, optional manual sync only if explicitly requested

## 2. Deployment architecture

| Aspect | Steady state |
|---|---|
| GitHub repo | `jlzxwt8/expert-network` |
| Hosting | Vercel |
| Production URL | `https://www.help-and-grow.com` |
| Database | Alibaba ApsaraDB RDS Serverless |
| Default branch | `main` |
| Automatic deploy trigger | Vercel GitHub App on push |
| Public mirror | `Help-And-Grow/expert-network` |

## 3. Daily workflow

### Routine push

```bash
git push origin main
```

That should publish only to `jlzxwt8/expert-network` and trigger only the Vercel deployment.

### Required local remote configuration

If your clone still has the older dual-push configuration, clean it up once:

```bash
git remote set-url origin https://github.com/jlzxwt8/expert-network.git
git remote set-url --delete --push origin https://github.com/Help-And-Grow/expert-network.git
git remote set-url --add --push origin https://github.com/jlzxwt8/expert-network.git
git remote remove production 2>/dev/null || true
```

Expected output after cleanup:

```bash
git remote -v
origin  https://github.com/jlzxwt8/expert-network.git (fetch)
origin  https://github.com/jlzxwt8/expert-network.git (push)
```

### Optional manual mirror sync

Do not sync the `Help-And-Grow` mirror as part of routine work. If the mirror ever needs an update for a public showcase or archival reason, do it as an explicit one-off task and document the reason in the commit / release notes.

## 4. Vercel dashboard URLs (avoid 404)

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

## 5. Operational guidelines

### After each routine push

After the push, verify the Vercel surface:

```bash
# Vercel build status
vercel logs --follow https://www.help-and-grow.com
```

### Managing Vercel environment variables
Treat the Help And Grow Vercel project as the runtime source of truth, regardless of which GitHub repo is public.

Managing environment variables is simpler now that the live deployment stays on one provider stack and one routine repo.

**Workflow to update environments:**
```bash
# Pull the current production env locally
npx vercel env pull .env.vercel.production --project expert-network --environment production

# Edit or rotate the needed values

# Push the updated env back to production
npx vercel env push .env.vercel.production --project expert-network --environment production
```
