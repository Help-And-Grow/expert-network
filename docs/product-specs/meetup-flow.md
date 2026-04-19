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
8. **Primary**: Pay deposit via PayNow customized QR (pre-filled amount + receiver UEN + reference)
9. Player submits payment proof/reference in-app for verification
10. Admin confirms receipt → meetup confirmed and notifications sent
11. Fallback option: Stripe Checkout (PayNow, GrabPay, Card)
12. Remainder auto-charged 24h after the meetup (Stripe) or prompted manually (PayNow/TON/Telegram)

Implementation note:
On web, when direct PayNow QR is not configured for the deployment environment, the booking page should make Stripe Checkout the primary paid-meetup path instead of showing a broken PayNow CTA.

## Requirements

- Slots generated from expert's `weeklySchedule` if no explicit `AvailableSlot` records
- Multi-slot selection for longer meetups
- Overlap detection prevents double-booking
- Meeting link required before payment for online meetups
- Free meetups skip payment and create a `Booking` row directly
- PayNow pending meetups hold slot for 30 minutes; expired holds auto-cancel
- PayNow payment status pipeline: `pending_paynow` → `submitted_paynow` → `deposit_paid`

## Edge Cases

- Expert has no availability set → show empty state with message
- All slots for today are in the past → filter them out
- User tries to schedule with their own profile → blocked with error
- Stripe webhook fails → verify endpoint on success page creates `Booking`
- PayNow transfer submitted but not yet confirmed → booking remains `PENDING` with “pending confirmation” state in dashboard
