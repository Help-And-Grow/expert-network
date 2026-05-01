# Architecture

**Status**: Accepted
**Date**: 2026-04
**Scope**: Cloud topology, AI routing, storage, authentication. Companion docs: [product-features.md](product-features.md), [agent-system.md](agent-system.md), [operations.md](operations.md).

This document is the technical foundation. It captures **where the app runs**, **which AI provider does what**, **where assets are stored**, and **how every client surface authenticates**. Product capabilities (payments, live consultation, sharing, avatar control plane) live in [product-features.md](product-features.md).

---

## 1. Multi-Cloud Deployment with Regional Data Isolation

The marketplace runs on three clouds, partitioned along **two boundaries**:

1. **Audience boundary**: web users vs. WeChat users.
2. **Data-residency boundary**: mainland-CN data must never leave the GFW; everything else lives outside.

This produces **three separate stacks**, not three roles for one shared stack.

| Stack | Audience | Compute | Storage | Database | AI |
|---|---|---|---|---|---|
| **Web (Global)** | Browsers worldwide (Telegram included) | **Vercel** Functions in `sin1` | Vercel Blob | **Supabase** Postgres in AWS `ap-southeast-1` | Gemini (text/image/TTS/ASR) |
| **WeChat — Overseas** | WeChat users outside mainland CN (HK / TW / SEA / diaspora) | **Tencent SCF Web Function** in **Intl TCB env** (`ap-singapore`) | Tencent COS (Intl, `ap-singapore`) | TencentDB Postgres (Intl, `ap-singapore`) | **Tencent Hunyuan** (text); Tencent Image / TXTTS once wired |
| **WeChat — Mainland** | WeChat users in mainland CN | **Tencent SCF Web Function** in **CN TCB env** (`ap-shanghai`) | Tencent COS (CN, `ap-shanghai`) | TencentDB Postgres (CN, `ap-shanghai`) | **Tencent Hunyuan** (text); Tencent Image / TXTTS once wired |

**Why three stacks, not one shared backend.** Mainland CN data-residency law (PIPL, the Cybersecurity Law) requires that personal data of mainland users not transit outside the country without separate cross-border-transfer compliance. A single shared backend that talks to a single shared database always crosses that line for some users. Three stacks with **per-stack databases** removes the question entirely: a CN user's data starts and ends inside CN.

**Two separate WeChat Mini Program apps.** Mainland CN and overseas Mini Programs use **different `appId`s** (different WeChat Pay merchants, different review processes). The `wechat/` Taro source builds twice — once with `TARO_APP_REGION=cn`, once with `intl` — producing two `weapp` artifacts that get uploaded to two different `mp.weixin.qq.com` consoles.

**Web and Telegram remain on Vercel + Supabase** — the Tencent-region split applies only to the WeChat surfaces.

### TCB proxy in front of each SCF

WeChat Mini Programs require callable domains to be on the WeChat allowlist; only Tencent-CDN-fronted domains (or ICP-filed custom domains) qualify. The TCB HTTP-trigger function (`infra/tcb-proxy/`) terminates inside the WeChat-allowlisted domain set and forwards to the SCF Web Function origin, stamping:

- `x-forwarded-via: tcb-proxy`
- `x-forwarded-from: wechat`
- `x-forwarded-region: cn | intl`

The Next.js origin reads these via `lib/request-origin.ts` to make region-aware decisions (storage routing, AI provider selection).

**Region pinning.** Vercel functions are pinned to `sin1` (Singapore) via `vercel.json`. CN SCF runs in `ap-shanghai`, Intl SCF in `ap-singapore`. Each SCF talks only to its co-located TencentDB — no cross-region database hops on the hot path.

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

### 3.3 Configurable Chains (no redeploy)

Three SystemConfig keys drive runtime fallback order:

- **`AI_TEXT_PROVIDER_CHAIN`** — comma-separated, default `qwen,gemini`. Applies to non-WeChat surfaces (Web, Telegram, REST API). Editable from `/admin/ai-provider`.
- **`IMAGE_PROVIDER_CHAIN`** — comma-separated, default `qwen,gemini`. Applies to all surfaces.
- **`VOICE_PROVIDER_CHAIN`** — comma-separated, default `qwen-tts,gemini-tts`. Allowed tokens: `qwen-tts`, `gemini-tts` (more added as Tencent-native voice lands).

WeChat-originated requests (detected via `isWeChatOriginatedRequest`, which reads `IS_WECHAT=true` on the SCF deployments) bypass `AI_TEXT_PROVIDER_CHAIN` and use `WECHAT_AI_PROVIDER` (default `hunyuan`) as a single-provider chain — no cross-cloud fallback for the reason given in §3.2.

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
| Telegram Mini App | `initData` HMAC | `src/lib/telegram-server.ts` → `validateAndParseTelegramInitData` |
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

Each of the three stacks is one Next.js codebase deployed with **different env vars** — there is no runtime switching of database or storage at the request level for the Tencent stacks. The TCB proxy + region-aware Vercel routing handle the rest.

| Env var | Web (Vercel) | WeChat-Intl (SCF) | WeChat-CN (SCF) |
|---|---|---|---|
| `DATABASE_URL` | Supabase pooler | TencentDB Postgres (Intl) | TencentDB Postgres (CN) |
| `STORAGE_PROVIDER` | `vercel` | `tencent-cos` | `tencent-cos` |
| `TENCENT_COS_BUCKET` | unset | `hg-intl-<appid>` | `hg-cn-<appid>` |
| `TENCENT_COS_REGION` | unset | `ap-singapore` | `ap-shanghai` |
| `AI_PROVIDER` | `gemini` | `gemini` | `qwen` |
| `WECHAT_AI_PROVIDER` | `qwen` (only fires for WeChat-stamped requests) | n/a (already CN-friendly) | n/a (already CN-friendly) |
| `WECHAT_APP_ID` | n/a | overseas appId | mainland appId |
| `NEXTAUTH_URL` | `https://expert-network.vercel.app` | Intl SCF custom domain | CN SCF custom domain (post-ICP) |

The WeChat client picks which stack to hit at **build time** via `TARO_APP_REGION` and `TARO_APP_API_BASE`. See [`docs/exec-plans/active/tencent-cloud-rollout.md`](../exec-plans/active/tencent-cloud-rollout.md) for the operational checklist.

## 6. What's Still on the Todo List

| Item | Why it matters |
|---|---|
| **Two WeChat MP appIds** registered (mainland + overseas) | Different review boards, different WeChat Pay merchants |
| **TencentDB Postgres** provisioned in both `ap-shanghai` and `ap-singapore` | Removes cross-border DB hops; satisfies CN data-residency |
| **SCF Web Functions** deployed in both TCB envs | Move compute to Tencent — currently both TCB proxies forward to Vercel as a transitional baseline |
| **ICP filing** for the CN custom domain | Required to bind a non-`*.tcloudbaseapp.com` domain in mainland CN |
| **Schema migration parity** | Apply Prisma migrations to all three databases on every release |
