# Product Features

**Status**: Accepted (mixed phases)
**Date**: 2026-04
**Scope**: Revenue-bearing and growth-bearing product capabilities. Companion: [architecture.md](architecture.md).

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

## 2. Premium Live Consultation (TRTC) — WeChat-Mini-Program-only

Paid 1:1 live consultations on **Tencent Cloud TRTC**, available only inside the **WeChat Mini Program** and gated by an active `Membership` on the founder side. Web and Telegram surfaces no longer expose a premium-live opt-in; the regular online booking experience there is intentionally identical to a normal Google-Meet-style meetup.

### Decisions

1. **Booking-scoped rooms** — one TRTC room per `Booking`, never ad hoc.
2. **WeChat-only surface** — `POST /api/trtc/token` refuses to mint a `UserSig` for a founder unless the request originates from the WeChat Mini Program (`isWeChatOriginatedRequest`). The expert (host) can join from any surface — they answer, they don't pay.
3. **Membership-only entitlement** — founder must hold an active `Membership.currentUntil > now`. The previous H&G token-debit code path (`ensurePremiumLiveDebit`, `PREMIUM_LIVE_DEBIT` ledger entries) was retired 2026-05-07; existing ledger rows stay for audit history.
4. **Server-side signing only** — `UserSig` minted in `src/lib/trtc.ts`; no Tencent secret on any client.
5. **One contract, two clients** — Web uses `trtc-sdk-v5` (used by experts joining their own MP-booked rooms). WeChat MP founder client uses native `<live-pusher>` / `<live-player>` with the TRTC `room://` URL scheme. Same backend.

### 2a. Why this scope

- **Mainland-CN audience uses WeChat Pay subscriptions** as the natural billing surface for renewable access — premium live maps cleanly to a Membership tier. Forcing them to top up a token balance would feel out of place.
- **Web / Telegram audience already gets Google-Meet-style meetings** out of the box. Adding an in-app HD video room there would be a feature in search of a use case — and bloated the booking UX with a token-balance tracker most users would never engage with.
- **One billing rail per surface** keeps the booking flow simple but beautiful — fewer toggles, fewer error states.

### Phase status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Backend foundation: schema, env, signing, `POST /api/trtc/token`, ownership/window/credit checks | **Done** |
| 2 | Booking-flow toggle, `Booking.isPremiumLive`, premium-cost preview at checkout | **Done (toggle UI removed 2026-05-07; flag stays for WeChat-MP-driven bookings)** |
| 3 | Web client `/consultation/[bookingId]` with `trtc-sdk-v5`; entry chip on `/booking` cards | **Done — used by experts joining MP-booked rooms only** |
| 4 | WeChat client `pages/consultation/index` using native `<live-pusher mode="RTC">` + `<live-player mode="RTC">`; entry chip on the dashboard card | **Done** |
| 5 | Membership-only entitlement on `/api/trtc/token`; H&G token debit path retired | **Done 2026-05-07** |

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

## 3. Telegram bot & Mini App

Production bot is **`@helpAndGrowBot`** (migrated from `@Expert_Network_Help_And_Grow_Bot` on 2026-05-13). Full operational reference: [docs/references/telegram-bot.md](../references/telegram-bot.md). Product-side summary below.

### 3.1 DM behaviour

1-on-1 with the bot:

- `/start` → welcome with three Mini-App buttons: **Open Help & Grow**, **Discover Community**, **Edit my profile**.
- `/help`, `/browse` → help text / Discover entry.
- `/find <query>` or any free text → AI expert match (`chat()` from `src/lib/chat-engine.ts`), reply with up to 5 experts + per-expert **View** / **Book** `web_app` buttons.

### 3.2 Group @-mention recommendations

In a Telegram group, the bot only responds when explicitly addressed:

- `@helpAndGrowBot <question>` — bot strips its own @-mention and runs the residue through the same AI-match pipeline. Reply is threaded under the question with up to 5 expert recommendations.
- `/cmd@helpAndGrowBot …` — slash commands self-target via Telegram's convention; same handlers as DM.
- Reply-to-bot — counted as addressing the bot.

**Privacy Mode must be disabled** in BotFather for reliable @-mention delivery (a per-group cache quirk in Telegram). The app-level gate in `src/app/api/webhooks/telegram/route.ts` keeps observable behaviour the same — only mentioned/commanded/replied messages produce a reply.

Group inline-keyboard buttons can't be `web_app:` (Telegram restriction), so we use `url:` buttons pointing at Mini-App deep links (§3.3) — taps open the Mini App with full auth context, not the in-app browser.

### 3.3 Mini App deep-link convention

URL shape: `https://t.me/<bot>/<slug>?startapp=<prefix-id>`. Tapping this in any Telegram chat opens our Mini App with `Telegram.WebApp.initDataUnsafe.start_param` set. `src/components/telegram-start-param-router.tsx` reads the param on boot and routes via Next.js router.

| start_param | Lands on | Emitted from |
|---|---|---|
| `expert-<id>` | `/experts/<id>` | Group reply "View" buttons; Share button on `/experts/[id]` |
| `book-<id>` | `/experts/<id>/book` | Group reply "Book" buttons |
| `review-<id>` | `/reviews/<bookingId>` | `notifyReviewRequest()` DM |
| `profile-edit` | `/profile` | `/start` welcome button |

Builder helpers: `telegramMiniAppLink()` exported from `src/lib/telegram.ts` (client) and an in-file helper in the webhook route (server). Adding a new prefix is a two-line change — see the [telegram-bot reference](../references/telegram-bot.md) §4.

### 3.4 Friend-to-friend share

`/experts/[id]` page → **Share** button. `shareLink()` in `src/lib/telegram.ts` picks the best channel:

- Inside the Mini App → shares the `expert-<id>` deep link via `openTelegramLink("https://t.me/share/url?…")`. Recipient lands directly in the Mini App at that profile (not the in-app browser).
- Browser with Web Share API → `navigator.share()` with the canonical web URL.
- Otherwise → clipboard copy with toast feedback.

On Telegram **mobile** clients, `openTelegramLink` shows a "Forward to…" chat picker. On Telegram **Web**, content lands in Saved Messages without a picker (Telegram-client quirk). Acceptable for a mobile-first MVP.

### 3.5 Inline-query expert search

`@helpAndGrowBot <name or topic>` in any Telegram chat — Telegram opens an inline-query interface. The bot's inline-query handler (`src/app/api/webhooks/telegram/route.ts`) matches against published experts and returns up to 10 cards as `InlineQueryResultArticle`. Currently disabled at the bot level (`supports_inline_queries: false` per `getMe`); enable via BotFather `/setinline` to activate. Handler is dormant until enabled.

Card payload:

| Prisma field | Telegram element |
|---|---|
| `user.nickName ?? user.name` | Title |
| `expert.bio` (≤100 chars) | Description |
| `user.image` | `thumb_url` |
| `expert.avgRating`, `reviewCount` | "⭐ {rating} ({count} reviews)" |
| `expert.id` | Web-app buttons → `/experts/{id}` and `/experts/{id}/book` |

Results cached 300s with `is_personal: true` to avoid leaking share-attribution.

### 3.6 Outbound notifications

All helpers in `src/lib/telegram-bot.ts`. Resolve a chat ID from `User.telegramId` (preferred) or `User.telegramUsername` via Prisma. Fire-and-forget — failures are logged and don't block booking flow.

| Helper | Fires on | Contents |
|---|---|---|
| `notifyExpertBooking` / `notifyFounderBooking` | New booking confirmed (`/api/bookings/verify`) | Date + price + `web_app` → `/booking` |
| `notifyCancellation` / `notifyReschedule` / `notifyLocationUpdate` | Booking edits | Context-specific |
| `sendSessionReminder` | 1h before meetup | Reminder DM |
| `notifyReviewRequest` (new 2026-05-13) | `PATCH /api/bookings/[id]` with `status: COMPLETED` | "🌟 How was your meetup?" + `url` button using `review-<bookingId>` deep link. Idempotent: skips when a `Review` row already exists. |

### 3.7 Linking & rate limiting

- The webhook auto-links `User.telegramId` whenever any message arrives from a known `telegramUsername`.
- Telegram throttles inline queries upstream; the server caches answers and uses `is_personal: true` to scope.
- Outbound DMs require the user to have DM'd the bot at least once (Telegram restriction). After a bot identity migration, existing users must `/start` the new bot before notifications resume.

---

## 4. Pluggable Expert Avatar Control Plane

A capability fabric that lets each expert configure their own AI service stack without touching code.

### Five-layer model

1. **Experience surfaces** — Web, Telegram, WeChat, MCP, future operator/admin.
2. **Service control plane** — tenant/expert config, entitlement, routing policy, rollout flags.
3. **Capability fabric** — named capabilities: voice reply, realtime talk, meeting capture, memo/reflection, social learning, service matching, conversion support.
4. **Orchestration adapters** — pluggable: `scion | local`.
5. **Runtime/context infra** — models, tools, storage, memory, embeddings, queues.

Experience surfaces never bind directly to a specific adapter. They request a capability; the control plane resolves the adapter/runtime stack.

### Capability contract

Each capability resolves through four selectors:

| Selector | Values | Meaning |
|----------|--------|---------|
| `orchestrator` | `scion \| local` | Multi-agent OS choice |
| `runtimeProfile` | container shape, concurrency, timeout, region, isolation | How it runs |
| `modelProfile` | model family, provider, fallback chain, response target | Which AI |
| `memoryProfile` | `mem9 \| pgvector \| hybrid`, retrieval mode, write policy | Where memory lives |

**Precedence**: platform default → expert override → capability override.

### Adapter positioning

- **Scion** — Google-oriented stacks; lighter-weight orchestration when the deployment is GCP-native.
- **Local** — Docker + Ollama + Postgres/pgvector baseline for on-prem and air-gapped deployments. Always available as a fallback.
