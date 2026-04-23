# Database Schema

> Auto-generated from `prisma/schema.prisma`. Regenerate when schema changes.

**Product language:** In UI and brand docs we say **meetup** and **appreciation**; Prisma model names remain **`Booking`** and **`Review`**. See [docs/BRAND.md](../BRAND.md).

## Entity Relationship Diagram

```
User 1──1 Expert
  │                  1──* AvailableSlot
  │                  1──* Booking ──1 Review
  │                  1──* Review
  │
  ├──* Account (NextAuth OAuth)
  ├──* Session (NextAuth sessions)
  └──* Booking (as founder)
       └──1 Review (as founder)
```

## Enums

| Enum | Values |
|------|--------|
| `UserRole` | USER, ADMIN |
| `SessionType` | ONLINE, OFFLINE, BOTH |
| `BookingStatus` | PENDING, CONFIRMED, COMPLETED, CANCELLED |
| `OnboardingStep` | SOCIAL_LINKS, DOMAINS, SESSION_PREFS, AI_GENERATION, PREVIEW, PUBLISHED |

## Models

### User
Primary user model for all platforms.

| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | Primary key |
| name | String? | Display name |
| nickName | String? | Preferred name (from Telegram/WeChat) |
| email | String? | Unique, for web auth |
| role | UserRole | Default: USER; authorization only, not coach/player identity |
| telegramId | String? | Unique, for Telegram auth |
| telegramUsername | String? | For notifications |
| wechatOpenId | String? | Unique, for WeChat auth |
| wechatUnionId | String? | Cross-app WeChat identity |

### Expert
Extended profile linked 1:1 to User.

| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | Primary key |
| userId | String | Unique FK → User |
| linkedIn, website, twitter, substack, instagram, xiaohongshu | String? | Social links |
| gender | String? | For AI image generation |
| priceOnlineCents | Int? | SGD cents per hour |
| priceOfflineCents | Int? | SGD cents per hour |
| currency | String | Default: "SGD" |
| stripeAccountId | String? | Stripe Connected Account |
| stripeAccountStatus | String? | none / onboarding / active / restricted |
| wechatSubMchId | String? | WeChat Pay sub-merchant (特约商户号) for partner / profit-sharing mode |
| weeklySchedule | Json? | `{ "mon": [{"start":"10:00","end":"15:00"}], ... }` |
| sessionType | SessionType | Default: BOTH |
| bio | String? (Text) | AI-generated professional bio |
| servicesOffered | Json? | Structured services list |
| onboardingStep | OnboardingStep | Current wizard step |
| isPublished | Boolean | Visible in discover list |
| avgRating | Float | Computed from appreciations (`Review` rows) |
| reviewCount | Int | Count of appreciations (API/UI: avoid “review”) |
| tonWalletAddress | String? | TON crypto wallet |
| mem9SpaceId | String? | Persistent memory space |

### AvailableSlot
Explicit availability windows (supplements weeklySchedule).

| Field | Type | Notes |
|-------|------|-------|
| expertId | String | FK → Expert |
| startTime | DateTime | Slot start |
| endTime | DateTime | Slot end |
| isBooked | Boolean | Default: false |

### Booking
Session records with full payment tracking.

| Field | Type | Notes |
|-------|------|-------|
| expertId | String | FK → Expert |
| founderId | String | FK → User |
| sessionType | SessionType | ONLINE or OFFLINE |
| startTime / endTime | DateTime | Session window |
| timezone | String | Default: "Asia/Singapore" |
| status | BookingStatus | Default: PENDING |
| totalAmountCents | Int? | Full session price |
| depositAmountCents | Int? | 50% deposit |
| paymentMethod | String? | "stripe" / "ton" / "wechat" / "free" |
| paymentStatus | String | "pending" / "deposit_paid" / "fully_paid" |
| stripeCheckoutSessionId | String? | For idempotent booking creation |
| remainderChargedAt | DateTime? | When remainder was collected |
| wechatProfitShareStatus | String? | Partner profit-sharing: pending / success / failed / skipped |

### Review
Post-meetup **appreciation** (player rating + optional comment); coach **follow-up** on `expertSuggestion`.

| Field | Type | Notes |
|-------|------|-------|
| bookingId | String | Unique FK → Booking |
| expertId | String | FK → Expert |
| founderId | String | FK → User (player side) |
| rating | Int | 1-5 stars |
| comment | String? (Text) | Player appreciation note |
| expertSuggestion | String? (Text) | Coach follow-up |
| suggestionAt | DateTime? | When coach responded |
