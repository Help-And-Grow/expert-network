# Product Features

**Status**: Accepted (mixed phases)
**Date**: 2026-04
**Scope**: Revenue-bearing and growth-bearing product capabilities. Companion: [architecture.md](architecture.md), [agent-system.md](agent-system.md).

This document covers the four product capabilities that have non-trivial design surface: **payments**, **premium live consultation**, **Telegram profile sharing**, and the **pluggable expert avatar control plane**. Smaller surfaces (browse, discover, reviews, profile dashboard) follow standard CRUD patterns and live entirely in the code.

**Product language**: in UI we say **meetup**, **player** (founder), **coach** (expert), **appreciation** (review). Implementation still uses Prisma `Booking`, `Founder`, `Expert`, `Review` for backwards compatibility.

---

## 1. Payments

Payments collect from **players** and distribute to **experts** across three geographies.

### Methods

| Method | Surface | Path |
|--------|---------|------|
| **Stripe Checkout** | Web (primary) | `src/app/api/bookings/checkout/route.ts` → hosted checkout |
| **TON via TonConnect** | Telegram | `src/app/api/bookings/ton-payment/route.ts` → on-chain transfer |
| **WeChat Pay JSAPI** | WeChat Mini Program | `src/lib/wechat-pay.ts` (direct + partner JSAPI) |
| **Free** | Any (zero-priced experts) | `src/app/api/bookings/free/route.ts` — direct `Booking` row |

Manual PayNow routes remain in the repo for legacy operational compatibility but are no longer surfaced in the primary booking UX.

### Model

- **Stripe Connected Accounts** (Express type) for expert payouts.
- **Platform fee**: configurable via `STRIPE_PLATFORM_FEE_PERCENT` (default 15–20%) — applied as `application_fee_amount` on Checkout Sessions.
- **WeChat Pay 分账 (profit-sharing)**: when `WECHAT_PAY_PARTNER_MODE=true`, the mini program uses **partner JSAPI** with `settle_info.profit_sharing: true`. After `TRANSACTION.SUCCESS` the server calls `/v3/profitsharing/orders` to move the platform share to `WECHAT_PAY_PLATFORM_MCH_ID`. Receiver `name` must be RSA-OAEP-SHA256 encrypted per WeChat Pay v3 (`WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM`). Status persisted on `Booking.wechatProfitShareStatus`.
- **Full upfront** charging — no half-paid bookings created in the new flow. Legacy remainder endpoints remain only for old records.

### Stripe Double-Write

Bookings are created via two independent paths to survive webhook delays:
1. **Stripe webhook** (`checkout.session.completed`) — server-to-server.
2. **Verify endpoint** (`POST /api/bookings/verify`) — browser calls after Checkout redirect.

Both paths key off `stripeCheckoutSessionId` to dedupe.

---

## 2. Premium Live Consultation (TRTC)

Paid 1:1 live consultations on **Tencent Cloud TRTC**. Phased rollout intentionally constrained so we never ship an open-ended realtime cost surface.

### Decisions

1. **Booking-scoped rooms** — one TRTC room per `Booking`, never ad hoc.
2. **Per-surface entitlement model** (see §2a below) — `POST /api/trtc/token` refuses to mint a `UserSig` unless the booking is flagged premium-live AND the caller's surface-specific entitlement check passes.
3. **Server-side signing only** — `UserSig` minted in `src/lib/trtc.ts`; no Tencent secret on any client.
4. **Reuse existing ledger** — debits go to `TokenLedger`, tied to `bookingId`. We did not add a `Transaction` model.
5. **One contract, two clients** — Web uses `trtc-sdk-v5`, WeChat uses native `<live-pusher>` / `<live-player>` with the TRTC `room://` URL scheme. Same backend.

### 2a. Entitlement model: tokens vs membership

The pricing/access rail is **branched on origin** because the two audiences have different billing surfaces:

| Surface | Entitlement | How access is granted | Where this is enforced |
|---|---|---|---|
| **Web / Telegram** | `tokens` | One-time **`TRTC_PREMIUM_LIVE_TOKENS` H&G token** debit per booking via `TokenLedger` (type `PREMIUM_LIVE_DEBIT`). Token balance topped up via in-app purchase / earned via paid meetups. | `ensurePremiumLiveDebit()` in `/api/trtc/token` |
| **WeChat MP (current Intl + future Mainland CN)** | `membership` | Active row in the `Membership` table. Subscription billed via WeChat Pay (when mainland-CN MP launches) or kept manual for the international user-test. | `hasActiveMembership()` from `src/lib/membership` |

Both gates run **after** the booking has been validated as premium-live, the participant is verified as founder/expert, and the time window is open. So if the user is a participant of a premium-live booking and inside the room window, the only remaining check is "do you have the right entitlement for your surface."

The public read-only endpoint `GET /api/trtc/config` returns `entitlement: "membership" | "tokens"` based on the requesting surface, so the booking page can render the correct CTA copy ("Costs N H&G tokens" vs. "Active membership required") without an authenticated round-trip.

**Why split, not unify.** Mainland-CN users can't easily top up an in-app token balance — WeChat Pay pushes toward subscription products with renewals/cancellations as a first-class concept. Web/Telegram users hit Stripe / TON which already supports one-shot charges and aligns naturally with per-booking token debits. Unifying the rails would force one audience into a billing UX their platform doesn't natively support.

### Phase status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Backend foundation: schema, env, signing, `POST /api/trtc/token`, ownership/window/credit checks | **Done** |
| 2 | Booking-flow toggle, `Booking.isPremiumLive`, premium-cost preview at checkout | **Done** |
| 3 | Web client `/consultation/[bookingId]` with `trtc-sdk-v5`; entry chip on `/booking` cards (visible only when `isPremiumLive` and inside the prejoin/grace window) | **Done** |
| 4 | WeChat client `pages/consultation/index` using native `<live-pusher mode="RTC">` + `<live-player mode="RTC">`; entry chip on the dashboard card | **Done** |

### Web client

`src/app/consultation/[bookingId]/page.tsx`

- Pre-join screen shows participant role, room close time, and any token cost.
- On join: lazy-imports `trtc-sdk-v5`, calls `enterRoom()` with the credentials from `/api/trtc/token`, attaches the local audio/video to a self-tile and subscribes to remote-user events (`REMOTE_USER_ENTER`, `REMOTE_VIDEO_AVAILABLE`, etc.).
- Controls: mic toggle, camera toggle, leave. Leaving routes back to `/booking`.
- Cleanup runs on unmount so navigating away always exits the room.

### WeChat client

`wechat/src/pages/consultation/index.tsx`

- Same backend call via the shared API helper. URL scheme:
  `room://cloud.tencent.com/rtc?sdkappid=...&roomid=...&userid=...&usersig=...&appscene=videocall`.
- `<live-pusher mode="RTC">` for self, one `<live-player mode="RTC">` per remote participant. Remote participants are tracked through the pusher's `onStateChange` event (codes 1020 / 1021 = remote join / leave).
- Mic toggle uses `LivePusherContext.pause/resume`; camera toggle re-renders with the `enableCamera` prop flipped.

### Entry points

- Web: chip on each booking card in `/booking` — only when `booking.isPremiumLive` AND the live window is open (15-min prejoin / 15-min grace, mirroring the server).
- WeChat: chip on the dashboard card with the same gating.

---

## 3. Telegram Profile Sharing

Two flows, both using the same expert-card payload format.

### 3.1 Self-share via inline command

`@HelpGrowBot me` typed by the expert in any Telegram chat. Resolved by the bot's inline-query handler in `src/app/api/webhooks/telegram/route.ts`.

### 3.2 Friend-to-friend share

User A shares User B's profile to User C. Two entry points:

- **In-app Share button** — every public expert profile (`/experts/[id]`) shows a Share button. The shared logic in `src/lib/telegram.ts` (`shareLink`) picks the best channel:
  - Inside the Telegram Mini App → `WebApp.openTelegramLink('https://t.me/share/url?...')` opens TG's native share sheet.
  - Browser with Web Share API → `navigator.share()`.
  - Otherwise → clipboard copy with toast feedback.
- **Inline search** — `@HelpGrowBot <name or topic>` in any Telegram chat. The bot's inline-query handler matches against published experts (`User.name`, `User.nickName`, `Expert.bio`) and returns up to 10 cards. The card credits the sharer ("_Shared by &lt;sharer&gt;_") when the caller is linked.

### Card payload

| Prisma field | Telegram element |
|--------------|------------------|
| `user.nickName ?? user.name` | Title |
| `expert.bio` (≤100 chars) | Description |
| `user.image` | `thumb_url` |
| `expert.avgRating`, `reviewCount` | "⭐ {rating} ({count} reviews)" |
| `expert.id` | Web-app buttons → `/experts/{id}` and `/experts/{id}/book` |

Telegram inline results are cached for 300s with `is_personal: true` to avoid leaking another user's share-attribution.

### Linking & rate limiting

- The webhook auto-links `User.telegramId` whenever any message arrives from a known `telegramUsername`.
- Telegram throttles inline queries upstream; the server caches answers and uses `is_personal: true` to scope.

---

## 4. Pluggable Expert Avatar Control Plane

A capability fabric that lets each expert configure their own AI service stack without touching code.

### Five-layer model

1. **Experience surfaces** — Web, Telegram, WeChat, MCP, future operator/admin.
2. **Service control plane** — tenant/expert config, entitlement, routing policy, rollout flags.
3. **Capability fabric** — named capabilities: voice reply, realtime talk, meeting capture, memo/reflection, social learning, service matching, conversion support.
4. **Orchestration adapters** — pluggable: `hiclaw | scion | local`.
5. **Runtime/context infra** — models, tools, storage, memory, embeddings, queues.

Experience surfaces never bind directly to HiClaw or Scion. They request a capability; the control plane resolves the adapter/runtime stack.

### Capability contract

Each capability resolves through four selectors:

| Selector | Values | Meaning |
|----------|--------|---------|
| `orchestrator` | `hiclaw \| scion \| local` | Multi-agent OS choice |
| `runtimeProfile` | container shape, concurrency, timeout, region, isolation | How it runs |
| `modelProfile` | model family, provider, fallback chain, response target | Which AI |
| `memoryProfile` | `mem9 \| pgvector \| hybrid`, retrieval mode, write policy | Where memory lives |

**Precedence**: platform default → expert override → capability override.

### Adapter positioning

- **HiClaw** — workflows that benefit from explicit multi-agent collaboration with human-in-the-loop approval (meeting follow-up, memo loops, expert growth, multi-step coordination). See [agent-system.md](agent-system.md).
- **Scion** — Google-oriented stacks; lighter-weight orchestration when the deployment is GCP-native.
- **Local** — Docker + Ollama + Postgres/pgvector baseline for on-prem and air-gapped deployments. Always available as a fallback.
