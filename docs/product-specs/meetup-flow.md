# Product Spec: Meetup Flow

**Status**: Shipped

> **Implementation note:** Routes and Prisma models still use `book`, `/api/bookings`, and `Booking` for stability. User-facing copy across the product uses **meetup** / **schedule a meetup**.

## User Story

As a founder (player), I want to schedule a paid meetup with an expert (coach) by selecting a time slot and paying a deposit—so we can share context and move forward together (learn by doing, grow by helping).

## Flow

1. View expert profile → click **Schedule meetup** (or equivalent CTA)
2. Select date from horizontal date picker (next 14 days)
3. Select time slot(s) — 30-minute increments from expert's weekly schedule
4. Choose session type (online/offline) if expert supports both
5. For online: provide meeting link (Zoom, Google Meet, etc.)
6. For offline: view expert's location
7. **Overview** step: total price, 50% deposit, meetup details
8. On web, pay deposit via **Stripe Checkout**
9. Stripe Checkout surfaces supported methods such as PayNow or card based on Stripe configuration and user context
10. On Telegram, pay deposit via **TON Wallet** only
11. Booking confirms after the selected payment flow succeeds
12. Remainder auto-charged 24h after the meetup where the saved payment method allows it; TON remains manual

## Requirements

- Slots generated from expert's `weeklySchedule` if no explicit `AvailableSlot` records
- Multi-slot selection for longer meetups
- Overlap detection prevents double-booking
- Meeting link required before payment for online meetups
- Free meetups skip payment and create a `Booking` row directly
- Telegram payment path is TON-only
- Web payment path uses Stripe Checkout only

## Edge Cases

- Expert has no availability set → show empty state with message
- All slots for today are in the past → filter them out
- User tries to schedule with their own profile → blocked with error
- Stripe webhook fails → verify endpoint on success page creates `Booking`
- TON payment cancelled or declined in Telegram wallet → booking stays unconfirmed and can be retried
