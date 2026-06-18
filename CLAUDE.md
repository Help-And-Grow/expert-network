# Project Guidelines

## Audience

This file is the **project lead's** working spec — Claude (and any AI agent) follows these rules when iterating on the codebase with the lead.

Interns and new collaborators should read [`docs/ONBOARDING.md`](docs/ONBOARDING.md) first. Interns are **read-only by default**: they do not push to `main`, do not run anything against the production database, and do not touch env vars on Vercel or IGA Pages. When given a coding task, interns push to a feature branch (`interns/<name>/<topic>`) and have the project lead review before any merge.

## Workflow — Solo PM

This is a solo-PM project, in **MVP rollout** (May 2026 onward). Routine source of truth is now **one repo, one deploy path**. Keep the process lean.

### Repo roles

| Remote | GitHub | Deploy target | Notes |
|---|---|---|---|
| `origin` | `jlzxwt8/expert-network` | Vercel → `www.help-and-grow.com` | Routine development, deploy-triggering pushes, and production source of truth |
| `mirror` | `Help-And-Grow/expert-network` | none | Frozen public mirror; do not routine-push or treat as a live deploy target |

### Default rule

**`git push origin main`** is the routine. It publishes only to `jlzxwt8/expert-network`, and Vercel GitHub App auto-deploys `www.help-and-grow.com`.

### Deploy configuration

- **Compute:** Vercel
- **Database:** Alibaba ApsaraDB RDS Serverless for PostgreSQL
- **AI provider routing:** admin-page driven in production unless a future deploy explicitly sets `AI_PROVIDER_LOCK`
- **Mirror policy:** `Help-And-Grow/expert-network` is archival only unless the project lead explicitly requests a manual sync

### Other rules

1. **Skip preview/UI verification on the dev path.** Do not spin up dev servers or take browser screenshots to verify UI changes. Trust the build and live testing.
2. **After a routine push, verify the Vercel deploy.** `vercel logs --follow https://www.help-and-grow.com`.
3. **WeChat mini program changes** — after pushing, trigger `wechat-ci.yml` via `gh workflow run` if not already triggered by the push. Set the new upload as 体验版 in 微信公众平台 for live user testing.
4. **User testing happens on www.help-and-grow.com** unless a future dedicated demo surface is explicitly created.

## Branch strategy

- Default: commit and push straight to `main`. `git push origin main` reaches `jlzxwt8/expert-network`.
- Feature branches (`claude/…`) are acceptable for larger changes but must be merged to `main` immediately — do not leave them open.
- After merging a feature branch to `main`, delete the feature branch.

## Deploy verification

After `git push origin main`:

| Target | Build trigger | Verify |
|---|---|---|
| Vercel (jlzxwt8 → www.help-and-grow.com) | Vercel GitHub App | `vercel logs --follow https://www.help-and-grow.com` |

It should reach Ready / Success within a few minutes.

## WeChat CI

- `wechat-ci.yml` triggers automatically on pushes to `main`.
- For feature-branch pushes, trigger manually:
  ```
  gh workflow run wechat-ci.yml --ref <branch> -f version="x.y.z" -f description="…"
  ```
- Tokens / design system — spacing scale is: `$spacing-0/1/2/3/4/5/6/8/10/12/16`. There is no `$spacing-7`, `$spacing-9`, etc. — use the nearest defined value.
