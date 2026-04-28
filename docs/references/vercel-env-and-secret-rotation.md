# Vercel env files and secret rotation

## Local files (never commit)

| File | Purpose |
|------|---------|
| `.env` | Local dev (gitignored) |
| `.env.vercel.production.local` | Copy of **Production** env from `vercel env pull --environment production` — **live secrets** |
| `.env.local` | Next.js local overrides |

These paths are in `.gitignore` and `.cursorignore`. **Do not** paste contents into tickets, chat, or screenshots.

## Pull production env (reference only)

From repo root, logged in with `vercel login` and `vercel link`:

```bash
vercel env pull .env.vercel.production.local --environment production --yes
```

Optional npm script: `npm run vercel:env:pull:production`

## “Remove” leaked secrets = rotate, then update Vercel

You cannot “delete” secrets from Vercel without replacing them — the app needs values for production. After any suspected exposure:

1. **Generate a new secret** in the provider’s dashboard (Stripe, Resend, Google, Supabase, etc.).
2. **Overwrite** the variable on Vercel:

   ```bash
   vercel env add STRIPE_SECRET_KEY production --value "new_value" --yes --force
   ```

   Repeat per variable. Sensitive values: use `--sensitive` if you prefer Vercel’s UI masking.

3. **Redeploy** the latest deployment (or push to `main`) so all functions see new values.
4. **Re-pull** locally if you keep a reference file:

   ```bash
   vercel env pull .env.vercel.production.local --environment production --yes
   ```

5. **Invalidate old keys** at the provider (revoke old Stripe key, Resend key, Gmail app password, etc.).

## Typical providers (where to rotate)

| Env var(s) | Rotate at |
|------------|-----------|
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Generate new random string (`openssl rand -base64 32`), set on Vercel |
| `DATABASE_URL`, `DIRECT_URL` | Supabase / Neon dashboard — reset password or rotate pooler creds |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, publishable key | Stripe Dashboard → API keys / Webhooks |
| `RESEND_API_KEY` | Resend → API Keys → revoke old, create new |
| `EMAIL_SERVER_PASSWORD` | Google Account → App passwords → revoke and create new |
| `DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, `DEDALUS_API_KEY` | Respective provider consoles |
| `TELEGRAM_BOT_TOKEN` | @BotFather → revoke / new token if supported |
| `WECHAT_*` secrets | WeChat MP / Pay dashboards |
| voice / AI vendor keys (`OPENAI_API_KEY`, `ZAI_API_KEY`, etc.) | Vendor dashboards |

## Verify nothing was committed

```bash
git check-ignore -v .env.vercel.production.local
git ls-files '*.local' '.env*'
```

The first command should show the file is ignored; the second should not list pulled env files.
