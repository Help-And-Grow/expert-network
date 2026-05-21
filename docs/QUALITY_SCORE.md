# Quality Score

Quality grades per domain and layer. Updated periodically to track improvement.

**Grading scale**: A (excellent) | B (good) | C (adequate) | D (needs work) | F (broken)

## Domain Grades

| Domain | Grade | Notes | Last Updated |
|--------|-------|-------|--------------|
| Auth (Web) | B | Auth.js v5, Google OAuth + Nodemailer magic link | 2026-04 |
| Auth (Telegram) | B | HMAC validation, JWT, cookie-based, request validation + rate limit | 2026-04 |
| Auth (WeChat) | B | code2session + JWT, request validation + rate limit; production flows still need routine smoke | 2026-04 |
| Expert Profiles | B | AI generation works well; hero images need another quality pass | 2026-03 |
| Meetups (`Booking`) | B | Multi-slot, timezone-aware, overlap detection, validation/rate limit on create/checkout paths | 2026-04 |
| Payments (Stripe) | B | Live mode, Connected Accounts, webhook fixed | 2026-03 |
| Payments (PayNow SG) | B | Primary web payment flow; admin-confirm path in place | 2026-04 |
| Payments (TON) | C | Works but manual confirmation, no refund flow | 2026-03 |
| Payments (WeChat Pay) | C | Implemented (incl. service-provider mode) but not yet routinely tested in production | 2026-03 |
| AI Matching | B | Multi-provider with keyword fallback | 2026-03 |
| Voice Chat (async) | B | DashScope/Qwen, 3-reply free cap, rate-limited; web autoplay greeting with device-speech fallback | 2026-04 |
| Voice Chat (realtime) | C | Timed 3-min cap; readiness depends on `DASHSCOPE_API_KEY`; UX still settling on web/Telegram | 2026-04 |
| Premium Live (TRTC) | C | Token issuance + H&G token debit shipped; needs production rehearsal | 2026-04 |
| Appreciations (`Review`) | B | Two-way with coach follow-up | 2026-03 |
| Onboarding | B | Multi-step wizard, AI-powered | 2026-03 |
| Notifications | C | Telegram works, WeChat template msgs untested | 2026-03 |
| WeChat Mini Program | C | Functional but needs UX polish before wider launch | 2026-03 |
| MCP server / `v1/*` public API | B | Stable surface for agent integration | 2026-04 |
| On-chain (POMP + H&G token) | B | EAS attestations + ERC-20 redeem live on Base | 2026-04 |

## Layer Grades

| Layer | Grade | Notes |
|-------|-------|-------|
| Database schema | B | Well-structured, indexed, supports multi-platform; auto-baseline migration on Vercel |
| API routes | B | Consistent patterns, unified auth, high-risk routes now have first-pass validation/rate limits; full reference in [`docs/API.md`](API.md) |
| Health checks | B | `/api/health` + `/api/db-health` shipped; not yet wired to external uptime monitor |
| Error handling | C | Inconsistent — some routes have detailed errors, others are bare |
| Testing | C | Playwright smoke covers health, auth, booking surfaces, debug gating, API contracts; deeper critical-path tests still needed |
| Observability | C | `@vercel/otel` instrumentation + structured request logs on selected booking/voice routes; no metrics or trace backend yet |
| Documentation | B | Top-level docs revamped (README, RUNBOOK, API, ENV); AGENTS/ARCHITECTURE current |
| CI/CD | C | Workflows live (re-enabled in commit `27f2570`); pre-merge ESLint + Playwright smoke run on PR; Vercel auto-deploy on push to `main`; no post-deploy regression gate beyond `deploy-smoke.yml` |

## Action Items

- [ ] Continue Zod validation rollout beyond the high-risk booking, voice chat, and auth routes
- [ ] Expand structured logging to payment webhooks, admin actions, and external provider calls
- [ ] Add integration tests for full meetup scheduling, payment success, and webhook replay paths
- [ ] Improve error handling consistency across all API routes
