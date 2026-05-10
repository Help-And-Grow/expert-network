# Reliability

## Error Handling Strategy

### API Routes
- All routes wrapped in try/catch, returning consistent `{ error: string }` responses
- Payment webhooks must always return 200 to Stripe (even on partial failure) to prevent retry storms
- Notification calls (Telegram, WeChat) are fire-and-forget: `.catch(() => {})` to not block responses

### Database
- Prisma with PostgreSQL only (`@prisma/adapter-pg`); `DATABASE_URL` must be `postgresql://` or `postgres://`
- Web/Telegram production runs on Google Cloud SQL (`hg-postgres-prod`, `asia-southeast1`) since 2026-05-03
- Provider-specific URL handling lives in `src/lib/postgres-connection-url.ts` and `src/lib/postgres-pool.ts`
- Cold start mitigation: keep Vercel functions warm for payment-critical routes

### Admin provider-config writes (atomic apply)
- The `/admin/providers` POST handler wraps every DB mutation (ProviderRegistry
  upserts, SystemConfig writes, ProviderConfigChange audit rows) in a single
  Prisma `$transaction`. If any write throws, the entire transaction rolls
  back and the response is `500` with no partial state on disk.
- Vercel env push + deploy-hook trigger run **after** the transaction commits.
  A failure there does NOT roll back the DB — the response is `200` with
  `{ ok: true, deployTriggered: false, deployError: "..." }` so the admin UI
  can show "DB saved, deploy needs retry" and surface a one-click
  `/api/admin/providers/retry-deploy` button. This is intentional: we'd rather
  have a consistent DB + a known-failed deploy than a half-committed change.
- Every write writes a row to `ProviderConfigChange` (append-only audit log)
  inside the transaction, so a successful apply is always observable in the
  audit log even if the operator never sees the response.

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

## Monitoring

- Vercel function logs (console.error with `[domain/action]` prefix)
- Structured request logs with request IDs for selected booking and voice-chat routes
- Stripe Dashboard for webhook delivery monitoring
- Manual check of Vercel deployment status

## Improvement Targets

- [ ] Expand structured logging with request IDs across webhooks, admin mutations, and provider calls
- [ ] Set up Vercel Analytics for core web vitals
- [ ] Add health check endpoint (`/api/health`)
- [ ] Implement circuit breaker for external API calls (Stripe, AI providers)
