# Tech Design: Resolving P1 Technical Debt

**Status:** Ready for Implementation (Targeted for CODEX Agent)
**Date:** 2026-04
**Target:** TD-001 (Testing) and TD-002 (API Validation)

## Objective
To provide a concrete implementation plan for resolving the highest priority (P1) technical debt items in the Help & Grow platform. This document serves as the specification for AI coding agents (like CODEX) to systematically close these gaps.

---

## 1. Resolving TD-001: Critical-Path E2E Testing Expansion

**Current State:** Playwright smoke tests exist, but critical paths like the full booking lifecycle, payment webhooks, and voice chat interactions are under-tested, allowing regressions to escape to production.

### Implementation Plan

**1.1. Payment & Checkout Flow Testing (`e2e/booking/payment-flow.spec.ts`)**
- **Action:** Create tests that simulate the creation of a checkout session.
- **Details:** 
  - Authenticate a test user.
  - Navigate to an expert's profile and trigger the booking flow.
  - Intercept the `/api/bookings/checkout` network request to ensure the correct payload (expert ID, time slot) is sent.
  - Mock the Stripe/WeChat payment success callback to verify the UI correctly transitions to the "Booking Confirmed" state.

**1.2. Voice Chat Interaction Testing (`e2e/voice/voice-chat.spec.ts`)**
- **Action:** Cover both `async` and `realtime` voice chat modes.
- **Details:**
  - Mock the `/api/voice-chat/greeting` and `/api/voice-chat/message` endpoints to return predefined audio/text fixtures.
  - Assert that the UI renders the audio player and transcript correctly.
  - Assert that the "autoplay" logic triggers (or degrades gracefully) upon entering the chat surface.

**1.3. Webhook Simulation Utilities (`e2e/utils/webhook-mocks.ts`)**
- **Action:** Create a utility to programmatically hit the local Next.js webhook endpoints (`/api/webhooks/stripe`, `/api/webhook/onchain`) during E2E setup.
- **Details:** This allows tests to verify that the database state updates correctly (e.g., `Booking` status changes to `PAID`) without needing a real external Stripe environment.

---

## 2. Resolving TD-002: Comprehensive API Zod Validation

**Current State:** High-risk routes (booking, voice, auth) use Zod, but lower-risk REST API routes still trust incoming payloads blindly, risking 500 errors or dirty data insertion.

### Implementation Plan

**2.1. Audit & Schema Creation (`src/lib/validations/`)**
- **Action:** Centralize Zod schemas for all remaining API routes.
- **Details:** Create schemas for:
  - Expert profile updates (`ExpertProfileUpdateSchema`)
  - Review submissions (`CreateReviewSchema`)
  - User profile settings (`UserProfileSchema`)
  - Search/Filter query parameters (`ExpertSearchQuerySchema`)

**2.2. Route Handlers Hardening (`src/app/api/**/*.ts`)**
- **Action:** Refactor all `GET`, `POST`, `PUT`, `DELETE` handlers to parse requests through Zod before executing business logic.
- **Implementation Pattern:**
  ```typescript
  import { z } from "zod";
  import { NextResponse } from "next/server";

  const payloadSchema = z.object({ /* ... */ });

  export async function POST(req: Request) {
    try {
      const json = await req.json();
      const parsed = payloadSchema.safeParse(json);
      
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid payload", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      
      // Proceed with parsed.data safely...
    } catch (e) {
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  }
  ```

**2.3. Query Parameter Validation**
- **Action:** Ensure `GET` requests strictly validate `req.nextUrl.searchParams`.
- **Details:** Convert string parameters to numbers/booleans where expected (e.g., `limit`, `page`) using `z.coerce.number()` to prevent Prisma type mismatches.

---

## Acceptance Criteria for CODEX
1. All new E2E tests pass locally (`npm run test:e2e`).
2. No API route in `src/app/api` reads from `req.json()` or `searchParams` without a `Zod` validation wrapper.
3. Invalid API payloads gracefully return `400 Bad Request` with Zod error details instead of crashing the server with a `500`.