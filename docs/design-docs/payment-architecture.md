# Design Doc: Payment Architecture

**Status**: Implemented
**Date**: 2026-03
**Author**: Tony Wang
**Implemented in**:
- `src/lib/paynow.ts`
- `src/app/api/bookings/paynow/route.ts`
- `src/app/api/bookings/[id]/paynow-submit/route.ts`
- `src/app/api/admin/bookings/[id]/paynow-confirm/route.ts`
- `src/app/experts/[id]/book/page.tsx`
- `src/app/booking/page.tsx`

## Context

The marketplace needs to collect payments from founders and distribute to experts, supporting multiple payment methods across geographies.

## Decision

### Payment Methods
- **PayNow (primary for SGD web bookings)**: customized SGQR with pre-filled amount and receiver UEN
- **Stripe** (fallback + remainder): Checkout Sessions for fallback deposits and manual remainder checkout
- **TON** (crypto): On-chain transfers via TonConnect for crypto-native users
- **WeChat Pay**: JSAPI for WeChat Mini Program users
- **Free sessions**: Direct booking creation for experts with zero pricing

### Marketplace Model
- Stripe Connected Accounts (Express type) for expert payouts
- Platform fee: configurable via `STRIPE_PLATFORM_FEE_PERCENT` (default 15%)
- Fee applied as `application_fee_amount` on Checkout Sessions

### Deposit Model
- 50% deposit charged at booking time
- PayNow deposit flow:
  - create pending booking + generated PayNow QR payload (`pending_paynow`)
  - founder submits transfer (`submitted_paynow`)
  - admin confirms receipt and booking transitions to `CONFIRMED` + `deposit_paid`
- Remainder auto-charged 24h after session ends (daily cron) where possible
- Card saved via `setup_future_usage: "off_session"` for remainder

### Stripe Double-Write Pattern
Booking creation happens via two independent paths:
1. **Stripe webhook** (`checkout.session.completed`) — server-to-server
2. **Verify endpoint** (`/api/bookings/verify`) — browser calls after redirect

Both paths check for existing booking by `stripeCheckoutSessionId` to prevent duplicates.

### PayNow Confirmation Pattern
- PayNow flow intentionally uses explicit manual confirmation to avoid false-positive booking confirmation.
- Slot hold defaults to 30 minutes; stale `pending_paynow` bookings are auto-cancelled by slot fetch/availability path.
- Admin dashboard includes action to confirm PayNow transfer once operations verify incoming funds.

## Consequences

- **Pro**: Booking creation is resilient to webhook delays or failures
- **Pro**: Connected Accounts handle KYC and payouts for experts
- **Pro**: Better Singapore UX with scanner-friendly pre-filled PayNow amount + receiver
- **Con**: TON payments require manual confirmation (no webhook equivalent)
- **Con**: WeChat Pay webhooks need production testing
- **Con**: PayNow requires operations/admin confirmation unless bank webhook integration is added
