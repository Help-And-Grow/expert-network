# Environment Variables

Grouped reference for every env var the app reads. The full annotated list lives in [`.env.example`](../.env.example); this file groups by feature so you can answer "what do I need to enable X?"

Validation: production startup fails fast if `DATABASE_URL`, `NEXTAUTH_URL`, and an auth secret (`AUTH_SECRET` or `NEXTAUTH_SECRET`, ≥32 chars) are missing. Emergency local bypass: `SKIP_ENV_VALIDATION=1` (never use on Vercel).

For Vercel env workflows (pull / list / sync), see [`docs/references/vercel-environments-solo-pm.md`](references/vercel-environments-solo-pm.md). Web/Telegram production runs on **Google Cloud SQL** (`hg-postgres-prod`, `asia-southeast1`) since 2026-05-03; the migration record lives at [`exec-plans/archive/supabase-to-cloudsql-migration.md`](exec-plans/archive/supabase-to-cloudsql-migration.md), and everyday DB-access patterns at [`references/cloud-sql-data-viewing.md`](references/cloud-sql-data-viewing.md).

---

## Core

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (prod) | PostgreSQL connection string (`postgresql://` or `postgres://`) — points at Google Cloud SQL `hg-postgres-prod` for Web/Telegram. |
| `DB_PROVIDER` | optional | Identifier for the active provider — `cloudsql` in production. Informational; not required by Prisma. |
| `NEXTAUTH_URL` | yes | Canonical public origin of the app. Production must be `https://www.help-and-grow.com` after the custom-domain cutover. |
| `AUTH_URL` | optional | Auth.js v5 canonical URL alias. If set, keep it equal to production `NEXTAUTH_URL`. |
| `AUTH_SECRET` | yes | Auth.js v5 JWT signing secret (`openssl rand -base64 32`) |
| `NEXTAUTH_SECRET` | optional | Legacy alias for `AUTH_SECRET` — both accepted |
| `OTEL_SERVICE_NAME` | optional | Service name in OpenTelemetry traces (default: `expert-network`) |

## Auth — Web

| Var | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth provider |
| `EMAIL_SERVER_HOST`, `EMAIL_SERVER_PORT`, `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD`, `EMAIL_FROM` | Magic-link SMTP (Gmail / Resend SMTP) |
| `RESEND_API_KEY`, `RESEND_EMAIL_FROM` | Booking confirmation + reminder emails (NOT magic-link) |

Production Google OAuth checklist:

1. Vercel Production has `NEXTAUTH_URL=https://www.help-and-grow.com`.
2. If `AUTH_URL` is set, it has the same value.
3. Google Cloud Console OAuth client includes this authorized redirect URI:
   `https://www.help-and-grow.com/api/auth/callback/google`
4. Redeploy production after changing auth env vars.
5. Verify `https://www.help-and-grow.com/api/auth/providers` returns Google `signinUrl` and `callbackUrl` under `www.help-and-grow.com`.

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
| `IS_WECHAT` | Set to `true` on Tencent SCF deployments so backend traffic is routed through WeChat-specific AI/storage decisions even without proxy headers |
| `PROXY_REGION` | WeChat stack marker: `intl` for the current international MP, `cn` for the future mainland app |
| `WECHAT_STACK_REGION` | Deploy-script input written to SCF as `PROXY_REGION`; current value is `intl` |
| `WECHAT_PAY_MCH_ID`, `WECHAT_PAY_API_V3_KEY` (32 chars), `WECHAT_PAY_CERT_SERIAL_NO`, `WECHAT_PAY_PRIVATE_KEY`, `WECHAT_PAY_NOTIFY_URL` | WeChat Pay JSAPI |
| `WECHAT_PAY_PARTNER_MODE`, `WECHAT_PAY_PLATFORM_*` | Service-provider + profit-sharing marketplace mode |
| `WECHAT_TPL_BOOKING_*`, `WECHAT_TPL_LOCATION_UPDATED`, `WECHAT_TPL_SESSION_REMINDER` | Subscribe-message template IDs |

## AI providers

Routing is **per-surface chain** rather than a single global provider — see [architecture §3.2](design-docs/architecture.md#32-per-surface-provider-routing) for the full table. Quick summary:

| Surface | Text chain | Search grounding |
|---|---|---|
| Web / Telegram | `qwen → gemini` | Gemini (always) |
| WeChat MP (current Intl + future CN) | `hunyuan` (no fallback by design) | Hunyuan enhanced search where provider supports it |

| Var | Purpose |
|---|---|
| `AI_PROVIDER` | Primary provider for the Web/Telegram chain (default `qwen`). Used as the head of the chain when `AI_TEXT_PROVIDER_CHAIN` SystemConfig is unset. |
| `AI_TEXT_PROVIDER_CHAIN` | *(legacy fallback, superseded by Routing Scopes)* Comma-separated chain for non-WeChat surfaces. Default `qwen,gemini`. The source of truth is now `ProviderRoutingScope` rows in the DB (see `/admin/providers` → LLM tab → Routing scopes). This SystemConfig key only applies when the routing-scope table is unreachable. |
| `WECHAT_AI_PROVIDER` | *(deprecated, boot-time fallback only)* Primary provider for WeChat-originated requests. Default `hunyuan`. The source of truth is now the `ProviderRoutingScope` rows seeded with `wechat-intl` / `wechat-cn` scope keys — edit via `/admin/providers`. This env stays honoured for cold starts before the routing-scope table is reachable. |
| `VENDOR_ALIBABACLOUD_DEMO` | Local mimic of the AlibabaCloud showcase deployment |
| **Qwen / DashScope** *(primary for Web/Telegram)* | `DASHSCOPE_API_KEY`, `QWEN_TEXT_MODEL`, `QWEN_IMAGE_MODEL` |
| **Gemini (Vertex)** *(fallback for Web/Telegram + always-on for search)* | `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_SERVICE_ACCOUNT_KEY` (base64) |
| **Gemini (AI Studio)** *(simpler dev-only auth)* | `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_IMAGE_VERTEX_LOCATION` |
| **Tencent Hunyuan** *(WeChat MP only)* | `HUNYUAN_API_KEY`, `HUNYUAN_TEXT_MODEL`, `HUNYUAN_IMAGE_MODEL` |
| **OpenAI** *(image fallback only)* | `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` |
| **Z.ai** *(image fallback only)* | `ZAI_TEXT_MODEL`, `ZAI_VERTEX_LOCATION`, `ZAI_IMAGE_MODEL`, optional `ZAI_API_KEY` + `ZAI_BASE_URL` |
| **BytePlus ModelArk** *(legacy)* | `BYTEPLUS_API_KEY`, `BYTEPLUS_MODEL_ID` |
| **Volcengine ModelArk** *(legacy)* | `VOLCENGINE_API_KEY`, `VOLCENGINE_MODEL_ID` |

**Required for production deploys:**
- Web (Vercel): `DASHSCOPE_API_KEY` + Vertex creds (`GOOGLE_CLOUD_PROJECT` + `GOOGLE_SERVICE_ACCOUNT_KEY`).
- WeChat SCF (current Intl + future CN): `HUNYUAN_API_KEY` only — Qwen/Gemini are not on the WeChat path.
- Search grounding works on every surface as long as Gemini credentials (Vertex *or* AI Studio) are present somewhere on that deploy.

## Memory backend

| Var | Purpose |
|---|---|
| `MEMORY_BACKEND` | `mem9 | pgvector | hybrid` (local default `pgvector`) |
| `EMBEDDING_PROVIDER` | Embedding model provider (local default `ollama`) |
| `USE_PGVECTOR_MEMORY` | Mirror expert memories to Postgres pgvector — requires `GEMINI_API_KEY` (or Vertex `GOOGLE_CLOUD_PROJECT` + `GOOGLE_SERVICE_ACCOUNT_KEY`) for `gemini-embedding-001`. Pinned to 1536 dims to match `vector(1536)`. |
| `PGVECTOR_DATABASE_URL` | Override DB for pgvector (defaults to `DATABASE_URL`) |
| `EXPERT_SEARCH_VECTOR_PRERANK` | Optional env fallback for semantic expert matching. Prefer the `EXPERT_SEARCH_VECTOR_PRERANK` SystemConfig toggle in `/admin/system-config`; default is `false` until `/api/admin/embeddings/backfill` reaches high coverage. |
| `MEM9_ENABLED` | Set `1` to enable hosted mem9 lifecycle writes with per-expert key provisioning. |
| `MEM9_API_BASE` | Hosted mem9 API origin; defaults to `https://api.mem9.ai`. |
| `MEM9_AGENT_ID` | Agent attribution sent as `X-Mnemo-Agent-Id`; defaults to `help-grow-platform`. |
| `MEM9_API_KEY`, `MEM9_SPACE_ID` | Compatibility toggles for older environments. Production expert memory uses per-expert keys stored in `Expert.mem9SpaceId`, not a shared global space. |

mem9 runtime calls use hosted `v1alpha2` (`/v1alpha2/mem9s/...`) with the expert key sent as `X-API-Key`. New expert keys are still provisioned through `POST /v1alpha1/mem9s`, then stored on the `Expert` row.

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

## Admin Providers page

The unified admin Providers page lives at **`/admin/providers`** (Phase 1
of the admin-page revamp, 2026-05-09). It replaces the two scattered
pages — `/admin/ai-provider` and `/admin/system-config` — both of which
are now **deprecated 308 redirects** to the unified page. The legacy API
routes (`/api/admin/ai-provider`, `/api/admin/system-config`) still
respond for one release with a `console.warn` deprecation notice.

The new page is backed by the `ProviderRegistry` Prisma model: each LLM
or storage provider is a single row with its env-key map and default
models stored as JSON. Adding a new provider is a one-row insert + a
thin adapter — no longer a 6-file edit. Operator edits go through
`/api/admin/providers` and are written to both the registry and the
existing `SystemConfig` keys for back-compat.

After deploying the migration, run the seeder once to populate the
table from the legacy hard-coded catalog (idempotent — existing rows
are preserved):

```
npx tsx -e "import('./src/lib/admin/provider-registry-seed').then(m => m.seedProviderRegistryIfEmpty()).then(console.log)"
```

| Var | Purpose |
|---|---|
| `VERCEL_MANAGEMENT_TOKEN`, `VERCEL_MANAGED_TEAM_ID`, `VERCEL_MANAGED_PROJECT` | Required for `/admin/providers` to update Vercel env + redeploy |
| `VERCEL_DEPLOY_HOOK_URL` | Optional deploy hook for automatic redeploy |

### Phase 2 — audit log + per-environment scoping (2026-05-10)

`SystemConfig` carries an `environment` column (`production` | `preview` |
`development`) so the admin page can edit non-production providers without
affecting live traffic. Reads default to `process.env.VERCEL_ENV` (set by
Vercel on every deploy); writes default the same way and accept an explicit
`environment` from the admin UI. Cache keys are `${env}:${key}` so a write
to `preview` never invalidates the production cache.

Every write through `setSystemConfig` or `upsertProvider` appends a row to
the new `ProviderConfigChange` audit table (immutable, append-only). Each
row records actor (email/role), category, configKey, environment, before/
after JSON, and an optional admin-supplied `reason`. The log is browsable
at `/admin/providers/audit` with filters for category, environment, actor,
and date range; the Providers page also shows the latest 10 rows per
category as a collapsible "Recent changes" panel.

The atomic-apply route (`/api/admin/providers` POST) wraps registry +
SystemConfig writes in a single Prisma `$transaction`. Vercel sync only
runs **after** the DB commit. If it fails, the response carries
`deployTriggered: false` + a `deployError` message and the operator can
re-trigger via `POST /api/admin/providers/retry-deploy`.

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
