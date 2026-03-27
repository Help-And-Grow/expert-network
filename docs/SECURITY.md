# Security

## Authentication

| Platform | Method | Token Storage |
|----------|--------|---------------|
| Web | NextAuth (JWT session) | HTTP-only secure cookie |
| Telegram | initData HMAC verification | Signed cookie (`tg_user_id`) |
| WeChat | code2session → custom JWT | Taro local storage |

All API routes authenticate via `resolveUserId(request)` which checks WeChat JWT, Telegram initData/cookie, and Auth.js (`auth()`) for the web session cookie.

## Authorization

- API routes verify the authenticated user owns the resource being accessed
- Expert profile operations check `expert.userId === userId`
- Booking operations check `booking.founderId === userId` or `booking.expertId` ownership
- Admin routes are gated (currently by hardcoded checks)

## Secrets Management

- All secrets stored in Vercel environment variables (production)
- Local development uses `.env` (gitignored)
- `.env.example` documents required variables without values
- **Never commit**: `.env`, `*.pem`, credentials, API keys

### Critical Secrets

| Secret | Purpose |
|--------|---------|
| `NEXTAUTH_SECRET` | JWT signing for web sessions |
| `STRIPE_SECRET_KEY` | Stripe API (live mode, `sk_live_*`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `DASHSCOPE_API_KEY` | Qwen AI provider |
| `GEMINI_API_KEY` | Google Gemini AI |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API |
| `WECHAT_APP_SECRET` | WeChat Mini Program |
| `DATABASE_URL` | Database connection string |

## Data Handling

- Passwords are never stored (OAuth and magic links only)
- Payment data handled entirely by Stripe (PCI compliant) — no card numbers touch our servers
- User PII: name, email, Telegram ID, WeChat OpenID — stored in DB, not logged
- Webhook payloads logged at info level (no sensitive fields)

## Webhook Security

- Stripe: HMAC-SHA256 signature verification with timestamp tolerance (300s)
- Telegram: Bot token-based HMAC verification
- WeChat Pay: Signature verification per WeChat spec

## Known Gaps

- [ ] No rate limiting on API routes (relies on Vercel's built-in limits)
- [ ] No CSRF protection beyond NextAuth's built-in
- [ ] Debug routes (`/api/debug/*`) should be removed or gated in production
- [ ] No audit log for admin actions
