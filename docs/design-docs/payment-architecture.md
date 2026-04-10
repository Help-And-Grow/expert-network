# Design Doc: Payment Architecture

**Status**: Implemented
**Date**: 2026-03
**Author**: Tony Wang
**Implemented in**:
- `src/lib/wechat-pay.ts` (direct + partner JSAPI, profit sharing)
- `src/app/api/bookings/wechat-pay/route.ts`, `src/app/api/webhooks/wechat-pay/route.ts`
- `src/lib/paynow.ts`
- `src/app/api/bookings/paynow/route.ts`
- `src/app/api/bookings/[id]/paynow-submit/route.ts`
- `src/app/api/admin/bookings/[id]/paynow-confirm/route.ts`
- `src/app/experts/[id]/book/page.tsx`
- `src/app/booking/page.tsx`

## Context

The marketplace needs to collect payments from **players** (founders) and distribute to experts (**coaches**), supporting multiple payment methods across geographies.

**Product language:** In UI we say **meetup**; implementation still uses Prisma **`Booking`**, routes under `/api/bookings/`, and the word “booking” in code-focused sections below.

## Decision

### Payment Methods
- **PayNow (primary for SGD web meetups)**: customized SGQR with pre-filled amount and receiver UEN
- **Stripe** (fallback + remainder): Checkout Sessions for fallback deposits and manual remainder checkout
- **TON** (crypto): On-chain transfers via TonConnect for crypto-native users
- **WeChat Pay**: JSAPI for WeChat Mini Program users
- **Free sessions**: Direct `Booking` row creation for experts with zero pricing

### Marketplace Model
- Stripe Connected Accounts (Express type) for expert payouts
- Platform fee: configurable via `STRIPE_PLATFORM_FEE_PERCENT` (default 15%)
- Fee applied as `application_fee_amount` on Checkout Sessions

### WeChat Pay (service provider + 分账)
When `WECHAT_PAY_PARTNER_MODE=true`, the mini program uses **partner JSAPI** (`/v3/pay/partner/transactions/jsapi`) with `settle_info.profit_sharing: true` so the sub-merchant (expert’s `Expert.wechatSubMchId` / 特约商户号) receives the payment. After `TRANSACTION.SUCCESS`, the server calls **`/v3/profitsharing/orders`** to move the platform share (same percentage as Stripe, from deposit in CNY) to the platform merchant (`WECHAT_PAY_PLATFORM_MCH_ID`, defaulting to the service provider mchid). Receiver `name` must be RSA-OAEP-SHA256 encrypted per WeChat Pay API v3; set `WECHAT_PAY_PLATFORM_MERCHANT_NAME`, `WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM`, and `WECHAT_PAY_PLATFORM_CERT_SERIAL`. Status is stored on `Booking.wechatProfitShareStatus`. Without partner mode, the legacy **direct merchant** JSAPI path is unchanged.

### Deposit Model
- 50% deposit charged when the meetup is initiated (`Booking` created)
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
