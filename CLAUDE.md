# Project Guidelines

## Audience

This file is the **project lead's** working spec — Claude (and any AI agent) follows these rules when iterating on the codebase with the lead.

Interns and new collaborators should read [`docs/ONBOARDING.md`](docs/ONBOARDING.md) first. Interns are **read-only by default**: they do not push to `main`, do not run anything against the production database, and do not touch env vars on Vercel or IGA Pages. When given a coding task, interns push to a feature branch (`interns/<name>/<topic>`) and have the project lead review before any merge.

## Workflow — Solo PM

This is a solo-PM project, now in **MVP rollout** (2026-05-13 onward). Two repos, different roles. Keep the process lean.

### Repo roles

| Remote | GitHub | Role | Vercel connection |
|---|---|---|---|
| `origin` | `Help-And-Grow/expert-network` | **Active development** — daily commits, new features, hackathon demos, investor showcases, credit-grant submissions | Not auto-deployed to www.help-and-grow.com (separate Vercel project / IGA Pages if hooked up) |
| `production` | `jlzxwt8/expert-network` | **Production lockdown** — touched only for verified bugfixes the live site needs | Auto-deploys to www.help-and-grow.com via the Vercel GitHub App |

### Default rule

**All new code goes to `origin` (Help-And-Grow) only.** A simple `git push origin main` is the routine. The Vercel-connected `jlzxwt8` repo (`production` remote) is **not** the daily push target — leaving it stable is the entire point of MVP discipline.

### When to push to `production` (the jlzxwt8 path)

Only when **all three** are true:

1. You've fixed an actual production bug surfaced by live users on www.help-and-grow.com.
2. The fix has been smoke-tested on Help-And-Grow (or locally) and is small and isolated.
3. The lead has explicitly authorized the production push (or is the one running the command).

Mechanism — cherry-pick the verified-good commit onto a clean `production` branch base and push:

```bash
git fetch production
git checkout -b hotfix/<short-name> production/main
git cherry-pick <sha-from-Help-And-Grow>
git push production HEAD:main
```

Then verify Vercel auto-deploys and the bug is gone. Delete the hotfix branch.

### Other rules

1. **Skip preview/UI verification on the dev path.** Do not spin up dev servers or take browser screenshots to verify UI changes. Trust the build and live testing.
2. **No Vercel build to check after a routine push to `origin`** — Help-And-Grow isn't auto-connected. Only verify Vercel deploy status after a `production` push (cf. `vercel logs --follow https://www.help-and-grow.com`).
3. **WeChat mini program changes** — after pushing to whichever repo, trigger `wechat-ci.yml` via `gh workflow run` if not already triggered by the push. Set the new upload as 体验版 in 微信公众平台 for live user testing. (GitHub Actions are paused on `jlzxwt8` until 2026-06-01 — see commit `ddf8519`.)
4. **User testing for production happens on www.help-and-grow.com.** Hackathon / investor / demo testing happens on the Help-And-Grow surface (whatever's hooked up to that repo).

## Branch strategy

- Default: commit and push straight to `main` of the relevant repo (almost always `origin` = Help-And-Grow).
- Feature branches (`claude/…`) are acceptable for larger changes but must be merged to `main` immediately — do not leave them open.
- After merging a feature branch to `main`, delete the feature branch.
- Hotfix branches (`hotfix/…`) live only for the duration of the cherry-pick → push to `production` → delete cycle.

## Vercel

- Production (www.help-and-grow.com) deploys automatically on every push to `production/main` (jlzxwt8). It does **not** auto-deploy on pushes to `origin/main` (Help-And-Grow) — that's the lockdown.
- After a hotfix push to `production`, confirm the deployment is healthy before considering the task done:
  ```
  vercel logs --follow https://www.help-and-grow.com
  ```
  or check the Vercel dashboard for build status.

## WeChat CI

- `wechat-ci.yml` triggers automatically on pushes to `main`.
- For feature-branch pushes, trigger manually:
  ```
  gh workflow run wechat-ci.yml --ref <branch> -f version="x.y.z" -f description="…"
  ```
- Tokens / design system — spacing scale is: `$spacing-0/1/2/3/4/5/6/8/10/12/16`. There is no `$spacing-7`, `$spacing-9`, etc. — use the nearest defined value.
