# Premium Live Consultation via TRTC

**Status**: Accepted (phased)  
**Date**: 2026-04

## Context

Help & Grow needs a paid in-app live consultation path for high-value bookings without introducing an open-ended realtime cost surface.

Current repo state before this work:

- The docs already removed Agora from the intended stack.
- The product does not yet have a working premium live consultation implementation.
- The current commercial rails are `Booking`, `User.tokenBalance`, and `TokenLedger`.
- There is no `Transaction` model in the current schema, so premium live charging should not invent a parallel ledger in phase 1.

This decision standardizes live consultation on **Tencent Cloud TRTC** and rolls it out in phases that fit the current architecture.

## Decision

The platform will use **Tencent Cloud TRTC** for premium 1:1 live consultation.

Key decisions:

1. **Premium live is booking-scoped**
   A TRTC room is created logically per `Booking`, not per ad hoc user action.
2. **Room access is credit-gated**
   TRTC token issuance is blocked unless the booking is marked for premium live and the booking-scoped credit deduction has succeeded.
3. **Server-side signing only**
   The backend generates time-bound `UserSig` values. No TRTC secret is exposed to web or Mini Program clients.
4. **Use the existing ledger**
   Premium live debits are recorded in `TokenLedger`, tied directly to `bookingId`.
5. **Web and WeChat share one backend contract**
   Web uses the current official TRTC web SDK path (`trtc-sdk-v5` per Tencent’s current docs). WeChat Mini Program uses the Tencent Mini Program TRTC SDK (`trtc-wx` / current official equivalent during integration).

## Business Rationale

- **Credit-based access** keeps abuse low because unpaid users never receive room credentials.
- **Cost efficiency** stays aligned with Tencent’s free-minute quota during GTM because only paid VIP bookings can enter live rooms.
- **Commercial split** stays clean:
  - `Help-And-Grow/expert-network`: open-source, hackathon, Tencent/Qwen-friendly showcase
  - `jlzxwt8/expert-network`: commercialization base

The product surface should stay aligned across both repos. Only provider, deployment, and environment policy should differ.

## Phase Plan

### Phase 1: backend foundation

Implemented in this phase:

- Add premium-live fields to `Booking`
- Add TRTC env validation and examples
- Add shared TRTC signing helpers
- Add `POST /api/trtc/token`
- Enforce booking ownership, schedule window, premium flag, and booking-scoped token debit

Not in phase 1:

- Booking-page premium live toggle
- Web consultation UI
- WeChat consultation page
- TRTC webhook ingestion

### Phase 2: booking and payment plumbing

- Add premium live toggle to booking flow
- Persist `Booking.isPremiumLive`
- Make premium-live token cost visible before confirmation
- Ensure checkout / payment flows preserve the premium-live selection

### Phase 3: web consultation client

- Add `/consultation/[bookingId]`
- Integrate `trtc-sdk-v5`
- Join room with backend-issued credentials
- Support microphone/camera preview, reconnect, and leave flow

### Phase 4: WeChat Mini Program client

- Add consultation page under `wechat/`
- Integrate Tencent Mini Program TRTC SDK
- Reuse the same `/api/trtc/token` contract

### Phase 5: usage tracking and overage controls

- Ingest TRTC room callbacks/webhooks
- Track `liveDurationMinutes`
- Add overage handling if needed
- Add operator observability

## Data Model

`Booking` is extended with premium-live state:

```prisma
model Booking {
  // ...existing fields
  isPremiumLive        Boolean   @default(false)
  liveRoomId           String?   @unique
  liveDurationMinutes  Int?
  liveAccessChargedAt  DateTime?
}
```

Notes:

- `liveRoomId` is persisted so the same booking always maps to the same TRTC room.
- `liveAccessChargedAt` makes the room-entry debit idempotent.
- Premium-live token debits are stored in `TokenLedger` with a booking-scoped `type`, not a new `Transaction` table.

## Backend Contract

### `POST /api/trtc/token`

Request:

```json
{
  "bookingId": "cm..."
}
```

Validation rules:

1. Caller must be authenticated through `resolveUserId(request)`.
2. Caller must be either:
   - the booking founder, or
   - the expert who owns the booking
3. Booking must be premium live: `isPremiumLive = true`
4. Booking must be in a valid state for consultation entry
5. Current time must be within the consultation entry window
6. Booking-scoped premium-live debit must have succeeded, or be debited idempotently on first access

Response shape:

```json
{
  "sdkAppId": 1400000000,
  "roomId": 123456789,
  "userId": "founder_ab12cd34_ef56gh78",
  "userSig": "eJx...",
  "expiresInSeconds": 2700,
  "expiresAt": "2026-04-20T10:00:00.000Z",
  "participantRole": "founder"
}
```

## TRTC Credential Strategy

- `UserSig` is generated on the server with a strict TTL derived from the booking window.
- The initial implementation uses numeric `roomId` values for maximum cross-platform compatibility.
- The room ID is assigned once per booking and persisted in `Booking.liveRoomId`.
- `privateMapKey` is deferred until client integration requires room-level advanced permission control in production.

## Environment Surface

Phase 1 adds:

- `TRTC_APP_ID`
- `TRTC_SECRET_KEY`
- `TRTC_PREMIUM_LIVE_TOKENS`
- `TRTC_PREJOIN_SECONDS`
- `TRTC_POST_END_GRACE_SECONDS`

Naming note:

- Tencent’s console terminology is `SDKAppID` and `SDKSecretKey`.
- Repo env names stay shorter, but the code comments should make that mapping explicit.

## Security and Cost Controls

1. **No anonymous room entry**
   `/api/trtc/token` requires authenticated booking participation.
2. **Time-bounded token issuance**
   Tokens are short-lived and tied to the current booking window.
3. **Credit gate before room entry**
   If the premium-live debit has not succeeded, the route returns an error instead of credentials.
4. **One room per booking**
   Avoids uncontrolled room sprawl and simplifies auditability.
5. **Deferred advanced permission control**
   We will add `PrivateMapKey` only when the product is ready to turn on TRTC advanced permission control globally for that app.

## Consequences

- The live consultation path stays secure without exposing TRTC secrets client-side.
- We avoid architecture drift by reusing `Booking` and `TokenLedger`.
- The backend contract is ready before the web and WeChat clients are integrated.
- Premium live can scale gradually because room access is entitlement-based rather than open-ended.

## Immediate Implementation Status

Implemented in phase 1:

- `Booking` schema extended for premium-live entitlement, room identity, and idempotent charging
- TRTC env surface added to `.env.example` and validated in `src/lib/env.ts`
- Shared TRTC signing and room/window helpers added in `src/lib/trtc.ts`
- `POST /api/trtc/token` added with auth, booking validation, room allocation, and booking-scoped token debit

Deferred to code in this sequence:

1. Booking UI/payment plumbing
2. Web consultation client
3. WeChat consultation client
4. TRTC callback ingestion

## Status (verification)

- Agora is no longer the intended RTC architecture in repo documentation
- Current Tencent official web quick-start docs use `trtc-sdk-v5`
- Production signing remains server-side via `UserSig`
- `npx prisma generate` passed
- `npm run typecheck` passed
- `npm run build` passed
