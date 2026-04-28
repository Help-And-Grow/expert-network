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
| **Web (Global)** | Browsers worldwide (Telegram included) | **Vercel** Functions in `sin1` | Vercel Blob | **Supabase** Postgres in AWS `ap-southeast-1` | Gemini |
| **WeChat — Overseas** | WeChat users outside mainland CN (HK / TW / SEA / diaspora) | **Tencent SCF Web Function** in **Intl TCB env** (`ap-singapore`) | Tencent COS (Intl, `ap-singapore`) | TencentDB Postgres (Intl, `ap-singapore`) | Gemini (route stays outside GFW) |
| **WeChat — Mainland** | WeChat users in mainland CN | **Tencent SCF Web Function** in **CN TCB env** (`ap-shanghai`) | Tencent COS (CN, `ap-shanghai`) | TencentDB Postgres (CN, `ap-shanghai`) | Qwen / Hunyuan (DashScope or Tencent) |

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

All providers implement the `AIProvider` interface (`src/lib/ai/types.ts`). The factory in `src/lib/ai/index.ts` reads `AI_PROVIDER` from `SystemConfig` (or env). Supported drivers: `gemini`, `qwen`, `openai`, `zai`, `dedalus`, `byteplus`, `volcengine`. Model defaults and readiness checks centralize in `src/lib/ai/provider-catalog.ts`.

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

### 3.2 Default Provider: Gemini

**Decision (2026-04):** Gemini is the **default AI provider** across text generation, voice synthesis, and speech understanding. The hybrid free-tier proposal that routed text to BytePlus and audio to Gemini is **superseded** — operating two providers for cost arbitrage created more failure modes than the savings justified.

| Capability | Default | Model | Fallback |
|------------|---------|-------|----------|
| Profile generation, matching, reasoning | Gemini | `gemini-3-pro-preview` (text) / configured via `SystemConfig` | BytePlus `doubao-seed-1.6-flash`, then Qwen-Max |
| Profile image generation | Gemini | `gemini-3-image-preview` | OpenAI → Z.AI → Qwen → Dedalus (chain in `src/lib/profile-media.ts`) |
| Text-to-speech (intro voice, async voice chat) | Gemini | `gemini-3-flash-tts-preview` | Fish Audio voice IDs (env-pinned) |
| Speech understanding (realtime voice chat) | Gemini | `gemini-3-flash` (multimodal native) | DashScope SenseVoice |
| Embeddings | Gemini | `gemini-embedding-001` | none — Gemini only |
| Search grounding | Gemini | Native Google Search grounding | none — Gemini only |

**Why Gemini-default.** Native Google Search grounding for profile generation, multimodal audio I/O without ASR→LLM→TTS chaining, and a perpetual free tier that covers product-grade volume. Other providers stay registered as fallbacks for when Gemini quotas are exhausted or when the operator wants to flip via `/admin/ai-provider`.

### 3.3 Fallback Strategy

- **Text matching**: provider-level fallback chain in the factory; route handler also has a deterministic keyword-matching fallback so 500s never reach users.
- **Image generation**: ordered chain (`openai → zai → qwen → gemini → dedalus`) handled by `generateProfileImageResilient`.
- **Voice synthesis**: `getProfileIntroVoiceSynthesisProviders` returns an ordered list; the audio route iterates until one returns playable audio.

### 3.4 Region-Aware Provider Routing

WeChat-originated traffic (stamped by the TCB proxy, detected via `isWeChatOriginatedRequest`) is routed to the configured `WECHAT_AI_PROVIDER` so inference stays inside the GFW boundary. Default: **Qwen** via DashScope. Operators can flip this to BytePlus, Volcengine, or another CN-region provider via `SystemConfig` key `WECHAT_AI_PROVIDER` (no redeploy) or the env var.

Implementation:
- `resolveAIProvider({ request })` in `src/lib/ai/index.ts` — request-aware factory with per-name caching.
- `getActiveAIProviderNameForRequest(request)` in `src/lib/ai/provider-catalog.ts` — resolves the right provider name.
- Wired into `src/app/api/experts/match/route.ts` (Discover) and `src/lib/chat-engine.ts` (the `POST /api/chat` and Telegram bot path).

Non-WeChat traffic continues to use the global default (Gemini).

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
