# Architecture Design: Premium Live Consultation via TRTC

**Status:** Proposed
**Author:** Engineering
**Target Date:** 2026-Q2

## 1. Objective

To provide a seamless, ultra-low-latency in-app live consultation experience (voice and video) for "Help & Grow" players. This feature is designed as a premium, credit purchase-based add-on. 

*Note: This architecture explicitly replaces any previous conceptual or planned integrations of the Agora RTC SDK, standardizing our realtime communication infrastructure on **Tencent Cloud TRTC Engine** to better align with our Asian user base and multi-cloud strategy.*

## 2. Core Architectural Decisions

### 2.1 TRTC Engine Selection
We will utilize the **Tencent Cloud Real-Time Communication (TRTC) Engine**. 
- **Why TRTC?** It provides exceptional node coverage and routing optimizations in Asia, maintaining latency below 300ms even under poor network conditions. 
- **Cost Efficiency:** The platform provides 10,000 free minutes per month. Since live consultations are gated behind premium credit purchases, the business model naturally restricts usage to high-value transactions, allowing us to comfortably operate within or near the free tier during early GTM.

### 2.2 Credit-Based Access Model
Live consultations will not be available for free. They operate as an upsell/add-on to standard async bookings.
- **Player Flow:** When booking an expert, the player can toggle "In-App Live Session." This deducts additional H&G credits (or requires a direct fiat upcharge).
- **Validation:** The backend will only generate a TRTC `UserSig` (authentication token) if the underlying `Booking` record indicates that the premium live add-on was successfully purchased.

## 3. System Components & Workflow

### 3.1 Backend: Room & Token Provisioning
- **Environment Variables:** `TRTC_APP_ID` and `TRTC_APP_SECRET` will replace `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE`.
- **Endpoint (`/api/trtc/token`):** 
  - Validates the user's session and the specific `bookingId`.
  - Checks the database to ensure the booking has the premium live consultation flag enabled.
  - Uses the Tencent Cloud SDK to generate a temporary `UserSig` valid only for the duration of the scheduled consultation.
  - Returns the `UserSig`, `RoomId` (mapped 1:1 with the `bookingId`), and `SdkAppId`.

### 3.2 Frontend: Seamless In-App Experience
- **Web App:** Integrates `trtc-sdk-web`. The consultation UI will be a dedicated modal or full-screen page (`/consultation/[bookingId]`) that initializes the local audio/video tracks and joins the TRTC room.
- **WeChat Mini Program:** Integrates the specialized TRTC WeChat Mini Program SDK (`trtc-wx`), ensuring users do not need to leave the WeChat ecosystem to conduct their call.
- **Telegram Mini App:** Utilizes the web SDK within the Telegram Webview, leveraging WebRTC support.

## 4. Data Model Enhancements (Proposed)

The Prisma schema will be extended to support the premium add-on:

```prisma
model Booking {
  // ... existing fields
  isPremiumLive   Boolean @default(false)
  liveRoomId      String? @unique // Generated upon successful payment
  liveDuration    Int?    // Tracked duration of the actual call in minutes
}

model Transaction {
  // ... tracking credit deduction for the live consultation
}
```

## 5. Security & Cost Controls

1. **Strict Token Expiration:** `UserSig` tokens will be generated with strict expirations (e.g., scheduled meeting duration + 15 minutes grace period) to prevent unauthorized room reuse.
2. **Webhook Integration:** TRTC provides event callbacks. We will ingest room start/end webhooks to accurately track the `liveDuration` and deduct additional credits if the user stays over the booked time.
3. **No Unauthenticated Rooms:** Anonymous users or users without a valid paid booking cannot generate a token or join a room.

## 6. Migration Notes
- Removed references to `agora-rtc-sdk-ng` from `CODE_WIKI.md`.
- Purge `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` from all Vercel environments.
