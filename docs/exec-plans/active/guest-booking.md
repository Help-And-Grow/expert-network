# Guest Booking — No-Login Checkout Across Web / Telegram / WeChat

**Status:** Proposed (2026-05-06). Phased rollout, smallest viable change first.
**Goal:** A user lands on an expert's profile, picks a slot, pays, and the meetup
is on their calendar. No "create account" step, no password, no email-verification
gate before pay. Identity is captured *implicitly* from the payment rail (or the
platform — Telegram initData / WeChat openId — when the user is inside an MP).

---

## 1. Why "no login"

Every consumer-facing booking product worth using (Calendly, Cal.com, SuperPeer,
Stripe Checkout itself) has dropped the explicit signup step. The conversion
math is unforgiving: each form field roughly halves the proportion of users who
finish. Asking a stranger to create an account *before* they've decided to pay
is the wrong order.

The right model is **identify-on-payment**: the payment rail itself collects the
contact info we need (email, name, sometimes phone), so the "account" is created
silently as a side-effect of the first booking. If the user comes back, they
either re-enter the same email (and the new booking attaches to the same User
row by `email @unique`) or they sign in via Google later (and Auth.js
PrismaAdapter merges the OAuth identity onto the existing email-keyed User
without us writing any merge code).

---

## 2. Surface-by-surface starting point

| Surface | Current "auth" mechanism | Effective UX today | Change needed |
|---|---|---|---|
| **Web** | Auth.js v5 cookie via `auth()` / `resolveUserId` — 401 if no session | "Sign in with Google" gate before any booking action | **Yes — biggest change**: drop the gate, capture email + name on the booking form |
| **Telegram Mini App** | `x-telegram-init-data` HMAC → auto-creates User by `telegramId` | Already invisible to the user — they're "signed in" by virtue of opening the Mini App | **None for Phase 1.** The Telegram-issued name + (optional) email already flow through. |
| **WeChat Mini Program** | `x-wechat-token` JWT (from `code2session` → `wechatOpenId`) | Same as Telegram — invisible to the user | **None for Phase 1.** WeChat-issued profile fields already flow through. |

**This is a Web change, surfaced consistently to the other two.** Telegram and
WeChat already do guest-style booking; they just don't call it that.

---

## 3. Identity model — the one decision that drives everything

We need to choose how the absence of a logged-in `founderId` is represented.
Two options:

### Option A — Auto-create a `User` row at booking time *(recommended)*

When a guest checks out and provides email + name, we `upsert` a `User` by
email and use that user as the `Booking.founderId`. The user has:

- `id` = new cuid
- `email` = from the form / Stripe Checkout's customer details
- `name` = from the form
- `emailVerified` = null (guest; verified later when they actually sign in)
- `role` = USER, `tokenBalance` = 0, no `accounts` / `sessions` rows

When the same person later signs in via Google with the same email,
Auth.js's PrismaAdapter automatically attaches the OAuth `accounts` row to the
existing User. Their past bookings, token balance, POMP attestations
"reappear" without any merge logic on our side.

**Pros:**
- Zero schema migration. `Booking.founderId` stays non-null FK.
- All ~190 lines of existing code that reference `founderId` keep working —
  notifications, token credits, POMP, conflict detection, dashboards.
- Future account-linking is automatic via PrismaAdapter.
- Same code path as Telegram + WeChat (those already auto-create users today),
  so the three surfaces converge cleanly.

**Cons:**
- Creates `User` rows that may never sign in (orphan rows). Easy to age out
  with a periodic cleanup of users with no `accounts` AND no bookings in 12 months.

### Option B — Make `Booking.founderId` nullable + add `guestEmail` / `guestName`

**Pros:**
- Cleaner semantically — "guest" booking is a distinct entity.

**Cons:**
- Schema migration on a hot table (Booking).
- ~30 query / type touch-points need to handle `founder: User | null`.
- Notification, token-credit, and POMP code branches forever.
- Forces us to write the merge logic on first sign-in.

**Decision: Option A.** Smaller diff, fewer branches, automatic merge for free.

---

## 4. Anti-abuse — what stops bad behavior

The honest truth: **payment is the fraud filter for paid bookings.** No charge
captures, no booking confirmed. Stripe / WeChat Pay / PayNow already run their
own anti-fraud on the payer.

For the **free** booking path (zero-priced experts), we tighten:

| Layer | Current | Phase 1 change |
|---|---|---|
| Per-IP rate limit on `/api/bookings/free` | 12 / 5 min keyed by `userId` | Switch to keying by `(ip, email)` and add 3 / day for unauthenticated callers |
| Per-email rate limit on guest creation | n/a | 5 distinct experts / 24h per email |
| Disposable-email check | n/a | Defer to Phase 4 (overkill for MVP) |
| CAPTCHA | n/a | Defer; reconsider if abuse appears |

The expert can still cancel any booking that feels off, and we surface the
booker's contact email + first-time-flag (no prior bookings, no prior account)
so the expert has signal.

---

## 5. UX — "simple but beautiful"

### 5.1 Web booking flow (target)

```text
/experts/[id]                              ← public, no gate
   "Book a meetup" CTA  →

/experts/[id]/book                         ← public, no gate
   1. Pick session type (Online / Offline)
   2. Pick a slot (calendar grid, same as today)
   3. "Continue" button reveals contact card:
        ┌─────────────────────────────────────┐
        │  Almost done                        │
        │                                     │
        │  Your name                          │
        │  [______________]                   │
        │                                     │
        │  Your email                         │
        │  [______________]                   │
        │  We'll send your meetup link here.  │
        │                                     │
        │  ☐ Save my email for next time      │
        │    (creates a free account)         │
        │                                     │
        │       [ Continue to payment ]       │
        └─────────────────────────────────────┘
   4. Stripe Checkout / PayNow / TON / etc. (already works)
   5. Success page confirms the meetup; CTA "Manage this booking"
      links to a signed magic-link URL emailed to the user.
```

**Visual notes** — keep the existing dark-theme aesthetic; the contact card is
inline below the slot picker (not a modal); the "save my email" checkbox is
unchecked by default to honor the guest intent.

### 5.2 Telegram Mini App

No UX change. The MP already has the user's first/last name from initData. We
*display* "Booking as [Telegram name]" with a small edit affordance for email
(only required for Stripe Checkout — TON / Telegram-pay don't need it).

### 5.3 WeChat Mini Program

No UX change. The MP already has the user's `nickName` from `getUserProfile`.
We *display* "Booking as [WeChat nickname]" with the same email edit affordance
(WeChat Pay JSAPI doesn't need email; only Stripe paths do).

### 5.4 Booking management (Phase 2)

Every confirmation email contains a signed link:

```
https://www.help-and-grow.com/bookings/{id}?t={signed-token}
```

The token is HMAC-signed with `AUTH_SECRET`, expires in 90 days, and grants
read + cancel + reschedule on that *one* booking only. No login required to
manage the booking the user just paid for.

If the user later signs in via Google with the same email, the email-keyed
User row gets the OAuth identity and the booking shows in their normal
`/dashboard/bookings` list automatically.

---

## 6. Phasing

Each phase is one PR, one merge, fully shipped before the next starts.

### Phase 1 — Web guest checkout (paid + free) **← propose to start here**

**Scope:**
- Drop the auth gate on `POST /api/bookings/free`, `POST /api/bookings/checkout`,
  and `POST /api/bookings/paynow`. Replace with: if no `resolveUserId`, require
  `guestEmail` + `guestName` in the request body and `upsert` a User by email.
- Update `src/app/experts/[id]/book/page.tsx` to render the "Almost done"
  contact card when there's no session.
- Pass `customer_email` and `customer_creation: "always"` to Stripe so the
  Checkout session pre-fills email and we can reconcile via webhook.
- Tighten free-booking rate limit to `(ip, email)` for guest callers.
- New e2e test: anonymous user can complete a free booking on web.

**Out of scope for Phase 1:**
- TON / Telegram Pay / WeChat Pay (those already work without the Web Auth.js gate)
- Booking management for guests (Phase 2)
- Account-linking polish (works automatically; nothing to ship)

**Estimated scope:** ~6 files touched, ~250 LOC, 1 new e2e test, no schema migration.

### Phase 2 — Guest booking management

- Signed magic-link tokens for `bookings/{id}?t=...` access
- Cancel / reschedule UI gated by token instead of session
- Email template includes the magic link
- New `lib/booking-token.ts` (HMAC sign / verify with `AUTH_SECRET`)

### Phase 3 — Account-linking polish

- When a guest signs in with Google via the same email, surface a "We linked
  your past 3 bookings" notice on first dashboard visit
- Retroactive POMP claim ("connect a wallet to mint past attendance proofs")

### Phase 4 — Hardening

- Disposable-email domain check (`@mailinator.com` etc.) — only if abuse appears
- Optional CAPTCHA on the free-booking path
- Orphan-user reaper (delete guest Users with no bookings in 12 months)

---

## 7. Decisions captured

| # | Decision | Resolved |
|---|---|---|
| 1 | Auto-create User vs nullable `founderId` | Auto-create (Option A, §3) |
| 2 | Email mandatory? | Yes for Web. Optional for TG/WeChat MP (those have platform identity). |
| 3 | What about POMP for guest bookings? | Mint as normal — the User row exists; if no wallet attached, store as a "claimable" attestation referenced by email hash. Phase 3 lets the user claim it after sign-in. |
| 4 | What about H&G token rewards for guest bookings? | Credit normally to the auto-created User. They show up the moment the user signs in with that email. |
| 5 | Phone number? | Not required Phase 1. Stripe Checkout collects it during pay if the expert needs SMS reminders; we read it from the webhook. |
| 6 | Save-my-email checkbox | Unchecked by default. Honors guest intent; prevents accidental account creation. When checked, sends a magic-link signin email after the booking confirmation. |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Spam free-bookings | Rate-limit by `(ip, email)`; expert can cancel any booking; disposable-email check in Phase 4 |
| Email typos lock the user out of their own booking | Confirmation email includes the canonical email + a "wrong email?" link to contact support |
| Guest user collides with existing OAuth user (same email) | `upsert` is idempotent; if the existing User has `accounts` rows already, we attach the booking and *don't* overwrite name |
| Operators want metrics on "guest vs signed-in" bookings | Add `Booking.bookerOrigin: "guest" | "auth" | "telegram" | "wechat"` enum (Phase 1, no migration cost — defaulting on insert) |

---

## 9. Test plan

| Test | Layer | Phase |
|---|---|---|
| Anonymous web user completes free booking | e2e | 1 |
| Anonymous web user completes Stripe Checkout (mock or test card) | e2e | 1 |
| Email collision: guest books, then signs in with Google → past booking visible on dashboard | e2e (or unit on adapter) | 1 |
| Telegram MP booking unchanged (regression) | e2e | 1 |
| WeChat MP booking unchanged (regression) | manual smoke | 1 |
| Magic-link token cancel | e2e | 2 |
| Magic-link token reschedule | e2e | 2 |
| Token expiry rejected | unit | 2 |
