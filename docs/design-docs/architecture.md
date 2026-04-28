# Architecture

**Status**: Accepted
**Date**: 2026-04
**Scope**: Cloud topology, AI routing, storage, authentication. Companion docs: [product-features.md](product-features.md), [agent-system.md](agent-system.md), [operations.md](operations.md).

This document is the technical foundation. It captures **where the app runs**, **which AI provider does what**, **where assets are stored**, and **how every client surface authenticates**. Product capabilities (payments, live consultation, sharing, avatar control plane) live in [product-features.md](product-features.md).

---

## 1. Tri-Cloud Deployment

The marketplace is deployed across three clouds, each chosen for a non-overlapping reason.

| Cloud | Role | What runs there |
|-------|------|-----------------|
| **Google Cloud Platform (GCP)** | Default backend + AI provider | Cloud Run origin, Vertex AI / Gemini API, GCS for global assets |
| **Vercel** | Edge frontend + serverless functions | Next.js app, API routes, Cron, Blob storage for non-China assets |
| **Tencent Cloud** | China-only path for WeChat | TCB HTTP-trigger proxy in `cn-` domains, Tencent COS for low-latency CN storage, TRTC for premium live |

**Why three clouds, not one.** WeChat Mini Programs require all callable domains to be on the WeChat allowlist; only mainland-CN domains pass. Hosting the entire backend in a CN domain would degrade everything else. The TCB proxy terminates inside the WeChat-allowlisted CN domain set and forwards to the Cloud Run origin in `asia-southeast1`, stamping `x-forwarded-via: tcb-proxy` and `x-forwarded-from: wechat` so the origin can make region-aware decisions.

**Region pinning.** Vercel functions are pinned to `sin1` (Singapore) via `vercel.json`. This minimizes round-trip latency to BytePlus and Alibaba `ap-southeast-1` AI endpoints (<50ms), which matters most for realtime voice chat.

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

## 5. Remaining Operational Work

These three items are infra/ops, not code — code paths exist but the external resources still need provisioning:

1. **Tencent COS bucket provisioning** — stand up the actual COS bucket + CAM credentials (code is ready; `TENCENT_COS_*` env vars need values).
2. **TCB deployment** — register the function from `infra/tcb-proxy/` against the production CloudBase env and bind the WeChat-allowlisted custom domain.
3. **Env sync** — standardize the new tri-cloud env vars across GCP and Vercel via `vercel env pull` / direct GCP secret manager pushes.
