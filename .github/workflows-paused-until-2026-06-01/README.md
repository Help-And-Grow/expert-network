# Workflows paused until 2026-06-01

GitHub Actions minutes on the `jlzxwt8` account were exhausted on
2026-05-12 (limit resets monthly, next reset on **2026-06-01**).
All workflows have been moved out of the canonical `.github/workflows/`
directory so GitHub no longer triggers them on push / PR / cron.

Production deploys continue to work — they're done from the Vercel CLI
(`vercel deploy --prod --yes`) or via the `/admin/providers` admin
button, both of which bypass GitHub Actions entirely.

## To re-enable on 2026-06-01

```bash
cd /Users/qiumiao/Documents/expert-network
rm .github/workflows-paused-until-2026-06-01/README.md
git mv .github/workflows-paused-until-2026-06-01 .github/workflows
git commit -m "ci: re-enable GitHub Actions after monthly quota reset"
git push origin main
```

The workflows themselves are unchanged inside this directory — only
the parent path matters to GitHub's trigger detection.
