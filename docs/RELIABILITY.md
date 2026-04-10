# Reliability

## Error Handling Strategy

### API Routes
- All routes wrapped in try/catch, returning consistent `{ error: string }` responses
- Payment webhooks must always return 200 to Stripe (even on partial failure) to prevent retry storms
- Notification calls (Telegram, WeChat) are fire-and-forget: `.catch(() => {})` to not block responses

### Database
- Prisma with connection pooling via Supabase Pooler
- `connectTimeout: 10000` for MySQL adapter
- Cold start mitigation: keep Vercel functions warm for payment-critical routes

### Payment Reliability
- **Double-write pattern**: `Booking` row created by both webhook AND checkout success page verify (product: **meetup** confirmed)
- **Idempotency**: Webhook checks `stripeCheckoutSessionId` before creating duplicate rows
- **Remainder charging**: Daily cron (`/api/cron/charge-remainder`) with per-meetup error isolation
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
- Stripe Dashboard for webhook delivery monitoring
- Manual check of Vercel deployment status

## Improvement Targets

- [ ] Add structured logging with request IDs for tracing
- [ ] Set up Vercel Analytics for core web vitals
- [ ] Add health check endpoint (`/api/health`)
- [ ] Implement circuit breaker for external API calls (Stripe, AI providers)
