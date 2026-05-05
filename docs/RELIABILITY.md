# Reliability

## Error Handling Strategy

### API Routes
- All routes wrapped in try/catch, returning consistent `{ error: string }` responses
- Payment webhooks must always return 200 to Stripe (even on partial failure) to prevent retry storms
- Notification calls (Telegram, WeChat) are fire-and-forget: `.catch(() => {})` to not block responses

### Database
- Prisma with connection pooling via Supabase Pooler
- PostgreSQL only (`@prisma/adapter-pg`); `DATABASE_URL` must be `postgresql://` or `postgres://`
- Cold start mitigation: keep Vercel functions warm for payment-critical routes

### Payment Reliability
- **Double-write pattern**: `Booking` row created by both webhook AND checkout success page verify (product: **meetup** confirmed)
- **Idempotency**: Webhook checks `stripeCheckoutSessionId` before creating duplicate rows
- **Booking maintenance cron**: Daily cron (`/api/cron/charge-remainder`) auto-completes ended meetups and sends reminders; remainder charging is retired for new bookings
- **Webhook monitoring**: `maxDuration=30` on webhook handler; diagnostic logging for signature failures

## Known Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| DB cold start timeout | Meetup (`Booking`) creation fails | Verify endpoint retries; webhook retries by Stripe |
| Stripe webhook secret mismatch | All webhooks fail | Diagnostic logging with secret prefix; verify endpoint fallback |
| AI provider rate limit | Expert matching returns error | Keyword-based fallback in `/api/experts/match` |
| WeChat session expired | API calls return 401 | Auto-refresh via `wx.login()` in Mini Program |

## Health checks

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | App liveness — confirms the runtime can serve a request |
| `GET /api/db-health` | Prisma connectivity — verifies `DATABASE_URL` resolves and a trivial query succeeds (returns Prisma error code on failure) |

Wire these into your uptime monitor; both are auth-free.

## Migration safety net

Production builds run [`scripts/prisma-migrate-if-vercel.mjs`](../scripts/prisma-migrate-if-vercel.mjs) in `postinstall`. It auto-baselines when the Supabase/Postgres database has tables but no `_prisma_migrations` history (added in commit `edf8faf`), so a fresh Vercel deploy against an existing schema will not abort with "drift detected." Treat this as a safety net, not a substitute for tracked migrations.

## Monitoring

- Vercel function logs (console.error with `[domain/action]` prefix)
- Structured request logs with request IDs for selected booking and voice-chat routes
- OpenTelemetry via `@vercel/otel` ([`src/instrumentation.ts`](../src/instrumentation.ts)); see [`docs/references/vercel-open-telemetry.md`](references/vercel-open-telemetry.md)
- Stripe Dashboard for webhook delivery monitoring
- Manual check of Vercel deployment status

## Improvement Targets

- [ ] Expand structured logging with request IDs across webhooks, admin mutations, and provider calls
- [ ] Set up Vercel Analytics for core web vitals
- [ ] Implement circuit breaker for external API calls (Stripe, AI providers)
- [ ] Wire `/api/health` and `/api/db-health` to an external uptime monitor (currently checked manually)
