# Security

## Authentication

| Platform | Method | Token Storage |
|----------|--------|---------------|
| Web | Auth.js v5 (JWT session) — Google OAuth + Nodemailer magic link | HTTP-only secure cookie |
| Telegram | initData HMAC verification (Mini App). Bot inbound auth: `TELEGRAM_BOT_TOKEN` + Telegram-issued webhook. Bot privacy mode is **disabled** in BotFather — see [telegram-bot.md §3](references/telegram-bot.md#3-group-behaviour) for the rationale (delivery reliability vs. message scope tradeoff). | Signed cookie (`tg_user_id`) |
| WeChat | code2session → custom JWT (`jose`) | Taro local storage; sent as `x-wechat-token` header |

Auth provider config: [`src/auth.ts`](../src/auth.ts) (Auth.js v5 — `next-auth ^5.0.0-beta.30` + `@auth/prisma-adapter`).

All API routes authenticate via [`resolveUserId(request)`](../src/lib/request-auth.ts) which checks (in order) the `x-wechat-token` header, the Telegram initData / `tg_user_id` cookie, and the Auth.js (`auth()`) web session cookie.

### Auth secret naming

Auth.js v5 prefers `AUTH_SECRET`. The legacy `NEXTAUTH_SECRET` is still accepted as an alias by the env loader so existing Vercel projects don't have to migrate names atomically. See [`src/lib/auth-secret.ts`](../src/lib/auth-secret.ts) and [`docs/references/vercel-env-and-secret-rotation.md`](references/vercel-env-and-secret-rotation.md).

## Authorization

- API routes verify the authenticated user owns the resource being accessed
- Expert profile operations check `expert.userId === userId`
- Booking operations check `booking.founderId === userId` or `booking.expertId` ownership
- Admin routes are gated (currently by hardcoded checks)
- Debug routes are admin-gated; production debug reads require `DEBUG_API_ENABLED=1`, and destructive debug mutations additionally require `DEBUG_MUTATION_ENABLED=1`

## Secrets Management

- All secrets stored in Vercel environment variables (production)
- Local development uses `.env` (gitignored)
- `.env.example` documents required variables without values
- **Never commit**: `.env`, `.env*.local`, `.env.vercel.production.local` (pulled production secrets), `*.pem`, credentials, API keys
- Pulled production env: see [vercel-env-and-secret-rotation.md](references/vercel-env-and-secret-rotation.md) for pull commands and **rotation** if secrets were exposed

### Critical Secrets

| Secret | Purpose |
|--------|---------|
| `AUTH_SECRET` (or legacy `NEXTAUTH_SECRET`) | JWT signing for web sessions (Auth.js v5) |
| `STRIPE_SECRET_KEY` | Stripe API (live mode, `sk_live_*`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `DASHSCOPE_API_KEY` | Qwen / DashScope (default AI provider, voice chat backend) |
| `GEMINI_API_KEY` / `GOOGLE_SERVICE_ACCOUNT_KEY` | Gemini via AI Studio or Vertex |
| `OPENAI_API_KEY`, `ZAI_API_KEY`, `BYTEPLUS_API_KEY`, `VOLCENGINE_API_KEY`, `DEDALUS_API_KEY` | Other AI provider keys (per `AI_PROVIDER`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot + Mini App initData verification |
| `WECHAT_APP_SECRET` | WeChat Mini Program `code2session` |
| `WECHAT_PAY_API_V3_KEY`, `WECHAT_PAY_PRIVATE_KEY` | WeChat Pay JSAPI signing |
| `POMP_ISSUER_PRIVATE_KEY` | EAS attestation issuer wallet on Base |
| `ALCHEMY_WEBHOOK_SECRET` | On-chain webhook HMAC (`/api/webhook/onchain`) |
| `VERCEL_MANAGEMENT_TOKEN` | `/admin/ai-provider` provider switching + redeploy |
| `DATABASE_URL` | Postgres connection string (Cloud SQL `hg-postgres-prod`) |

## Data Handling

- Passwords are never stored (OAuth and magic links only)
- Payment data handled entirely by Stripe (PCI compliant) — no card numbers touch our servers
- User PII: name, email, Telegram ID, WeChat OpenID — stored in DB, not logged
- Webhook payloads logged at info level (no sensitive fields)

## Webhook Security

- Stripe: HMAC-SHA256 signature verification with timestamp tolerance (300s)
- Telegram: Bot token-based HMAC verification
- WeChat Pay: Signature verification per WeChat spec

## Rate limiting

In-memory rate limiting via [`src/lib/rate-limit.ts`](../src/lib/rate-limit.ts) is applied on the high-risk surfaces below. Because it lives in process memory, each Vercel function instance keeps its own counters — adequate for current traffic, but not durable.

| Surface | Routes |
|---|---|
| Auth | `/api/auth/telegram`, `/api/auth/wechat` |
| Booking creation / payment | `/api/bookings/free`, `/api/bookings/checkout` |
| Voice chat | `/api/voice-chat/start`, `/api/voice-chat/stop`, `/api/voice-chat/message` |
| Debug intake | `/api/debug/wechat-client-log` |

## Known Gaps

- [ ] Rate limiting is in-memory and per-instance; switch to a durable/global limiter (Redis / Vercel Marketplace) if abuse grows
- [ ] No CSRF protection beyond Auth.js's built-in
- [ ] No audit log for admin actions
- [ ] `/api/v1/*` public endpoints are auth-free by design — keep them GET-only and avoid leaking PII through them
