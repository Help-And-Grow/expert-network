# Project Guidelines

## Audience

This file is the **project lead's** working spec — Claude (and any AI agent) follows these rules when iterating on the codebase with the lead.

Interns and new collaborators should read [`docs/ONBOARDING.md`](docs/ONBOARDING.md) first. Interns are **read-only by default**: they do not push to `main`, do not run anything against the production database, and do not touch env vars on Vercel or IGA Pages. When given a coding task, interns push to a feature branch (`interns/<name>/<topic>`) and have the project lead review before any merge.

## Workflow — Solo PM

This is a solo-PM project, in **MVP rollout** (May 2026 onward). Two repos, same code, different deploy targets. Keep the process lean.

### Repo roles

| Remote | GitHub | Deploy target | AI provider |
|---|---|---|---|
| `origin` | **Both** `Help-And-Grow/expert-network` AND `jlzxwt8/expert-network` (dual-push) | Help-And-Grow → Cloud Run; jlzxwt8 → Vercel www.help-and-grow.com | Cloud Run is pinned to **Gemini** via `AI_PROVIDER_LOCK=gemini`; Vercel uses whatever's set in the **admin page** (currently Qwen) |
| `production` | `jlzxwt8/expert-network` (single-target convenience for hotfix-style pushes) | Vercel www.help-and-grow.com | (same as above) |

The local `origin` remote has two `(push)` URLs configured so a single `git push origin main` publishes to both GitHub repos at once. Verify with `git remote -v` — there should be two `origin … (push)` lines plus one `origin … (fetch)`.

### Default rule

**`git push origin main`** is the routine. It publishes to both repos. Cloud Build trigger on Help-And-Grow auto-rolls a new Cloud Run revision; Vercel GitHub App auto-deploys the jlzxwt8 push to www.help-and-grow.com.

### Per-deploy divergence is at the env layer, not the code layer

The two deploys share the same source code. They differ only in:

| Env var | Vercel (www.help-and-grow.com) | Cloud Run (Help-And-Grow demo) |
|---|---|---|
| `AI_PROVIDER_LOCK` | unset → routes via admin page / SystemConfig | `gemini` → bypasses DB routing, always uses Gemini |
| `AI_PROVIDER` | `qwen` | `gemini` (effectively ignored once `AI_PROVIDER_LOCK` is set) |
| `AI_TEXT_PROVIDER_CHAIN` | unset (default chain via DB) | `gemini` (effectively ignored once `AI_PROVIDER_LOCK` is set) |
| `DATABASE_URL`, `AUTH_SECRET`, `GEMINI_API_KEY`, etc. | Vercel-encrypted | Google Secret Manager refs |

If you need to add a new env var that should diverge between the two surfaces, set it via the respective deploy mechanism (Vercel dashboard for jlzxwt8; `gcloud run services update` for Help-And-Grow). The code reads `process.env` either way and stays identical.

### Other rules

1. **Skip preview/UI verification on the dev path.** Do not spin up dev servers or take browser screenshots to verify UI changes. Trust the build and live testing.
2. **After a routine push, verify both deploys.** Vercel: `vercel logs --follow https://www.help-and-grow.com`. Cloud Run: `gcloud run services logs read expert-network --region=asia-southeast1 --limit=200` or `gcloud builds list --limit=2 --filter="source.repoSource.repoName:Help-And-Grow*"`.
3. **WeChat mini program changes** — after pushing, trigger `wechat-ci.yml` via `gh workflow run` if not already triggered by the push. Set the new upload as 体验版 in 微信公众平台 for live user testing. (GitHub Actions are paused on `jlzxwt8` until 2026-06-01 — see commit `ddf8519`; the workflow runs on `Help-And-Grow` instead.)
4. **User testing for production happens on www.help-and-grow.com.** Hackathon / investor / demo testing happens on the Cloud Run URL (`expert-network-druobkk2ma-as.a.run.app`).

## Branch strategy

- Default: commit and push straight to `main`. `git push origin main` reaches both repos in one command.
- Feature branches (`claude/…`) are acceptable for larger changes but must be merged to `main` immediately — do not leave them open.
- After merging a feature branch to `main`, delete the feature branch.

## Deploy verification

After `git push origin main`:

| Target | Build trigger | Verify |
|---|---|---|
| Vercel (jlzxwt8 → www.help-and-grow.com) | Vercel GitHub App | `vercel logs --follow https://www.help-and-grow.com` |
| Cloud Run (Help-And-Grow → run.app URL) | Cloud Build trigger `rmgpgab-…` | `gcloud builds list --limit=1 --filter="source.repoSource.repoName:Help-And-Grow*"` |

Both should reach Ready / Success within a few minutes.

## WeChat CI

- `wechat-ci.yml` triggers automatically on pushes to `main`.
- For feature-branch pushes, trigger manually:
  ```
  gh workflow run wechat-ci.yml --ref <branch> -f version="x.y.z" -f description="…"
  ```
- Tokens / design system — spacing scale is: `$spacing-0/1/2/3/4/5/6/8/10/12/16`. There is no `$spacing-7`, `$spacing-9`, etc. — use the nearest defined value.
