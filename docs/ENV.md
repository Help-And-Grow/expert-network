# Environment Variables

Grouped reference for every env var the app reads. The full annotated list lives in [`.env.example`](../.env.example); this file groups by feature so you can answer "what do I need to enable X?"

Validation: production startup fails fast if `DATABASE_URL`, `NEXTAUTH_URL`, and an auth secret (`AUTH_SECRET` or `NEXTAUTH_SECRET`, ≥32 chars) are missing. Emergency local bypass: `SKIP_ENV_VALIDATION=1` (never use on Vercel).

For Vercel env workflows (pull / list / sync), see [`docs/references/vercel-environments-solo-pm.md`](references/vercel-environments-solo-pm.md). For Marketplace Postgres naming, see [`docs/references/vercel-supabase-marketplace.md`](references/vercel-supabase-marketplace.md).

---

## Core

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (prod) | PostgreSQL connection string (`postgresql://` or `postgres://`) |
| `POSTGRES_PRISMA_URL` | optional | Vercel Marketplace Supabase pooled URL — runtime maps to Prisma automatically |
| `NEXTAUTH_URL` | yes | Full public URL of the app (sign-in callbacks) |
| `AUTH_SECRET` | yes | Auth.js v5 JWT signing secret (`openssl rand -base64 32`) |
| `NEXTAUTH_SECRET` | optional | Legacy alias for `AUTH_SECRET` — both accepted |
| `OTEL_SERVICE_NAME` | optional | Service name in OpenTelemetry traces (default: `expert-network`) |

## Auth — Web

| Var | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth provider |
| `EMAIL_SERVER_HOST`, `EMAIL_SERVER_PORT`, `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD`, `EMAIL_FROM` | Magic-link SMTP (Gmail / Resend SMTP) |
| `RESEND_API_KEY`, `RESEND_EMAIL_FROM` | Booking confirmation + reminder emails (NOT magic-link) |

## Auth — Local / E2E shortcuts

| Var | Purpose |
|---|---|
| `DEV_AUTH_EMAIL`, `DEV_AUTH_ROLE` | Local dev-only "Continue as local dev" on `/auth/signin` |
| `E2E_AUTH_EMAIL`, `E2E_AUTH_ROLE`, `E2E_AUTH_TOKEN` | Hidden Playwright login on selected deployments |

## Telegram (Mini App + bot + payments)

| Var | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather HTTP API token |
| `NEXT_PUBLIC_TELEGRAM_TWA_RETURN_URL` | TON Connect Mini App return URL |
| `TELEGRAM_PAYMENT_PROVIDER_TOKEN` | Telegram Pay only (`/api/bookings/telegram-payment`) |

## WeChat Mini Program + Pay

| Var | Purpose |
|---|---|
| `WECHAT_APP_ID`, `WECHAT_APP_SECRET` | Mini Program `code2session` |
| `WECHAT_CLIENT_LOG` | `1` to accept `/api/debug/wechat-client-log` in prod |
| `WECHAT_PAY_MCH_ID`, `WECHAT_PAY_API_V3_KEY` (32 chars), `WECHAT_PAY_CERT_SERIAL_NO`, `WECHAT_PAY_PRIVATE_KEY`, `WECHAT_PAY_NOTIFY_URL` | WeChat Pay JSAPI |
| `WECHAT_PAY_PARTNER_MODE`, `WECHAT_PAY_PLATFORM_*` | Service-provider + profit-sharing marketplace mode |
| `WECHAT_TPL_BOOKING_*`, `WECHAT_TPL_LOCATION_UPDATED`, `WECHAT_TPL_SESSION_REMINDER` | Subscribe-message template IDs |

## AI providers

`AI_PROVIDER` selects the active text/image provider (default `qwen`). Voice chat is always DashScope/Qwen regardless of `AI_PROVIDER`.

| Var | Purpose |
|---|---|
| `AI_PROVIDER` | `qwen` (default) `|` `gemini` `|` `openai` `|` `zai` `|` `dedalus` `|` `byteplus` `|` `volcengine` `|` `ollama` |
| `VENDOR_ALIBABACLOUD_DEMO` | Local mimic of the AlibabaCloud showcase deployment |
| **Qwen / DashScope** | `DASHSCOPE_API_KEY`, `QWEN_TEXT_MODEL`, `QWEN_IMAGE_MODEL` |
| **Gemini (AI Studio)** | `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_IMAGE_VERTEX_LOCATION` |
| **Gemini (Vertex)** | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_SERVICE_ACCOUNT_KEY` (base64) |
| **OpenAI** | `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` |
| **Z.ai** | `ZAI_TEXT_MODEL`, `ZAI_VERTEX_LOCATION`, `ZAI_IMAGE_MODEL`, optional `ZAI_API_KEY` + `ZAI_BASE_URL` |
| **Dedalus** | `DEDALUS_API_KEY`, `DEDALUS_MODEL`, `DEDALUS_IMAGE_MODEL` |
| **BytePlus ModelArk** | `BYTEPLUS_API_KEY`, `BYTEPLUS_MODEL_ID` |
| **Volcengine ModelArk** | `VOLCENGINE_API_KEY`, `VOLCENGINE_MODEL_ID` |

## Memory backend

| Var | Purpose |
|---|---|
| `MEMORY_BACKEND` | `mem9 | pgvector | hybrid` (local default `pgvector`) |
| `EMBEDDING_PROVIDER` | Embedding model provider (local default `ollama`) |
| `USE_PGVECTOR_MEMORY` | Mirror expert memories to Postgres pgvector — requires `GEMINI_API_KEY` (or Vertex `GOOGLE_CLOUD_PROJECT` + `GOOGLE_SERVICE_ACCOUNT_KEY`) for `gemini-embedding-001`. Pinned to 1536 dims to match `vector(1536)`. |
| `PGVECTOR_DATABASE_URL` | Override DB for pgvector (defaults to `DATABASE_URL`) |

## Voice chat

| Var | Purpose |
|---|---|
| `VOICE_CHAT_MODE` | `async` (default) `|` `realtime` `|` `both` |
| `VOICE_CHAT_DEFAULT_VOICE` | Default Qwen voice when expert has no clone |
| `DASHSCOPE_API_KEY` | Required for both async TTS/ASR and realtime |

## Premium live (Tencent TRTC)

| Var | Purpose |
|---|---|
| `TRTC_APP_ID` | Tencent SDKAppID |
| `TRTC_SECRET_KEY` (or alias `TRTC_APP_SECRET`) | TRTC SDKSecretKey |
| `TRTC_PREMIUM_LIVE_TOKENS` | H&G tokens debited per premium-live booking |
| `TRTC_PREJOIN_SECONDS`, `TRTC_POST_END_GRACE_SECONDS` | Room access window |

## Payments — Stripe

| Var | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API (live `sk_live_*` or test `sk_test_*`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `STRIPE_CHECKOUT_GRABPAY`, `STRIPE_CHECKOUT_WECHAT_PAY`, `STRIPE_CHECKOUT_ALIPAY` | Per-method opt-out |

## Payments — PayNow (Singapore)

| Var | Purpose |
|---|---|
| `PAYNOW_UEN` | Receiving entity UEN |
| `PAYNOW_COMPANY_NAME` | QR merchant name (≤25 ASCII) |
| `PAYNOW_EDITABLE_AMOUNT` | `true` allows sender to edit amount |

## Base chain + POMP + H&G token

| Var | Purpose |
|---|---|
| `BASE_RPC_URL` | Server-side RPC for minting + webhooks |
| `POMP_ISSUER_PRIVATE_KEY` | EAS issuer (attester) wallet |
| `POMP_EAS_SCHEMA_UID` | Registered POMP schema UID |
| `EAS_CONTRACT_ADDRESS` | Override (default `0x4200…0021` on Base) |
| `ALCHEMY_WEBHOOK_SECRET` | Alchemy Custom Webhook HMAC for `/api/webhook/onchain` |
| `NEXT_PUBLIC_HG_TOKEN_ADDRESS` | Browser ERC-20 address for `/reputation` |
| `NEXT_PUBLIC_POMP_EAS_SCHEMA_UID` | Browser EASScan deep links |
| `NEXT_PUBLIC_BASE_RPC_URL`, `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | Browser RPC URLs |

## HiClaw sidecar

| Var | Purpose |
|---|---|
| `HICLAW_POSTGRES_URL` | Dedicated Postgres for HiClaw (defaults to `DATABASE_URL`) |

See [`hiclaw/README.md`](../hiclaw/README.md) for additional service-only vars.

## Background jobs

| Var | Purpose |
|---|---|
| `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | Inngest Cloud — register `https://YOUR_DOMAIN/api/inngest` |
| `CRON_DELEGATED_TO_INNGEST` | `1` to skip Vercel cron when Inngest owns the daily remainder job |

## Maps / Places

| Var | Purpose |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Places API (New) — autocomplete + details |
| `GOOGLE_PLACES_REGION_CODES` | Comma-separated ISO codes (default `sg`) |

## Supabase Storage / public client

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Storage / client SDK |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | Browser-safe key |

## Admin AI-provider switcher

| Var | Purpose |
|---|---|
| `VERCEL_MANAGEMENT_TOKEN`, `VERCEL_MANAGED_TEAM_ID`, `VERCEL_MANAGED_PROJECT` | Required for `/admin/ai-provider` to update Vercel env + redeploy |
| `VERCEL_DEPLOY_HOOK_URL` | Optional deploy hook for automatic redeploy |

## Debug gating

| Var | Purpose |
|---|---|
| `DEBUG_API_ENABLED` | `1` to allow read-only `/api/debug/*` in production |
| `DEBUG_MUTATION_ENABLED` | `1` additionally required for destructive debug routes (`clean`, `db-push`, `delete-user`) |

## Playwright (shell-only — not read by Next.js)

| Var | Purpose |
|---|---|
| `PLAYWRIGHT_BASE_URL` | Target URL for `test:ui` / `test:e2e` |
| `PLAYWRIGHT_EXPERT_ID` | Stable expert id for fixtures |
| `PLAYWRIGHT_STORAGE_STATE` | Auth state file path |
| `PLAYWRIGHT_RUN_CHECKOUT_TEST` | Opt-in checkout test |
