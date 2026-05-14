# Architecture

**Status**: Accepted
**Date**: 2026-04
**Scope**: Cloud topology, AI routing, storage, authentication. Companion docs: [product-features.md](product-features.md), [operations.md](operations.md).

This document is the technical foundation. It captures **where the app runs**, **which AI provider does what**, **where assets are stored**, and **how every client surface authenticates**. Product capabilities (payments, live consultation, sharing, avatar control plane) live in [product-features.md](product-features.md).

---

## 1. Multi-Cloud Deployment with Regional Data Isolation

The rollout now has two explicit phases:

1. **Current user test:** the international WeChat Mini Program registered through the Singapore company, using Tencent CloudBase / SCF and Hunyuan. This app reads expert data from a Tencent-side database synchronized from the global primary DB (Google Cloud SQL `hg-postgres-prod` since 2026-05-03).
2. **Future mainland-CN launch:** a separate mainland mini program after the Chinese company, mainland AppID, WeChat Pay merchant, and review path are ready.

| Stack | Status | Audience | Compute | Storage | Database | AI |
|---|---|---|---|---|---|---|
| **Web / Telegram** | Live | Browsers and Telegram users | Vercel Functions in `sin1` | Vercel Blob | Google Cloud SQL (`hg-postgres-prod`, `asia-southeast1`) | Qwen/Gemini chain |
| **WeChat — International** | **Current focus** | WeChat users outside mainland CN | Tencent CloudBase / SCF Web Function, env `cn-wechat-d1gzncs8i34827c98` | Tencent COS | Tencent-side Postgres synchronized from the global primary DB | Tencent Hunyuan |
| **WeChat — Mainland CN** | Future | Mainland-CN WeChat users | Separate Tencent CloudBase / SCF env | Separate Tencent COS CN bucket | Separate TencentDB CN | Tencent Hunyuan |

**Two separate WeChat Mini Program apps.** The current international app uses AppID `wx09d0eb079596060d`. The mainland-CN app will use a different AppID after the Chinese company is set up and approved. The `wechat/` Taro source supports both builds, but only `TARO_APP_REGION=intl` is deploy-ready today; `build-config/cn.json` is intentionally blocked with `PENDING_*` values.

**Removed Tencent Cloud International Singapore experiment.** On 2026-05-05 the separate Tencent Cloud International Singapore resources were cleaned up: PostgreSQL `postgres-8bqbytbh`, COS bucket `sg-expert-network-1424085034`, subnets `subnet-lrcgprpg` / `subnet-91o4zq0c`, VPC `vpc-2ari99bl`, local `infra/tencent-intl/`, and `.cos.conf`. Do not recreate this stack for phase 1. The cleanup does not affect the Web/Telegram stack or the global DB cutover plan.

**Shared expert visibility.** Experts onboarded through Web or Telegram must become visible in the international WeChat Mini Program through database synchronization from the global primary DB into the Tencent-side WeChat backend.

**Web and Telegram remain on Vercel + the global primary DB** — the Tencent backend exists so the WeChat app can run on WeChat-friendly infrastructure and use Tencent-native AI.

**Cloud SQL status.** Web/Telegram DB ran cutover from Supabase to Google Cloud SQL on 2026-05-03 (instance `hg-postgres-prod`, project `expert-network-489508`, region `asia-southeast1`). Migration record archived at [`../exec-plans/archive/supabase-to-cloudsql-migration.md`](../exec-plans/archive/supabase-to-cloudsql-migration.md); operations runbook at [`../exec-plans/active/postgres-cutover-runbook.md`](../exec-plans/active/postgres-cutover-runbook.md).

### CloudBase HTTP access in front of SCF

WeChat Mini Programs require callable domains to be on the WeChat allowlist. The current international app calls the CloudBase default domain directly:

```text
https://cn-wechat-d1gzncs8i34827c98-1426867475.ap-shanghai.app.tcloudbase.com/api/...
```

CloudBase HTTP access routes `/api` to the SCF Web Function as `WEB_SCF` with path passthrough enabled. The SCF deployment sets:

- `IS_WECHAT=true`
- `PROXY_REGION=intl`
- `AI_PROVIDER=hunyuan`
- `STORAGE_PROVIDER=tencent-cos`

`src/lib/request-origin.ts` treats `IS_WECHAT=true` as the WeChat-origin signal and uses `PROXY_REGION` for region-aware decisions. The older TCB-proxy header path is still supported for compatibility.

### Dynamic Configuration (`SystemConfig`)

A database-backed key/value table (`SystemConfig`) drives runtime switching of providers without redeployment.

- **Table**: `SystemConfig` (key, value, description)
- **Utility**: `src/lib/system-config.ts` (60s in-process cache)
- **Admin Panel**: `/admin/system-config` for AI / cloud / storage settings.

This is the lever the operator pulls to swap AI providers, switch storage backends, and toggle feature flags — strictly without a redeploy.

---

## 2. Storage Abstraction

A factory-based storage system with multiple drivers, all implementing `StorageProvider` (`src/lib/storage/types.ts`).

| Driver | When | Source |
|--------|------|--------|
| `DatabaseStorageProvider` | Legacy / local dev (Base64 in DB) | `src/lib/storage/db-legacy.ts` |
| `VercelBlobProvider` | Vercel deployments, default for global users | `src/lib/storage/vercel-blob.ts` |
| `GoogleCloudStorageProvider` | GCP deployments, large files | `src/lib/storage/gcs.ts` |
| `TencentCOSStorageProvider` | China-region uploads, WeChat-originated traffic | `src/lib/storage/tencent-cos.ts` |

**Auto-routing.** `getStorageProvider({ request })` (`src/lib/storage/index.ts`) inspects `x-forwarded-via` / `x-forwarded-from` (stamped by the TCB proxy). WeChat-originated requests route to Tencent COS automatically when the COS env vars are configured; everything else uses the `STORAGE_PROVIDER` setting in `SystemConfig`.

The `request` is threaded through the upload sites (`src/app/api/onboarding/generate/route.ts`, `src/app/api/expert/generate-audio/route.ts`) so the factory can inspect headers without leaking abstractions.

---

## 3. AI Stack

### 3.1 Provider Abstraction (factory)

All providers implement the `AIProvider` interface (`src/lib/ai/types.ts`). The factory in `src/lib/ai/index.ts` reads `AI_PROVIDER` from `SystemConfig` (or env). Supported drivers: `gemini`, `qwen`, **`hunyuan`**, `openai`, `zai`, `byteplus`, `volcengine`. Model defaults and readiness checks centralize in `src/lib/ai/provider-catalog.ts`.

```ts
interface AIProvider {
  matchExperts(query, experts, history?): Promise<MatchResult>;
  generateExpertProfile(input): Promise<ProfileOutput>;
  generateProfileImage(input): Promise<string>; // base64
  improveWriting(text): Promise<string>;
  extractTextFromPdf?(buffer): Promise<string>;
}
```

Switching providers requires only an admin-panel change at `/admin/ai-provider` — no code change, no redeploy.

### 3.2 Per-Surface Provider Routing

**Decision (2026-05):** Each stack uses its **native cloud's** AI services as the primary provider, with a single cross-cloud fallback for the global stack. The exception is web search grounding, which is **always Gemini** because it is the only free, production-grade source of Google Search results we have access to.

| Capability | Web / Telegram | WeChat-CN / WeChat-Intl |
|---|---|---|
| Text (generation, matching, reasoning, query normalisation, PDF extraction) | **Qwen → Gemini** | **Hunyuan** (no cross-cloud fallback by design — keeps inference inside the Tencent compliance boundary) |
| Image generation | Qwen → Gemini (chain) | Tencent Hunyuan Image (planned) → Qwen → Gemini |
| Text-to-speech (intro voice + async reply) | Qwen-TTS → Gemini-TTS | Tencent TXTTS (planned) → Qwen-TTS → Gemini-TTS |
| Speech recognition (voice chat input) | DashScope Qwen3-ASR-Flash | Tencent TXASR (planned) → DashScope ASR |
| **Web search grounding** *(profile auto-fill, expert discovery)* | **Gemini** (Google Search grounding via Vertex / AI Studio) | **Hunyuan with `enable_enhancement: true`** (Tencent's native Sogou-powered web search, stays inside the GFW) |
| Embeddings | Qwen `text-embedding-v3` → Gemini `embedding-001` | Hunyuan embeddings (when wired) |

**Per-cloud search choice.** Each surface uses the search engine native to its cloud so the entire request pipeline (LLM call + grounding lookups) stays inside one compliance boundary:

- **Web / Telegram → Gemini.** Google Search grounding (`tools: [{ googleSearch: {} }]`) gives us the best recall on the profiles our users care about (LinkedIn, Substack, Twitter, personal blogs).
- **WeChat → Hunyuan with `enable_enhancement: true`.** Tencent's chat completions API takes a single boolean parameter (`enable_enhancement: true` on the OpenAI-compatible endpoint, `EnableEnhancement: true` on the native API) which causes Hunyuan to do internal Sogou-powered web searches and ground the response. Recall on Chinese-language sources (Xiaohongshu, Zhihu, WeChat public accounts) is materially better than what Google Search returns; recall on English-language profiles is lower but acceptable for the WeChat audience.

Both implementations live in `src/lib/ai/search.ts` (`searchSocialProfilesWithGemini`, `searchSocialProfilesWithHunyuan`). The active surface picks one at the provider layer: `BaseAIProvider.generateExpertProfile` uses the Gemini path by default; `HunyuanProvider` overrides to use the Hunyuan path so WeChat traffic never crosses to Google.

**Why Qwen-primary on Web/Telegram instead of Gemini-primary.** Vertex AI's Gemini quotas tighten under sustained load, and most of our text traffic (matching, query normalisation, profile generation) is well within Qwen-Plus's capability. Qwen is also resident in `ap-southeast-1`, which is a single hop from our Vercel `sin1` functions and the Singapore-resident user base. Gemini stays as the fallback so a Qwen outage doesn't surface as a user-visible 500.

**Why no cross-cloud fallback for WeChat.** Adding a Gemini fallback path on the WeChat surfaces would re-introduce the cross-border traffic we explicitly designed out (compliance + latency). If Hunyuan is unavailable, the route handler returns a graceful "Try again in a moment" instead of routing the request through the GFW.

Tencent-native providers for image / TTS / ASR are **listed but not yet wired** — until they are, both WeChat stacks fall through the configurable `IMAGE_PROVIDER_CHAIN` / `VOICE_PROVIDER_CHAIN` to Qwen / Gemini. Wiring is tracked in [`tencent-cloud-rollout.md`](../exec-plans/active/tencent-cloud-rollout.md).

### 3.3 Routing Scopes & Route Overrides (Phase 3, no redeploy)

The per-surface routing in §3.2 is now **DB-driven**. Two tables drive request → chain resolution:

- **`ProviderRoutingScope`** — one row per `(scopeKey, category, environment)`. Each row binds a request shape (its `matchRules`) to an ordered `chain`. The resolver in `src/lib/ai/routing.ts` evaluates enabled scopes for a category in `priority` ASC order; the first whose `matchRules` matches the request origin wins. Empty `matchRules: {}` is the catch-all. Seeded with:
  - `web-default` (catch-all, priority 200) → `qwen,gemini`
  - `wechat-intl` (`isWeChat: true, region: intl`, priority 100) → `hunyuan`
  - `wechat-cn` (`isWeChat: true, region: cn`, priority 100) → `hunyuan`
  - Mirrors for the `image` and `voice` categories.
- **`ProviderRouteOverride`** — per-route chain overrides (e.g. `/api/match` uses a cheaper provider; `/api/voice-chat/*` uses a faster one). Pattern matching is `startsWith` with a single trailing `*` wildcard — no regex by design. **Route overrides win over scope chains.**

Precedence (highest → lowest): `ProviderRouteOverride` → `ProviderRoutingScope` → legacy SystemConfig (`AI_TEXT_PROVIDER_CHAIN` / `IMAGE_PROVIDER_CHAIN` / `VOICE_PROVIDER_CHAIN`) → hard-coded defaults. The legacy SystemConfig + env path stays as a cold-start safety net.

Voice providers (`qwen-tts`, `gemini-tts`, `openai-tts`, `hunyuan-tts`) are now registry rows in `ProviderRegistry` with `metadata.capabilities: ["voice"]` — adding a new TTS provider is a one-row insert + thin adapter, no static-union edit.

Edit all of this at `/admin/providers` → LLM tab → "Routing scopes" / "Route overrides". Every change is audited in `ProviderConfigChange` with `category='routing-scope'` or `'route-override'`.

The legacy `WECHAT_AI_PROVIDER` env / SystemConfig key is **deprecated** but still read as a boot-time fallback when the routing-scope table is unreachable — so existing deployments don't break silently when this commit lands.

#### Legacy SystemConfig keys (now fallbacks only)

- **`AI_TEXT_PROVIDER_CHAIN`** — comma-separated. Used only when no LLM scope matches and the routing table is reachable; same precedence semantics as before.
- **`IMAGE_PROVIDER_CHAIN`** — same, for images.
- **`VOICE_PROVIDER_CHAIN`** — same, for voice.

WeChat-originated requests are detected via `isWeChatOriginatedRequest` exactly as before; the resolver hands the `{ isWeChat, region }` tuple to `matchesScope`.

Provider availability is filtered by credential at chain-build time (`computeProviderHealth`); a provider without its required env vars is silently dropped from the chain so the deploy fails gracefully when, e.g., `GEMINI_API_KEY` is unset.

### 3.4 Implementation Map

| Concern | Where |
|---|---|
| Resolve the chain for a request | `getAIProviderChainForRequest(request)` in `src/lib/ai/provider-catalog.ts` |
| Build a chain-wrapped provider | `resolveAIProvider({ request })` in `src/lib/ai/index.ts` (returns a façade that tries each provider in order before throwing) |
| Search grounding (always Gemini) | `searchSocialProfiles()` in `src/lib/ai/search.ts` |
| Image fallback chain | `generateProfileImageResilient()` in `src/lib/profile-media.ts` |
| Voice fallback chain | `getProfileIntroVoiceSynthesisProviders()` in `src/lib/profile-media.ts` |
| Wired into | `src/app/api/experts/match/route.ts` (Discover), `src/lib/chat-engine.ts` (POST `/api/chat` + Telegram), `src/app/api/onboarding/generate/route.ts` (profile auto-fill) |

---

## 4. Multi-Platform Authentication

Three client surfaces share one resolver.

| Surface | Auth signal | Where validated |
|---------|-------------|------------------|
| Web (browser) | Auth.js v5 session cookie (`authjs.session-token`) | `auth()` in route handlers |
| Telegram Mini App (`@helpAndGrowBot`) | `initData` HMAC | `src/lib/telegram-server.ts` → `validateAndParseTelegramInitData`. Mini-App routing on entry via `src/components/telegram-start-param-router.tsx` (reads `start_param` deep links — see [telegram-bot reference](../references/telegram-bot.md)). |
| WeChat Mini Program | `code2session` JWT (header `x-wechat-token`) | `src/lib/wechat-server.ts` |

**Resolver:** `resolveUserId(request)` in `src/lib/request-auth.ts` checks signals in priority order:

1. `x-wechat-token` → JWT verify → user lookup
2. `x-telegram-init-data` → HMAC verify → lookup by `telegramId`
3. `tg_user_id` cookie (set after first Telegram auth)
4. Auth.js session cookie

API routes call `resolveUserId(request)` once and trust the result; no per-route platform branching.

**Trade-off.** Header-based auth (Telegram, WeChat) bypasses NextAuth's CSRF protection. Mitigation: Telegram uses cryptographic `initData`, WeChat uses server-side `code2session` against the WeChat App Secret.

---

## 5. Per-Stack Configuration

Each stack is the same Next.js codebase deployed with different env vars.

| Env var | Web / Telegram | Current WeChat-Intl SCF | Future WeChat-CN SCF |
|---|---|---|---|
| `DATABASE_URL` | Google Cloud SQL (`hg-postgres-prod`) | Tencent-side synced Postgres | TencentDB CN |
| `STORAGE_PROVIDER` | `vercel` or configured provider | `tencent-cos` | `tencent-cos` |
| `TENCENT_COS_BUCKET` | unset unless explicitly enabled | current WeChat COS bucket | future CN COS bucket |
| `TENCENT_COS_REGION` | unset unless explicitly enabled | currently `ap-shanghai` with existing CloudBase env | future CN region |
| `AI_PROVIDER` | Qwen/Gemini chain | `hunyuan` | `hunyuan` |
| `IS_WECHAT` | unset | `true` | `true` |
| `PROXY_REGION` | unset | `intl` | `cn` |
| `WECHAT_APP_ID` | n/a | `wx09d0eb079596060d` | future mainland AppID |

The WeChat client picks its backend at **build time** via `TARO_APP_REGION`, `TARO_APP_CLOUDBASE_ENV_ID`, and `TARO_APP_API_BASE`.

## 6. What's Still on the Todo List

| Item | Why it matters |
|---|---|
| **International user-test smoke** | Validate login, Discover, expert detail, onboarding upload, voice, and booking handoff in real WeChat |
| **Database sync monitoring** | Experts onboarded in Web/Telegram must appear in WeChat after sync |
| **Secret rotation** | Secrets were exposed in deployment logs during debugging and must be rotated before broad user testing |
| **Mainland CN app/company setup** | Required before the separate mainland mini program build can be activated |
| **WeChat Pay native flow** | Current user test can use web booking handoff; native WeChat Pay is a later step |
