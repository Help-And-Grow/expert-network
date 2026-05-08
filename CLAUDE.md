# Project Guidelines

## Workflow — Solo PM

This is a solo-PM project. Keep the process lean:

1. **Commit & push directly to `main`** (or merge feature branches into `main` immediately after work is done). No PR review gate required.
2. **Skip preview/UI verification.** Do not spin up dev servers or take browser screenshots to verify UI changes. Trust the build and live testing.
3. **After pushing to `main`, verify the Vercel build succeeds** — check deployment logs via `vercel logs` or the Vercel dashboard. If the build fails, fix and push again.
4. **WeChat mini program changes** — after pushing to `main`, trigger `wechat-ci.yml` via `gh workflow run` if not already triggered by the push. Then set the new upload as 体验版 in 微信公众平台 for live user testing.
5. **User testing happens in Production directly.** No staging sign-off step.

## Branch strategy

- Default: commit and push straight to `main`.
- Feature branches (`claude/…`) are acceptable for larger changes but must be merged to `main` immediately — do not leave them open.
- After merging a feature branch to `main`, delete the feature branch.

## Vercel

- Production deploys automatically on every push to `main`.
- After a push, confirm the deployment is healthy before considering the task done:
  ```
  vercel logs --prod
  ```
  or check the Vercel dashboard for build status.

## WeChat CI

- `wechat-ci.yml` triggers automatically on pushes to `main`.
- For feature-branch pushes, trigger manually:
  ```
  gh workflow run wechat-ci.yml --ref <branch> -f version="x.y.z" -f description="…"
  ```
- Tokens / design system — spacing scale is: `$spacing-0/1/2/3/4/5/6/8/10/12/16`. There is no `$spacing-7`, `$spacing-9`, etc. — use the nearest defined value.
